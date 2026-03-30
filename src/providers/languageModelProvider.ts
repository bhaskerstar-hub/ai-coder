import * as vscode from 'vscode';
import { listOllamaModels, invalidateCache } from './ollamaDiscovery';
import { getConfig } from '../config/settings';
import { fetchSSE, LLMMessage, StreamCallback } from '../utils/streaming';

const VENDOR_ID = 'aicoder';

export function registerLanguageModelProvider(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider = new OllamaLanguageModelProvider();
  const disposable = vscode.lm.registerLanguageModelChatProvider(VENDOR_ID, provider);
  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiCoder.ollama.endpoint')) {
        invalidateCache();
        provider.refreshModels();
      }
    })
  );

  provider.refreshModels();

  return disposable;
}

class OllamaLanguageModelProvider implements vscode.LanguageModelChatProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  async refreshModels(): Promise<void> {
    await listOllamaModels(true);
    this._onDidChange.fire();
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const models = await listOllamaModels();

    if (models.length === 0) {
      return [{
        id: 'ollama-unavailable',
        name: 'Ollama (not running)',
        family: 'ollama',
        version: '0',
        maxInputTokens: 4096,
        maxOutputTokens: 4096,
        capabilities: {},
      }];
    }

    return models.map((m) => {
      const family = m.name.split(':')[0];
      return {
        id: `ollama-${m.name}`,
        name: `Ollama: ${m.name}`,
        family,
        version: m.digest?.slice(0, 8) || '1',
        maxInputTokens: 8192,
        maxOutputTokens: 4096,
        capabilities: {},
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const ollamaModel = model.id.replace('ollama-', '');
    if (ollamaModel === 'unavailable') {
      progress.report(new vscode.LanguageModelTextPart(
        'Ollama is not running. Start it with `ollama serve` and pull a model.'
      ));
      return;
    }

    const config = getConfig();
    const endpoint = config.ollama.endpoint.replace(/\/$/, '');

    const llmMessages: LLMMessage[] = messages.map((msg) => ({
      role: msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' as const
        : msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' as const
        : 'system' as const,
      content: Array.isArray(msg.content)
        ? msg.content
            .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
            .map((p) => p.value)
            .join('')
        : String(msg.content),
    }));

    const abortController = new AbortController();
    token.onCancellationRequested(() => abortController.abort());

    const onChunk: StreamCallback = (chunk) => {
      if (chunk.text) {
        progress.report(new vscode.LanguageModelTextPart(chunk.text));
      }
    };

    await fetchSSE(
      `${endpoint}/api/chat`,
      {
        model: ollamaModel,
        messages: llmMessages,
        stream: true,
        options: {
          num_predict: 4096,
        },
      },
      {},
      onChunk,
      abortController.signal
    );
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const content = typeof text === 'string' ? text : '';
    return Math.ceil(content.length / 4);
  }
}
