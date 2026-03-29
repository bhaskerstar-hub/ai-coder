import * as vscode from 'vscode';
import * as path from 'path';

interface IndexedFile {
  relativePath: string;
  languageId: string;
  lastModified: number;
  chunks: FileChunk[];
}

interface FileChunk {
  content: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'block' | 'imports';
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next',
  '.vscode', '__pycache__', '.pytest_cache', 'venv', '.env',
  'coverage', '.nyc_output', 'vendor', 'target',
]);

const INDEXED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.swift', '.kt',
  '.scala', '.vue', '.svelte', '.html', '.css', '.scss',
  '.json', '.yaml', '.yml', '.toml', '.md',
]);

export class WorkspaceIndexer {
  private index = new Map<string, IndexedFile>();
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  async initialize(context: vscode.ExtensionContext): Promise<void> {
    await this.buildIndex();

    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.fileWatcher.onDidChange((uri) => this.reindexFile(uri));
    this.fileWatcher.onDidCreate((uri) => this.reindexFile(uri));
    this.fileWatcher.onDidDelete((uri) => {
      const relPath = vscode.workspace.asRelativePath(uri);
      this.index.delete(relPath);
    });
    context.subscriptions.push(this.fileWatcher);
  }

  async buildIndex(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    this.index.clear();
    const files = await vscode.workspace.findFiles(
      '**/*',
      `{${[...IGNORED_DIRS].map((d) => `**/${d}/**`).join(',')}}`,
      5000
    );

    for (const file of files) {
      const ext = path.extname(file.fsPath);
      if (!INDEXED_EXTENSIONS.has(ext)) continue;
      await this.indexFile(file);
    }
  }

  private async indexFile(uri: vscode.Uri): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const content = doc.getText();
      if (content.length > 200000) return;

      const relativePath = vscode.workspace.asRelativePath(uri);
      const chunks = this.chunkFile(content, doc.languageId);

      this.index.set(relativePath, {
        relativePath,
        languageId: doc.languageId,
        lastModified: Date.now(),
        chunks,
      });
    } catch {
      // skip unreadable files
    }
  }

  private async reindexFile(uri: vscode.Uri): Promise<void> {
    const ext = path.extname(uri.fsPath);
    if (!INDEXED_EXTENSIONS.has(ext)) return;
    await this.indexFile(uri);
  }

  private chunkFile(content: string, languageId: string): FileChunk[] {
    const lines = content.split('\n');
    const chunks: FileChunk[] = [];
    const chunkSize = 50;

    for (let i = 0; i < lines.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, lines.length);
      chunks.push({
        content: lines.slice(i, end).join('\n'),
        startLine: i + 1,
        endLine: end,
        type: 'block',
      });
    }

    return chunks;
  }

  searchByKeyword(query: string, maxResults: number = 10): { file: string; chunk: FileChunk; score: number }[] {
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: { file: string; chunk: FileChunk; score: number }[] = [];

    for (const [filePath, indexed] of this.index) {
      // Score file path relevance
      const pathScore = keywords.reduce(
        (s, kw) => s + (filePath.toLowerCase().includes(kw) ? 2 : 0),
        0
      );

      for (const chunk of indexed.chunks) {
        const lower = chunk.content.toLowerCase();
        let score = pathScore;
        for (const kw of keywords) {
          const idx = lower.indexOf(kw);
          if (idx !== -1) score += 3;
          const count = lower.split(kw).length - 1;
          score += Math.min(count, 5);
        }

        if (score > 0) {
          results.push({ file: filePath, chunk, score });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  getFileCount(): number {
    return this.index.size;
  }

  getIndexedFiles(): string[] {
    return [...this.index.keys()];
  }
}

let _indexer: WorkspaceIndexer | undefined;

export function getIndexer(): WorkspaceIndexer {
  if (!_indexer) {
    _indexer = new WorkspaceIndexer();
  }
  return _indexer;
}
