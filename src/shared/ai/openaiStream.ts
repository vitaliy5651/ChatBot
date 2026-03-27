import "server-only";

import type { OpenAICompatibleMessage } from "@/shared/ai/openaiMessages";

export type OpenAIStreamHandlers = {
  onDelta: (delta: string) => void;
};

export async function streamOpenAICompatibleChat(args: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: OpenAICompatibleMessage[];
  signal?: AbortSignal;
  handlers: OpenAIStreamHandlers;
}): Promise<string> {
  const base = args.baseUrl.replace(/\/$/, "");
  const maxTokensRaw = process.env.OPENAI_MAX_TOKENS;
  const max_tokens = maxTokensRaw ? Number(maxTokensRaw) : undefined;

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      stream: true,
      ...(Number.isFinite(max_tokens) ? { max_tokens } : null),
    }),
    signal: args.signal,
  });

  if (!response.ok || !response.body) {
    const errorData = await response.json().catch(() => ({}));
    console.error("OpenAI-compatible stream error:", errorData);
    throw new Error("OpenAI-compatible stream error");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Provider stream is SSE: lines like "data: {...}\n\n"
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const lines = chunk.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice("data:".length).trim();
          if (!dataStr) continue;
          if (dataStr === "[DONE]") return full;

          const obj = JSON.parse(dataStr);
          const delta = obj?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            full += delta;
            args.handlers.onDelta(delta);
          }
        }
      }
    }
  } catch (e: any) {
    if (args.signal?.aborted) return full;
    throw e;
  }

  return full;
}

