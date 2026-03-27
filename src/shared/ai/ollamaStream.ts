import "server-only";

import type { ChatMessage } from "@/shared/ai/chat";

export type OllamaStreamHandlers = {
  onDelta: (delta: string) => void;
};

export async function streamOllamaChat(args: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  handlers: OllamaStreamHandlers;
}) {
  const base = args.baseUrl.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: args.model,
        messages: args.messages,
        stream: true,
      }),
      signal: args.signal,
    });
  } catch (e: any) {
    // If aborted, return what we have (empty string)
    if (args.signal?.aborted) return "";
    throw e;
  }

  if (!response.ok || !response.body) {
    const errorData = await response.json().catch(() => ({}));
    console.error("Ollama stream error:", errorData);
    throw new Error("Ollama stream error");
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

      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        const obj = JSON.parse(line);
        const delta = obj?.message?.content;
        if (typeof delta === "string" && delta.length > 0) {
          full += delta;
          args.handlers.onDelta(delta);
        }
        if (obj?.done) {
          return full;
        }
      }
    }
  } catch (e: any) {
    if (args.signal?.aborted) return full;
    throw e;
  }

  return full;
}

