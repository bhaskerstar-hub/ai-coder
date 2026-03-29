import * as vscode from 'vscode';
import * as path from 'path';

export function registerTools(extensionContext: vscode.ExtensionContext): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.lm.registerTool('aicoder_readFile', new ReadFileTool())
  );
  disposables.push(
    vscode.lm.registerTool('aicoder_editFile', new EditFileTool())
  );
  disposables.push(
    vscode.lm.registerTool('aicoder_searchCode', new SearchCodeTool())
  );
  disposables.push(
    vscode.lm.registerTool('aicoder_listFiles', new ListFilesTool())
  );
  disposables.push(
    vscode.lm.registerTool('aicoder_runTerminal', new RunTerminalTool())
  );

  extensionContext.subscriptions.push(...disposables);
  return disposables;
}

function resolveWorkspacePath(relativePath: string): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return vscode.Uri.joinPath(folders[0].uri, relativePath);
}

class ReadFileTool implements vscode.LanguageModelTool<{ filePath: string; startLine?: number; endLine?: number }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ filePath: string; startLine?: number; endLine?: number }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { filePath, startLine, endLine } = options.input;
    const uri = resolveWorkspacePath(filePath);
    if (!uri) {
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Error: No workspace folder open')]);
    }

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      let content: string;

      if (startLine !== undefined && endLine !== undefined) {
        const start = Math.max(0, startLine - 1);
        const end = Math.min(doc.lineCount, endLine);
        const range = new vscode.Range(start, 0, end, 0);
        content = doc.getText(range);
      } else {
        content = doc.getText();
      }

      const relativePath = vscode.workspace.asRelativePath(uri);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`File: ${relativePath}\n\`\`\`${doc.languageId}\n${content}\n\`\`\``),
      ]);
    } catch {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error: Could not read file "${filePath}"`),
      ]);
    }
  }
}

class EditFileTool implements vscode.LanguageModelTool<{ filePath: string; oldText: string; newText: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ filePath: string; oldText: string; newText: string }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { filePath, oldText, newText } = options.input;
    const uri = resolveWorkspacePath(filePath);
    if (!uri) {
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Error: No workspace folder open')]);
    }

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const fullText = doc.getText();
      const idx = fullText.indexOf(oldText);

      if (idx === -1) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Error: Could not find the specified text in "${filePath}". The oldText must match exactly.`),
        ]);
      }

      const startPos = doc.positionAt(idx);
      const endPos = doc.positionAt(idx + oldText.length);
      const range = new vscode.Range(startPos, endPos);

      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, range, newText);
      const success = await vscode.workspace.applyEdit(edit);

      if (success) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Successfully edited "${filePath}"`),
        ]);
      } else {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Error: Failed to apply edit to "${filePath}"`),
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error editing "${filePath}": ${msg}`),
      ]);
    }
  }
}

class SearchCodeTool implements vscode.LanguageModelTool<{ pattern: string; glob?: string; maxResults?: number }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ pattern: string; glob?: string; maxResults?: number }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { pattern, glob, maxResults } = options.input;
    const limit = maxResults || 20;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Error: No workspace folder open')]);
    }

    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      const args = ['--no-heading', '--line-number', '--max-count', String(limit)];
      if (glob) {
        args.push('--glob', glob);
      }
      args.push('--', pattern);

      const output = execSync(`rg ${args.map(a => `'${a}'`).join(' ')}`, {
        cwd: folders[0].uri.fsPath,
        timeout: 10000,
        maxBuffer: 512 * 1024,
        encoding: 'utf-8',
      });

      const lines = output.trim().split('\n').filter(Boolean).slice(0, limit);
      if (lines.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`No results found for pattern: ${pattern}`),
        ]);
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Found ${lines.length} matches:\n${lines.join('\n')}`),
      ]);
    } catch (err: unknown) {
      const execErr = err as { status?: number; stdout?: string; message?: string };
      if (execErr.status === 1) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`No results found for pattern: ${pattern}`),
        ]);
      }
      const msg = execErr.message || 'Unknown error';
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Search error: ${msg}`),
      ]);
    }
  }
}

class ListFilesTool implements vscode.LanguageModelTool<{ directory?: string; glob?: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ directory?: string; glob?: string }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { directory, glob } = options.input;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Error: No workspace folder open')]);
    }

    const searchDir = directory
      ? vscode.Uri.joinPath(folders[0].uri, directory)
      : folders[0].uri;
    const pattern = glob || '**/*';

    try {
      const relativePattern = new vscode.RelativePattern(searchDir, pattern);
      const files = await vscode.workspace.findFiles(relativePattern, '**/node_modules/**', 200);
      const paths = files
        .map((f) => vscode.workspace.asRelativePath(f))
        .sort();

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Found ${paths.length} files:\n${paths.join('\n')}`),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error listing files: ${msg}`),
      ]);
    }
  }
}

class RunTerminalTool implements vscode.LanguageModelTool<{ command: string; cwd?: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ command: string; cwd?: string }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { command, cwd } = options.input;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Error: No workspace folder open')]);
    }

    const workingDir = cwd
      ? path.join(folders[0].uri.fsPath, cwd)
      : folders[0].uri.fsPath;

    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      const output = execSync(command, {
        cwd: workingDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
      });

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Command: ${command}\nOutput:\n${output}`),
      ]);
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; stdout?: string; message?: string };
      const stderr = execErr.stderr || '';
      const stdout = execErr.stdout || '';
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Command failed: ${command}\n${stderr ? `stderr: ${stderr}\n` : ''}${stdout ? `stdout: ${stdout}` : execErr.message || 'Unknown error'}`
        ),
      ]);
    }
  }
}
