import { getConfig, LLMProvider } from '../config/settings';
import {
  LLMMessage,
  LLMStreamChunk,
  LLMChatRequest,
  LLMCompletionRequest,
  StreamCallback,
  fetchSSE,
} from '../utils/streaming';

export class LLMClient {
  async *streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    const config = getConfig();
    const chunks: LLMStreamChunk[] = [];
    let resolveNext: ((value: IteratorResult<string>) => void) | null = null;
    let done = false;

    const onChunk: StreamCallback = (chunk) => {
      if (chunk.done) {
        done = true;
        if (resolveNext) resolveNext({ value: '', done: true });
        return;
      }
      if (resolveNext) {
        resolveNext({ value: chunk.text, done: false });
        resolveNext = null;
      } else {
        chunks.push(chunk);
      }
    };

    const streamPromise = this.dispatchChat(config.provider, request, onChunk, signal);
    streamPromise.catch((err) => {
      done = true;
      if (resolveNext) resolveNext({ value: '', done: true });
      throw err;
    });

    while (!done) {
      if (chunks.length > 0) {
        const chunk = chunks.shift()!;
        yield chunk.text;
      } else {
        const result: IteratorResult<string> = await new Promise((resolve) => {
          resolveNext = resolve;
        });
        if (result.done) break;
        yield result.value;
      }
    }
  }

  async chatComplete(request: LLMChatRequest, signal?: AbortSignal): Promise<string> {
    let result = '';
    for await (const chunk of this.streamChat(request, signal)) {
      result += chunk;
    }
    return result;
  }

  async complete(request: LLMCompletionRequest, signal?: AbortSignal): Promise<string> {
    const config = getConfig();
    if (config.provider === 'ollama') {
      return this.ollamaGenerate(request, signal);
    }
    // For non-Ollama providers, wrap as chat
    const messages: LLMMessage[] = [];
    if (request.suffix) {
      messages.push({
        role: 'system',
        content: 'You are a code completion engine. Output ONLY the code that fills the gap. No explanations, no markdown.',
      });
      messages.push({
        role: 'user',
        content: `Complete the code between <prefix> and <suffix>:\n<prefix>\n${request.prompt}\n</prefix>\n<suffix>\n${request.suffix}\n</suffix>\n\nOutput ONLY the missing code:`,
      });
    } else {
      messages.push({
        role: 'system',
        content: 'You are a code completion engine. Output ONLY the code continuation. No explanations, no markdown.',
      });
      messages.push({ role: 'user', content: `Continue this code:\n${request.prompt}` });
    }
    return this.chatComplete(
      { messages, maxTokens: request.maxTokens || 256, temperature: request.temperature ?? 0.2 },
      signal
    );
  }

  private async ollamaGenerate(request: LLMCompletionRequest, signal?: AbortSignal): Promise<string> {
    const config = getConfig();
    const url = `${config.ollama.endpoint}/api/generate`;
    const body: Record<string, unknown> = {
      model: config.ollama.completionModel,
      prompt: request.prompt,
      stream: false,
      options: {
        num_predict: request.maxTokens || 256,
        temperature: request.temperature ?? 0.2,
        stop: request.stop,
      },
    };
    if (request.suffix) {
      body.suffix = request.suffix;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama generate error: ${response.status}`);
    }

    const data = (await response.json()) as { response: string };
    return data.response || '';
  }

  private async dispatchChat(
    provider: LLMProvider,
    request: LLMChatRequest,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const config = getConfig();

    switch (provider) {
      case 'ollama':
        return this.ollamaChat(config.ollama.endpoint, config.ollama.chatModel, request, onChunk, signal);
      case 'openai':
        return this.openaiChat(config.openai.baseUrl, config.openai.apiKey, config.openai.model, request, onChunk, signal);
      case 'anthropic':
        return this.anthropicChat(config.anthropic.apiKey, config.anthropic.model, request, onChunk, signal);
      case 'google':
        return this.googleChat(config.google.apiKey, config.google.model, request, onChunk, signal);
    }
  }

  private async ollamaChat(
    endpoint: string,
    model: string,
    request: LLMChatRequest,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const url = `${endpoint}/api/chat`;
    return fetchSSE(
      url,
      {
        model,
        messages: request.messages,
        stream: true,
        options: {
          num_predict: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
        },
      },
      {},
      onChunk,
      signal
    );
  }

  private async openaiChat(
    baseUrl: string,
    apiKey: string,
    model: string,
    request: LLMChatRequest,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    return fetchSSE(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: request.messages,
        stream: true,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
      },
      { Authorization: `Bearer ${apiKey}` },
      onChunk,
      signal
    );
  }

  private async anthropicChat(
    apiKey: string,
    model: string,
    request: LLMChatRequest,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const systemMsg = request.messages.find((m) => m.role === 'system');
    const nonSystemMsgs = request.messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
    };
    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const url = 'https://api.anthropic.com/v1/messages';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Anthropic API error ${response.status}: ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        try {
          const event = JSON.parse(data) as Record<string, unknown>;
          if (event.type === 'content_block_delta') {
            const delta = event.delta as Record<string, unknown>;
            if (delta.type === 'text_delta') {
              onChunk({ text: delta.text as string, done: false });
            }
          } else if (event.type === 'message_stop') {
            onChunk({ text: '', done: true });
            return;
          }
        } catch {
          // skip
        }
      }
    }

    onChunk({ text: '', done: true });
  }

  private async googleChat(
    apiKey: string,
    model: string,
    request: LLMChatRequest,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const systemMsg = request.messages.find((m) => m.role === 'system');
    const nonSystemMsgs = request.messages.filter((m) => m.role !== 'system');

    const contents = nonSystemMsgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
      },
    };
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
    return fetchSSE(url, body, {}, (chunk) => {
      onChunk(chunk);
    }, signal);
  }
}

let _client: LLMClient | undefined;

export function getLLMClient(): LLMClient {
  if (!_client) {
    _client = new LLMClient();
  }
  return _client;
}
