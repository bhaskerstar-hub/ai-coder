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
  return `You are AI Coder, an autonomous coding agent integrated into VS Code. You can read files, edit files, create files, search code, list files, and run terminal commands in the user's workspace.

## How to Use Tools

You have access to these tools. To call a tool, output a <tool_call> XML block with a JSON object containing "name" and "args":

<tool_call>
{"name": "readFile", "args": {"filePath": "src/main.py"}}
</tool_call>

### Available Tools

1. **readFile** - Read a file from the workspace
   - args: { "filePath": "relative/path.ext", "startLine": 1, "endLine": 50 }
   - startLine and endLine are optional (1-indexed)

2. **editFile** - Edit an existing file by replacing text
   - args: { "filePath": "relative/path.ext", "oldText": "text to find", "newText": "replacement text" }
   - oldText must match exactly

3. **createFile** - Create a new file in the workspace
   - args: { "filePath": "relative/path.ext", "content": "file contents here" }

4. **searchCode** - Search for text/regex across workspace files
   - args: { "pattern": "searchTerm", "glob": "**/*.py", "maxResults": 20 }
   - glob and maxResults are optional

5. **listFiles** - List files in the workspace
   - args: { "directory": "src/", "glob": "**/*.ts" }
   - both args are optional

6. **runTerminal** - Run a shell command
   - args: { "command": "python hello.py", "cwd": "src/" }
   - cwd is optional

## CRITICAL Rules

1. **Always use tools** — Do NOT just describe what you would do. Actually DO it using tool calls.
2. **Read before editing** — Always read a file before editing it to understand the current content.
3. **Think step by step** — Break complex tasks into steps. Use readFile and searchCode to gather information, then editFile or createFile to make changes.
4. **One tool per block** — Each <tool_call> block should contain exactly one tool call.
5. **Explain your actions** — Write brief text explaining what you're about to do before each tool call.
6. **Wait for results** — After a tool call, you will receive the result in a <tool_result> block. Use it to decide your next action.

## Example Workflow

User: "Create a hello world program in Python and run it"

Your response should be:

I'll create a Python hello world program and run it.

<tool_call>
{"name": "createFile", "args": {"filePath": "hello.py", "content": "print(\\"Hello, World!\\")"}}
</tool_call>

(After receiving the result, continue:)

Now let me run it:

<tool_call>
{"name": "runTerminal", "args": {"command": "python3 hello.py"}}
</tool_call>

## Important Notes

- The user will be asked to confirm destructive actions (file edits, terminal commands)
- Read-only actions (readFile, searchCode, listFiles) execute immediately
- All file paths are relative to the workspace root
- If you're unsure about something, read the relevant files first
- Be concise in your explanations between tool calls

${context ? `\n## Workspace Context\n${context}` : ''}`;
}
