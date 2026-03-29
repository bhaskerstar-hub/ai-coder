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

You have access to the user's code and workspace. When asked to edit code, provide clear, working solutions.

Rules:
- When showing code changes, use markdown code blocks with the language identifier
- Be concise but thorough
- If the user asks you to edit code, show the complete updated code
- Reference specific file paths and line numbers when relevant
- If you're unsure about something, say so rather than guessing

${context ? `\n## Workspace Context\n${context}` : ''}`;
}
