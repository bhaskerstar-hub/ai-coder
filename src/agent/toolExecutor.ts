import * as vscode from 'vscode';
import {
  toolReadFile,
  toolEditFile,
  toolCreateFile,
  toolSearchCode,
  toolListFiles,
  toolRunTerminal,
} from './tools';

export type PermissionMode = 'ask' | 'plan' | 'auto';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  result: string;
  approved: boolean;
}

const DESTRUCTIVE_TOOLS = new Set(['editFile', 'createFile', 'runTerminal']);

function getPermissionMode(): PermissionMode {
  return vscode.workspace.getConfiguration('aiCoder').get<PermissionMode>('permissionMode', 'ask');
}

async function requestPermission(toolName: string, description: string): Promise<boolean> {
  const mode = getPermissionMode();
  if (mode === 'auto') return true;
  if (!DESTRUCTIVE_TOOLS.has(toolName)) return true;

  const action = await vscode.window.showWarningMessage(
    `AI Coder wants to: ${description}`,
    { modal: false },
    'Allow',
    'Deny'
  );

  return action === 'Allow';
}

function describeToolCall(call: ToolCall): string {
  switch (call.name) {
    case 'readFile':
      return `Read file "${call.args.filePath}"`;
    case 'editFile':
      return `Edit file "${call.args.filePath}"`;
    case 'createFile':
      return `Create file "${call.args.filePath}"`;
    case 'searchCode':
      return `Search for "${call.args.pattern}"`;
    case 'listFiles':
      return `List files${call.args.directory ? ` in "${call.args.directory}"` : ''}`;
    case 'runTerminal':
      return `Run command: ${call.args.command}`;
    default:
      return `Unknown tool: ${call.name}`;
  }
}

export async function executeTool(
  call: ToolCall,
  response: vscode.ChatResponseStream
): Promise<ToolResult> {
  const description = describeToolCall(call);

  response.progress(description);

  const approved = await requestPermission(call.name, description);
  if (!approved) {
    return { name: call.name, result: 'Tool call denied by user.', approved: false };
  }

  let result: string;

  try {
    switch (call.name) {
      case 'readFile':
        result = await toolReadFile({
          filePath: call.args.filePath as string,
          startLine: call.args.startLine as number | undefined,
          endLine: call.args.endLine as number | undefined,
        });
        break;

      case 'editFile':
        result = await toolEditFile({
          filePath: call.args.filePath as string,
          oldText: call.args.oldText as string,
          newText: call.args.newText as string,
        });
        if (result.startsWith('Successfully')) {
          response.markdown(`\n> \u2705 Edited \`${call.args.filePath}\`\n\n`);
        }
        break;

      case 'createFile':
        result = await toolCreateFile({
          filePath: call.args.filePath as string,
          content: call.args.content as string,
        });
        if (result.startsWith('Successfully')) {
          response.markdown(`\n> \u2705 Created \`${call.args.filePath}\`\n\n`);
        }
        break;

      case 'searchCode':
        result = await toolSearchCode({
          pattern: call.args.pattern as string,
          glob: call.args.glob as string | undefined,
          maxResults: call.args.maxResults as number | undefined,
        });
        break;

      case 'listFiles':
        result = await toolListFiles({
          directory: call.args.directory as string | undefined,
          glob: call.args.glob as string | undefined,
        });
        break;

      case 'runTerminal': {
        result = await toolRunTerminal({
          command: call.args.command as string,
          cwd: call.args.cwd as string | undefined,
        });
        const cmdShort = (call.args.command as string).slice(0, 60);
        response.markdown(`\n> \u2699\ufe0f Ran \`${cmdShort}\`\n\n`);
        break;
      }

      default:
        result = `Unknown tool: ${call.name}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result = `Tool error (${call.name}): ${msg}`;
  }

  return { name: call.name, result, approved: true };
}
