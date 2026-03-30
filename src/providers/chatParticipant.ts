import * as vscode from 'vscode';
import { getLLMClient } from './languageModel';
import { gatherContext, formatContextForPrompt, buildSystemPrompt } from '../context/references';
import { LLMMessage } from '../utils/streaming';

const PARTICIPANT_ID = 'aicoder.assistant';

export function registerChatParticipant(extensionContext: vscode.ExtensionContext): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleChatRequest);
  participant.iconPath = new vscode.ThemeIcon('sparkle');

  extensionContext.subscriptions.push(participant);
  return participant;
}

interface FileBlock {
  filePath: string;
  content: string;
  language: string;
}

function parseFileBlocks(text: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  const regex = /FILE:\s*(.+?)\s*\n```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const filePath = match[1].trim().replace(/^`|`$/g, '');
    const language = match[2] || '';
    const content = match[3];
    if (filePath && content) {
      blocks.push({ filePath, content, language });
    }
  }

  return blocks;
}

async function createFilesInWorkspace(
  blocks: FileBlock[],
  response: vscode.ChatResponseStream
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0 || blocks.length === 0) return;

  const rootUri = workspaceFolders[0].uri;

  response.markdown('\n\n---\n**Files created:**\n');

  for (const block of blocks) {
    try {
      const fileUri = vscode.Uri.joinPath(rootUri, block.filePath);

      const dirPath = block.filePath.includes('/')
        ? block.filePath.substring(0, block.filePath.lastIndexOf('/'))
        : '';
      if (dirPath) {
        const dirUri = vscode.Uri.joinPath(rootUri, dirPath);
        await vscode.workspace.fs.createDirectory(dirUri);
      }

      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(fileUri, encoder.encode(block.content));

      response.anchor(fileUri, block.filePath);
      response.markdown(' \u2713\n');

      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      response.markdown(`- \u2717 \`${block.filePath}\` — ${msg}\n`);
    }
  }
}

async function handleChatRequest(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  const codeContext = await gatherContext();
  const contextText = formatContextForPrompt(codeContext);
  const systemPrompt = buildSystemPrompt(contextText);

  const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const turn of chatContext.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push({ role: 'user', content: turn.prompt });
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const parts = turn.response;
      let text = '';
      for (const part of parts) {
        if (part instanceof vscode.ChatResponseMarkdownPart) {
          text += part.value.value;
        }
      }
      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
    }
  }

  let userPrompt = request.prompt;

  if (request.references && request.references.length > 0) {
    const refParts: string[] = [];
    for (const ref of request.references) {
      if (ref.value instanceof vscode.Uri) {
        try {
          const doc = await vscode.workspace.openTextDocument(ref.value);
          const relativePath = vscode.workspace.asRelativePath(ref.value);
          refParts.push(`\n[Referenced file: ${relativePath}]\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\``);
        } catch {
          // file not accessible
        }
      } else if (ref.value instanceof vscode.Location) {
        try {
          const doc = await vscode.workspace.openTextDocument(ref.value.uri);
          const text = doc.getText(ref.value.range);
          const relativePath = vscode.workspace.asRelativePath(ref.value.uri);
          refParts.push(`\n[Referenced: ${relativePath}:${ref.value.range.start.line + 1}]\n\`\`\`\n${text}\n\`\`\``);
        } catch {
          // location not accessible
        }
      }
    }
    if (refParts.length > 0) {
      userPrompt += '\n\n## Referenced Context' + refParts.join('\n');
    }
  }

  messages.push({ role: 'user', content: userPrompt });

  const modelOverride = extractOllamaModelFromRequest(request);

  const client = getLLMClient();
  const abortController = new AbortController();
  token.onCancellationRequested(() => abortController.abort());

  let fullResponse = '';

  try {
    for await (const chunk of client.streamChat({ messages, modelOverride }, abortController.signal)) {
      if (token.isCancellationRequested) break;
      response.markdown(chunk);
      fullResponse += chunk;
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // user cancelled
    } else {
      const message = err instanceof Error ? err.message : 'Unknown error';
      response.markdown(`\n\n**Error:** ${message}\n\nMake sure your LLM provider is configured correctly in settings (\`aiCoder.provider\`).`);
    }
  }

  const fileBlocks = parseFileBlocks(fullResponse);
  if (fileBlocks.length > 0) {
    await createFilesInWorkspace(fileBlocks, response);
  }

  return {};
}

function extractOllamaModelFromRequest(request: vscode.ChatRequest): string | undefined {
  try {
    const model = (request as unknown as { model?: { id?: string } }).model;
    if (model?.id?.startsWith('aicoder:ollama-')) {
      return model.id.replace('aicoder:ollama-', '');
    }
  } catch {
    // model info not available
  }
  return undefined;
}
