import * as vscode from 'vscode';
import { getLLMClient } from './languageModel';
import { getConfig } from '../config/settings';

export function registerInlineCompletionProvider(
  extensionContext: vscode.ExtensionContext
): vscode.Disposable {
  const provider = new AICoderInlineCompletionProvider();
  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );
  extensionContext.subscriptions.push(disposable);
  return disposable;
}

class AICoderInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRequestAbort: AbortController | undefined;

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = getConfig();
    if (!config.autocomplete.enabled) return undefined;

    this.lastRequestAbort?.abort();
    this.lastRequestAbort = new AbortController();
    const signal = this.lastRequestAbort.signal;

    await new Promise<void>((resolve) => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(resolve, config.autocomplete.debounceMs);
    });

    if (token.isCancellationRequested || signal.aborted) return undefined;

    const prefix = getPrefix(document, position, 2000);
    const suffix = getSuffix(document, position, 500);

    if (prefix.trim().length < 3) return undefined;

    token.onCancellationRequested(() => this.lastRequestAbort?.abort());

    try {
      const client = getLLMClient();
      const completion = await client.complete(
        {
          prompt: prefix,
          suffix: suffix || undefined,
          maxTokens: 256,
          temperature: 0.2,
          stop: ['\n\n\n', '```'],
        },
        signal
      );

      if (!completion || token.isCancellationRequested) return undefined;

      const cleaned = cleanCompletion(completion);
      if (!cleaned) return undefined;

      return [
        new vscode.InlineCompletionItem(
          cleaned,
          new vscode.Range(position, position)
        ),
      ];
    } catch {
      return undefined;
    }
  }
}

function getPrefix(document: vscode.TextDocument, position: vscode.Position, maxChars: number): string {
  const offset = document.offsetAt(position);
  const start = Math.max(0, offset - maxChars);
  const startPos = document.positionAt(start);
  return document.getText(new vscode.Range(startPos, position));
}

function getSuffix(document: vscode.TextDocument, position: vscode.Position, maxChars: number): string {
  const offset = document.offsetAt(position);
  const endOffset = Math.min(document.getText().length, offset + maxChars);
  const endPos = document.positionAt(endOffset);
  return document.getText(new vscode.Range(position, endPos));
}

function cleanCompletion(text: string): string {
  let cleaned = text.replace(/```[\s\S]*$/, '').trimEnd();
  if (cleaned.startsWith('\n') && !cleaned.startsWith('\n\n')) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}
