import * as vscode from 'vscode';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Reusable tool implementations (called by both VS Code LM tools AND agentLoop)
// ---------------------------------------------------------------------------

export function resolveWorkspacePath(relativePath: string): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return vscode.Uri.joinPath(folders[0].uri, relativePath);
}

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0].uri.fsPath;
}

export async function toolReadFile(args: {
  filePath: string;
  startLine?: number;
  endLine?: number;
}): Promise<string> {
  const uri = resolveWorkspacePath(args.filePath);
  if (!uri) return 'Error: No workspace folder open';

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    let content: string;

    if (args.startLine !== undefined && args.endLine !== undefined) {
      const start = Math.max(0, args.startLine - 1);
      const end = Math.min(doc.lineCount, args.endLine);
      content = doc.getText(new vscode.Range(start, 0, end, 0));
    } else {
      content = doc.getText();
    }

    const relativePath = vscode.workspace.asRelativePath(uri);
    return `File: ${relativePath}\n\`\`\`${doc.languageId}\n${content}\n\`\`\``;
  } catch {
    return `Error: Could not read file "${args.filePath}"`;
  }
}

export async function toolEditFile(args: {
  filePath: string;
  oldText: string;
  newText: string;
}): Promise<string> {
  const uri = resolveWorkspacePath(args.filePath);
  if (!uri) return 'Error: No workspace folder open';

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const fullText = doc.getText();
    const idx = fullText.indexOf(args.oldText);

    if (idx === -1) {
      return `Error: Could not find the specified text in "${args.filePath}". The oldText must match exactly.`;
    }

    const startPos = doc.positionAt(idx);
    const endPos = doc.positionAt(idx + args.oldText.length);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(startPos, endPos), args.newText);
    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
      await doc.save();
      return `Successfully edited "${args.filePath}"`;
    }
    return `Error: Failed to apply edit to "${args.filePath}"`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return `Error editing "${args.filePath}": ${msg}`;
  }
}

export async function toolCreateFile(args: {
  filePath: string;
  content: string;
}): Promise<string> {
  const uri = resolveWorkspacePath(args.filePath);
  if (!uri) return 'Error: No workspace folder open';

  try {
    const dirPath = args.filePath.includes('/')
      ? args.filePath.substring(0, args.filePath.lastIndexOf('/'))
      : '';
    if (dirPath) {
      const dirUri = resolveWorkspacePath(dirPath);
      if (dirUri) await vscode.workspace.fs.createDirectory(dirUri);
    }

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(args.content));

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

    return `Successfully created "${args.filePath}"`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return `Error creating "${args.filePath}": ${msg}`;
  }
}

export async function toolSearchCode(args: {
  pattern: string;
  glob?: string;
  maxResults?: number;
}): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) return 'Error: No workspace folder open';

  const limit = args.maxResults || 20;

  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    const rgArgs = ['--no-heading', '--line-number', '--max-count', String(limit)];
    if (args.glob) rgArgs.push('--glob', args.glob);
    rgArgs.push('--', args.pattern);

    const output = execSync(`rg ${rgArgs.map(a => `'${a}'`).join(' ')}`, {
      cwd: root,
      timeout: 10000,
      maxBuffer: 512 * 1024,
      encoding: 'utf-8',
    });

    const lines = output.trim().split('\n').filter(Boolean).slice(0, limit);
    if (lines.length === 0) return `No results found for pattern: ${args.pattern}`;
    return `Found ${lines.length} matches:\n${lines.join('\n')}`;
  } catch (err: unknown) {
    const execErr = err as { status?: number; message?: string };
    if (execErr.status === 1) return `No results found for pattern: ${args.pattern}`;
    return `Search error: ${execErr.message || 'Unknown error'}`;
  }
}

export async function toolListFiles(args: {
  directory?: string;
  glob?: string;
}): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return 'Error: No workspace folder open';

  const searchDir = args.directory
    ? vscode.Uri.joinPath(folders[0].uri, args.directory)
    : folders[0].uri;
  const pattern = args.glob || '**/*';

  try {
    const relativePattern = new vscode.RelativePattern(searchDir, pattern);
    const files = await vscode.workspace.findFiles(relativePattern, '**/node_modules/**', 200);
    const paths = files.map(f => vscode.workspace.asRelativePath(f)).sort();
    return `Found ${paths.length} files:\n${paths.join('\n')}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return `Error listing files: ${msg}`;
  }
}

export async function toolRunTerminal(args: {
  command: string;
  cwd?: string;
}): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) return 'Error: No workspace folder open';

  const workingDir = args.cwd ? path.join(root, args.cwd) : root;

  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    const output = execSync(args.command, {
      cwd: workingDir,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf-8',
    });
    return `Command: ${args.command}\nOutput:\n${output}`;
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; stdout?: string; message?: string };
    const stderr = execErr.stderr || '';
    const stdout = execErr.stdout || '';
    return `Command failed: ${args.command}\n${stderr ? `stderr: ${stderr}\n` : ''}${stdout ? `stdout: ${stdout}` : execErr.message || 'Unknown error'}`;
  }
}

// ---------------------------------------------------------------------------
// VS Code LanguageModelTool registrations (thin wrappers around the above)
// ---------------------------------------------------------------------------

function wrapResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

export function registerTools(extensionContext: vscode.ExtensionContext): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(vscode.lm.registerTool('aicoder_readFile', {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<{ filePath: string; startLine?: number; endLine?: number }>) {
      return wrapResult(await toolReadFile(options.input));
    },
  }));

  disposables.push(vscode.lm.registerTool('aicoder_editFile', {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<{ filePath: string; oldText: string; newText: string }>) {
      return wrapResult(await toolEditFile(options.input));
    },
  }));

  disposables.push(vscode.lm.registerTool('aicoder_searchCode', {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<{ pattern: string; glob?: string; maxResults?: number }>) {
      return wrapResult(await toolSearchCode(options.input));
    },
  }));

  disposables.push(vscode.lm.registerTool('aicoder_listFiles', {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<{ directory?: string; glob?: string }>) {
      return wrapResult(await toolListFiles(options.input));
    },
  }));

  disposables.push(vscode.lm.registerTool('aicoder_runTerminal', {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<{ command: string; cwd?: string }>) {
      return wrapResult(await toolRunTerminal(options.input));
    },
  }));

  extensionContext.subscriptions.push(...disposables);
  return disposables;
}
