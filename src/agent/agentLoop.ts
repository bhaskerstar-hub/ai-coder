import * as vscode from 'vscode';
import { LLMMessage } from '../utils/streaming';
import { LLMClient } from '../providers/languageModel';
import { ToolCall, executeTool } from './toolExecutor';

const DEFAULT_MAX_ITERATIONS = 10;

export interface AgentLoopParams {
  messages: LLMMessage[];
  response: vscode.ChatResponseStream;
  client: LLMClient;
  signal: AbortSignal;
  modelOverride?: string;
  maxIterations?: number;
}

/**
 * Runs the agent loop: stream from LLM, detect <tool_call> blocks,
 * execute them, feed results back, and repeat until the LLM produces
 * a final answer with no tool calls.
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
  const {
    messages,
    response,
    client,
    signal,
    modelOverride,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = params;

  const conversationMessages = [...messages];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    let fullText = '';

    try {
      for await (const chunk of client.streamChat(
        { messages: conversationMessages, modelOverride },
        signal
      )) {
        if (signal.aborted) return;

        // Stream non-tool text to the user immediately
        // We accumulate everything and filter tool_call blocks later
        fullText += chunk;

        // Stream text that's clearly before any tool_call
        const toolStart = fullText.indexOf('<tool_call>');
        if (toolStart === -1) {
          response.markdown(chunk);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      throw err;
    }

    // Parse tool calls from the response
    const { textParts, toolCalls } = parseResponse(fullText);

    // If no tool calls, output any remaining text and we're done
    if (toolCalls.length === 0) {
      // The text was already streamed above (when toolStart was -1 the whole time)
      break;
    }

    // There were tool calls — output the text before the first tool_call
    // that wasn't already streamed
    const firstToolIdx = fullText.indexOf('<tool_call>');
    if (firstToolIdx > 0) {
      // We already streamed chars up to the point where <tool_call> appeared.
      // But we streamed them character-by-character above, so the user already
      // saw the leading text. Now show any trailing text between tool calls.
    }

    // Show text parts between tool calls
    for (const text of textParts) {
      if (text.trim()) {
        response.markdown(text);
      }
    }

    // Execute each tool call
    conversationMessages.push({ role: 'assistant', content: fullText });

    const toolResults: string[] = [];
    for (const call of toolCalls) {
      if (signal.aborted) return;
      const result = await executeTool(call, response);
      toolResults.push(`<tool_result name="${call.name}">\n${result.result}\n</tool_result>`);
    }

    // Feed all tool results back as a user message
    conversationMessages.push({
      role: 'user',
      content: toolResults.join('\n\n'),
    });
  }

  if (iteration >= maxIterations) {
    response.markdown(
      `\n\n*Reached maximum of ${maxIterations} tool calls. If more work is needed, send another message.*`
    );
  }
}

interface ParsedResponse {
  textParts: string[];
  toolCalls: ToolCall[];
}

function parseResponse(text: string): ParsedResponse {
  const toolCalls: ToolCall[] = [];
  const textParts: string[] = [];

  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before this tool call
    if (match.index > lastIndex) {
      textParts.push(text.slice(lastIndex, match.index));
    }
    lastIndex = match.index + match[0].length;

    // Parse the JSON inside
    try {
      const raw = match[1].trim();
      const parsed = JSON.parse(raw) as { name?: string; args?: Record<string, unknown> };
      if (parsed.name) {
        toolCalls.push({
          name: parsed.name,
          args: parsed.args || {},
        });
      }
    } catch {
      // Malformed tool call — skip it and include as text
      textParts.push(match[0]);
    }
  }

  // Text after last tool call
  if (lastIndex < text.length) {
    textParts.push(text.slice(lastIndex));
  }

  return { textParts, toolCalls };
}
