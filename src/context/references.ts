import * as vscode from 'vscode';
import { getConfig } from '../config/settings';

export interface CodeContext {
  activeFile?: { uri: vscode.Uri; content: string; languageId: string; selection?: string };
  openFiles: { uri: vscode.Uri; content: string; languageId: string }[];
  workspaceFiles: string[];
}

export async function gatherContext(): Promise<CodeContext> {
  const config = getConfig();
  const editor = vscode.window.activeTextEditor;
  const ctx: CodeContext = { openFiles: [], workspaceFiles: [] };

  if (editor) {
    const doc = editor.document;
    const content = doc.getText();
    if (content.length <= config.context.maxFileSize) {
      const selection = editor.selection.isEmpty ? undefined : doc.getText(editor.selection);
      ctx.activeFile = {
        uri: doc.uri,
        content,
        languageId: doc.languageId,
        selection,
      };
    }
  }

  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme !== 'file') continue;
    if (ctx.activeFile && doc.uri.fsPath === ctx.activeFile.uri.fsPath) continue;
    if (doc.getText().length > config.context.maxFileSize) continue;
    ctx.openFiles.push({
      uri: doc.uri,
      content: doc.getText(),
      languageId: doc.languageId,
    });
  }

  return ctx;
}

export function formatContextForPrompt(ctx: CodeContext): string {
  const parts: string[] = [];

  if (ctx.activeFile) {
    const relativePath = vscode.workspace.asRelativePath(ctx.activeFile.uri);
    parts.push(`## Current File: ${relativePath} (${ctx.activeFile.languageId})`);
    parts.push('```' + ctx.activeFile.languageId);
    parts.push(ctx.activeFile.content);
    parts.push('```');

    if (ctx.activeFile.selection) {
      parts.push('\n## Selected Code:');
      parts.push('```' + ctx.activeFile.languageId);
      parts.push(ctx.activeFile.selection);
      parts.push('```');
    }
  }

  const maxOpenFiles = 3;
  const relevantOpen = ctx.openFiles.slice(0, maxOpenFiles);
  for (const file of relevantOpen) {
    const relativePath = vscode.workspace.asRelativePath(file.uri);
    parts.push(`\n## Open File: ${relativePath} (${file.languageId})`);
    const truncated = file.content.length > 2000
      ? file.content.slice(0, 2000) + '\n... (truncated)'
      : file.content;
    parts.push('```' + file.languageId);
    parts.push(truncated);
    parts.push('```');
  }

  return parts.join('\n');
}

export function buildSystemPrompt(context: string): string {
  return `You are AI Coder, an expert coding assistant integrated into VS Code.

You have access to the user's code and workspace. You can create, edit, and explain code.

Rules:
- Be concise but thorough
- If you're unsure about something, say so rather than guessing

## CRITICAL: Creating Files

When the user asks you to create, write, generate, or make ANY file or program, you MUST output the filename in bold on its own line immediately before the code block. This is how files get created in the workspace:

**hello.py**
\`\`\`python
print("Hello, World!")
\`\`\`

More examples:

**src/App.tsx**
\`\`\`tsx
export default function App() { return <h1>Hello</h1>; }
\`\`\`

**tests/test_example.py**
\`\`\`python
def test_hello(): assert True
\`\`\`

RULES:
- ALWAYS put the filename in **bold** on its own line right before the code block
- Use a relative path from the workspace root
- Include the file extension
- The file WILL be created automatically in the user's workspace
- If editing an existing file, use the same path

## Editing Files

When asked to edit existing code, show the complete updated code with the bold filename using the existing file path.

${context ? `\n## Workspace Context\n${context}` : ''}`;
}
