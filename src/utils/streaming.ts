export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMStreamChunk {
  text: string;
  done: boolean;
}

export interface LLMCompletionRequest {
  prompt: string;
  suffix?: string;
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface LLMChatRequest {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  modelOverride?: string;
}

export type StreamCallback = (chunk: LLMStreamChunk) => void;

export async function fetchSSE(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  onChunk: StreamCallback,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(`LLM API error ${response.status}: ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body stream');
  }

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
      if (!trimmed) continue;

      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          onChunk({ text: '', done: true });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          yield_parsed_chunk(parsed, onChunk);
        } catch {
          // non-JSON line, skip
        }
      } else {
        try {
          const parsed = JSON.parse(trimmed);
          yield_parsed_chunk(parsed, onChunk);
        } catch {
          // not JSON
        }
      }
    }
  }

  onChunk({ text: '', done: true });
}

function yield_parsed_chunk(parsed: Record<string, unknown>, onChunk: StreamCallback): void {
  // OpenAI / Anthropic style
  if (parsed.choices && Array.isArray(parsed.choices)) {
    const choice = parsed.choices[0] as Record<string, unknown>;
    const delta = choice.delta as Record<string, unknown> | undefined;
    const text = (delta?.content as string) || '';
    const done = choice.finish_reason !== null && choice.finish_reason !== undefined;
    if (text) onChunk({ text, done });
    if (done) onChunk({ text: '', done: true });
    return;
  }

  // Ollama style
  if ('message' in parsed) {
    const msg = parsed.message as Record<string, unknown>;
    const text = (msg.content as string) || '';
    const done = parsed.done === true;
    if (text) onChunk({ text, done });
    if (done) onChunk({ text: '', done: true });
    return;
  }

  // Ollama generate style
  if ('response' in parsed) {
    const text = (parsed.response as string) || '';
    const done = parsed.done === true;
    if (text) onChunk({ text, done });
    if (done) onChunk({ text: '', done: true });
  }
}
