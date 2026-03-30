# AI Coder — VS Code Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An AI coding assistant for VS Code with chat panel, inline editing, Tab autocomplete, and agent mode with tool use.

> **Disclaimer:** This is an open-source tool provided "as is" with no warranty. AI-generated code may contain errors — always review before use. See [LICENSE](LICENSE) for full terms and disclaimers.

## Features

| Feature | Keybinding | Description |
|---------|-----------|-------------|
| **Chat Panel** | `Cmd+L` | AI chat with full codebase awareness |
| **Inline Edit** | `Cmd+K` | Select code, ask AI to edit it in place |
| **Tab Autocomplete** | `Tab` | Intelligent ghost-text code completions |
| **Agent Tools** | Via chat | AI can read/edit files, run commands, search code |
| **Multi-Provider** | Settings | Ollama (local), OpenAI, Anthropic, Google |

## Quick Start

### 1. Install the Extension

```bash
cd ai-coder
npm install
npm run compile

# Install in VS Code
code --install-extension ai-coder-0.1.0.vsix
# OR during development:
# Press F5 in VS Code to launch Extension Development Host
```

### 2. Configure a Provider

Open VS Code Settings (`Cmd+,`) and search for "AI Coder".

**Local (Ollama — free, private):**
```
aiCoder.provider: "ollama"
aiCoder.ollama.chatModel: "llama3.2"
aiCoder.ollama.completionModel: "codellama:7b-code"
```

Make sure Ollama is running: `ollama serve`

**OpenAI:**
```
aiCoder.provider: "openai"
aiCoder.openai.apiKey: "sk-..."
aiCoder.openai.model: "gpt-4o"
```

**Anthropic:**
```
aiCoder.provider: "anthropic"
aiCoder.anthropic.apiKey: "sk-ant-..."
aiCoder.anthropic.model: "claude-sonnet-4-20250514"
```

**Google:**
```
aiCoder.provider: "google"
aiCoder.google.apiKey: "..."
aiCoder.google.model: "gemini-2.5-pro"
```

### 3. Use It

- **Chat:** Press `Cmd+L` or click the chat icon in the sidebar, then type `@ai` followed by your question
- **Inline Edit:** Select code in the editor, press `Cmd+K`, type what you want changed
- **Autocomplete:** Just type — ghost text appears after a short delay. Press `Tab` to accept
- **Reindex:** Run `AI Coder: Reindex Workspace` from the Command Palette

## Architecture

```
src/
  extension.ts                 # Entry point — registers all providers
  providers/
    chatParticipant.ts         # Chat panel + inline chat handler
    inlineCompletion.ts        # Tab autocomplete (ghost text)
    languageModel.ts           # Multi-backend LLM client (Ollama/OpenAI/Anthropic/Google)
  agent/
    tools.ts                   # Agent tools: edit file, read file, run terminal, search, list files
  context/
    indexer.ts                 # Workspace file indexer with keyword search
    references.ts              # Context gathering (active file, open files, selections)
  config/
    settings.ts                # Extension settings reader
  utils/
    streaming.ts               # SSE/streaming helpers for LLM APIs
    diff.ts                    # Simple diff computation
```

## Development

```bash
# Watch mode (recompiles on save)
npm run watch

# Press F5 in VS Code to launch Extension Development Host

# Package for distribution
npx @vscode/vsce package
```

## How It Maps to AI IDE Features

- **Chat Panel (Cmd+L):** Uses VS Code's `ChatParticipant` API — the extension registers as `@ai` in the built-in chat panel. It streams responses from your configured LLM.
- **Inline Edit (Cmd+K):** Leverages VS Code's built-in inline chat. Same chat participant handles both panel and inline requests.
- **Tab Autocomplete:** `InlineCompletionItemProvider` with debouncing, fill-in-the-middle prompting, and configurable model.
- **Agent Tools:** `LanguageModelTool` registrations for file operations, terminal, and search. These are available to the LLM during chat.
- **Codebase Context:** Active file, open files, and selected text are automatically injected into every prompt. The workspace indexer provides keyword-based retrieval.

## Privacy

- **Ollama (default):** All processing stays on your machine. No data leaves your device.
- **Cloud providers (OpenAI, Anthropic, Google):** Your code and prompts are sent to external servers. Do not send confidential or proprietary code to cloud providers without proper authorization. Review each provider's terms of service and privacy policy before use.

## Disclaimer

This software is provided under the [MIT License](LICENSE) with additional disclaimers. Key points:

- **No warranty.** The software is provided "as is" without any guarantees.
- **AI output is not verified.** You are responsible for reviewing and testing all AI-generated code.
- **Third-party services.** This extension is not affiliated with or endorsed by Microsoft, Ollama, OpenAI, Anthropic, or Google.
- **Your responsibility.** You are solely responsible for how you use the software and any AI-generated output.

See the [LICENSE](LICENSE) file for the complete terms, disclaimers, and additional notices.

## License

[MIT](LICENSE) — Copyright (c) 2026 Bhasker Chaurasia
