import * as vscode from 'vscode';

export type LLMProvider = 'ollama' | 'openai' | 'anthropic' | 'google';

export interface AICoderConfig {
  provider: LLMProvider;
  ollama: {
    endpoint: string;
    chatModel: string;
    completionModel: string;
  };
  openai: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  anthropic: {
    apiKey: string;
    model: string;
  };
  google: {
    apiKey: string;
    model: string;
  };
  autocomplete: {
    enabled: boolean;
    debounceMs: number;
  };
  context: {
    maxFileSize: number;
    maxContextTokens: number;
  };
}

export function getConfig(): AICoderConfig {
  const cfg = vscode.workspace.getConfiguration('aiCoder');
  return {
    provider: cfg.get<LLMProvider>('provider', 'ollama'),
    ollama: {
      endpoint: cfg.get('ollama.endpoint', 'http://localhost:11434'),
      chatModel: cfg.get('ollama.chatModel', 'llama3'),
      completionModel: cfg.get('ollama.completionModel', 'phi3:mini'),
    },
    openai: {
      apiKey: cfg.get('openai.apiKey', ''),
      model: cfg.get('openai.model', 'gpt-4o'),
      baseUrl: cfg.get('openai.baseUrl', 'https://api.openai.com/v1'),
    },
    anthropic: {
      apiKey: cfg.get('anthropic.apiKey', ''),
      model: cfg.get('anthropic.model', 'claude-sonnet-4-20250514'),
    },
    google: {
      apiKey: cfg.get('google.apiKey', ''),
      model: cfg.get('google.model', 'gemini-2.5-pro'),
    },
    autocomplete: {
      enabled: cfg.get('autocomplete.enabled', true),
      debounceMs: cfg.get('autocomplete.debounceMs', 300),
    },
    context: {
      maxFileSize: cfg.get('context.maxFileSize', 100000),
      maxContextTokens: cfg.get('context.maxContextTokens', 8000),
    },
  };
}
