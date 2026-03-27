import "server-only";

import type { ChatMessage } from "@/shared/ai/chat";

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OpenAICompatibleMessage = {
  role: "user" | "assistant" | "system";
  content: string | OpenAIContentPart[];
};

async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function buildOpenAICompatibleMessages(args: {
  messages: ChatMessage[];
  documents?: any[];
  images?: Array<{ url: string; name?: string }>;
}): Promise<OpenAICompatibleMessage[]> {
  const docs = args.documents ?? [];
  const imgs = (args.images ?? []).filter((i) => typeof i?.url === "string" && i.url.length > 0).slice(0, 4);

  const contextPrompt =
    docs.length > 0
      ? "\n\nКонтекст из загруженных документов:\n" +
        docs.map((doc: any) => `${doc.name}:\n${doc.content}`).join("\n\n")
      : "";

  const baseMessages: OpenAICompatibleMessage[] = args.messages.map((m) => ({ role: m.role, content: m.content }));

  // Attach images to the LAST user message (typical chat UX).
  const lastIdx = [...baseMessages].reverse().findIndex((m) => m.role === "user");
  const idx = lastIdx === -1 ? -1 : baseMessages.length - 1 - lastIdx;
  if (idx === -1) return baseMessages;

  const last = baseMessages[idx];
  const text = String(last.content ?? "") + contextPrompt;
  const parts: OpenAIContentPart[] = [{ type: "text", text }];

  for (const img of imgs) {
    // Prefer data URLs so provider definitely can read it.
    const dataUrl = await imageUrlToDataUrl(img.url);
    if (dataUrl) {
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    } else {
      parts.push({ type: "text", text: `\n\n[Не удалось загрузить изображение: ${img.name ?? img.url}]` });
    }
  }

  baseMessages[idx] = { ...last, content: parts };
  return baseMessages;
}

