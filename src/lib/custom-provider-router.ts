/**
 * Custom Provider Router — streaming proxy for user-supplied API keys
 *
 * Forwards chat requests to third-party LLM providers (OpenAI, Anthropic,
 * OpenRouter, etc.) using the user's own API key. The user's key is held
 * only in the request payload — never persisted server-side, never logged.
 *
 * Adapters:
 *   - OpenAI-compat: covers 17 of 18 providers. Standard {model, messages, stream}
 *     request body, Bearer auth (or x-api-key for some).
 *   - Anthropic: /v1/messages with x-api-key + anthropic-version header,
 *     separate system message, max_tokens required.
 *
 * The router returns a normalized ReadableStream of SSE events that the
 * existing /api/agent/stream route can pipe back to the client without
 * knowing which provider handled the call.
 */

import {
  getProviderById,
  type CustomProviderConfig,
  type CustomProviderId,
  type CustomModel,
} from "./custom-providers";

// ── Types matching what the agent stream route expects ──

export interface CustomChatRequest {
  provider: CustomProviderId;
  model: string;
  apiKey: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  // Tool calling support — passthrough for OpenAI-compat; ignored by Anthropic native (handled separately)
  tools?: any[];
}

export interface CustomChatChunk {
  type: "phase" | "delta" | "complete" | "error" | "tool_call";
  text?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: any[];
  error?: string;
}

// ── Errors ──

export class CustomProviderError extends Error {
  status: number;
  provider: CustomProviderId;
  constructor(message: string, status: number, provider: CustomProviderId) {
    super(message);
    this.status = status;
    this.provider = provider;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stream a chat completion from a custom provider. Returns a ReadableStream
 * that emits CustomChatChunk objects encoded as SSE-style lines.
 */
export function streamCustomChat(req: CustomChatRequest): ReadableStream<Uint8Array> {
  const provider = getProviderById(req.provider);
  if (!provider) {
    throw new CustomProviderError(`Unknown provider: ${req.provider}`, 400, req.provider);
  }
  if (!req.apiKey) {
    throw new CustomProviderError(`API key required for ${provider.name}`, 400, req.provider);
  }
  if (provider.format === "anthropic") {
    return streamAnthropicChat(provider, req);
  }
  return streamOpenAICompatChat(provider, req);
}

// ═══════════════════════════════════════════════════════════════════════════
// OpenAI-compatible adapter (17 providers)
// ═══════════════════════════════════════════════════════════════════════════

function buildOpenAIHeaders(provider: CustomProviderConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider.additionalHeaders) {
    Object.assign(headers, provider.additionalHeaders);
  }
  return headers;
}

function buildOpenAIBody(req: CustomChatRequest, model: CustomModel | null): any {
  const body: any = {
    model: req.model,
    messages: req.messages,
    stream: req.stream !== false,
  };
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.tools && model?.capabilities?.tools) body.tools = req.tools;
  return body;
}

async function* parseOpenAISSE(response: Response, provider: CustomProviderConfig): AsyncGenerator<CustomChatChunk> {
  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", error: "No response body from provider" };
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        yield { type: "complete", inputTokens, outputTokens };
        return;
      }
      try {
        const json = JSON.parse(payload);
        const choice = json.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) yield { type: "delta", text: delta };
        const toolCalls = choice?.delta?.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          yield { type: "tool_call", toolCalls };
        }
        if (json.usage) {
          inputTokens = json.usage.prompt_tokens ?? inputTokens;
          outputTokens = json.usage.completion_tokens ?? outputTokens;
        }
      } catch (err) {
        // Skip malformed SSE line
        continue;
      }
    }
  }
  yield { type: "complete", inputTokens, outputTokens };
}

function streamOpenAICompatChat(provider: CustomProviderConfig, req: CustomChatRequest): ReadableStream<Uint8Array> {
  const modelDef = provider.models.find((m) => m.id === req.model);
  const url = `${provider.baseUrl}${provider.chatPath}`;
  const headers = buildOpenAIHeaders(provider, req.apiKey);
  const body = buildOpenAIBody(req, modelDef ?? null);

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          let errMsg = `Provider returned ${response.status}`;
          try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message || errJson.message || errJson.detail || errMsg;
          } catch {}
          controller.enqueue(encodeChunk({ type: "error", error: errMsg }, encoder));
          controller.enqueue(encodeChunk({ type: "complete" }, encoder));
          controller.close();
          return;
        }
        for await (const chunk of parseOpenAISSE(response, provider)) {
          controller.enqueue(encodeChunk(chunk, encoder));
          if (chunk.type === "complete") break;
        }
        controller.close();
      } catch (err: any) {
        controller.enqueue(encodeChunk({ type: "error", error: err?.message || "Network error" }, encoder));
        controller.enqueue(encodeChunk({ type: "complete" }, encoder));
        controller.close();
      }
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Anthropic adapter
// ═══════════════════════════════════════════════════════════════════════════

function buildAnthropicHeaders(provider: CustomProviderConfig, apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": provider.additionalHeaders?.["anthropic-version"] ?? "2023-06-01",
  };
}

function buildAnthropicBody(req: CustomChatRequest, model: CustomModel | null): any {
  // Anthropic separates the system message from the conversation
  const systemParts: string[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      messages.push({ role: m.role as "user" | "assistant", content: m.content });
    }
  }
  const body: any = {
    model: req.model,
    messages,
    max_tokens: req.maxTokens ?? model?.maxTokens ?? 4_096,
    stream: true,
  };
  if (systemParts.length > 0) body.system = systemParts.join("\n\n");
  if (req.temperature !== undefined) body.temperature = req.temperature;
  return body;
}

async function* parseAnthropicSSE(response: Response): AsyncGenerator<CustomChatChunk> {
  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", error: "No response body from provider" };
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("event:")) {
        // Track event type for the next data line
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const json = JSON.parse(payload);
        // Anthropic event types: message_start, content_block_start, content_block_delta,
        // content_block_stop, message_delta, message_stop, error
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
          yield { type: "delta", text: json.delta.text };
        } else if (json.type === "message_delta" && json.usage) {
          outputTokens = json.usage.output_tokens ?? outputTokens;
        } else if (json.type === "message_start" && json.message?.usage) {
          inputTokens = json.message.usage.input_tokens ?? inputTokens;
        } else if (json.type === "error" || json.error) {
          yield { type: "error", error: json.error?.message || "Anthropic error" };
        }
      } catch {
        continue;
      }
    }
  }
  yield { type: "complete", inputTokens, outputTokens };
}

function streamAnthropicChat(provider: CustomProviderConfig, req: CustomChatRequest): ReadableStream<Uint8Array> {
  const modelDef = provider.models.find((m) => m.id === req.model);
  const url = `${provider.baseUrl}${provider.chatPath}`;
  const headers = buildAnthropicHeaders(provider, req.apiKey);
  const body = buildAnthropicBody(req, modelDef ?? null);

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          let errMsg = `Anthropic returned ${response.status}`;
          try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message || errMsg;
          } catch {}
          controller.enqueue(encodeChunk({ type: "error", error: errMsg }, encoder));
          controller.enqueue(encodeChunk({ type: "complete" }, encoder));
          controller.close();
          return;
        }
        for await (const chunk of parseAnthropicSSE(response)) {
          controller.enqueue(encodeChunk(chunk, encoder));
          if (chunk.type === "complete") break;
        }
        controller.close();
      } catch (err: any) {
        controller.enqueue(encodeChunk({ type: "error", error: err?.message || "Network error" }, encoder));
        controller.enqueue(encodeChunk({ type: "complete" }, encoder));
        controller.close();
      }
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function encodeChunk(chunk: CustomChatChunk, encoder: TextEncoder): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}
