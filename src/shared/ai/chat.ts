import "server-only";

export type ChatRole = "user" | "assistant" | "system";
export type ChatMessage = { role: ChatRole; content: string };

function buildContextPrompt(documents: any[]): string {
  if (!documents?.length) return "";
  return (
    "\n\nКонтекст из загруженных документов:\n" +
    documents.map((doc: any) => `${doc.name}:\n${doc.content}`).join("\n\n")
  );
}

async function callOpenAICompatible(args: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
}): Promise<string> {
  const base = args.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error("OpenAI-compatible API error:", errorData);
    throw new Error("OpenAI-compatible API error");
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

async function callOllama(args: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
}): Promise<string> {
  const base = args.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error("Ollama API error:", errorData);
    throw new Error("Ollama API error");
  }

  const data = await response.json();
  return data?.message?.content ?? "";
}

export async function generateAssistantReply(args: {
  messages: ChatMessage[];
  documents?: any[];
}): Promise<string> {
  const context = buildContextPrompt(args.documents ?? []);
  const messages: ChatMessage[] = context
    ? [
        ...args.messages.slice(0, -1),
        { role: "user", content: (args.messages.at(-1)?.content ?? "") + context },
      ]
    : args.messages;

  // 1) OpenAI-compatible providers (OpenAI/OpenRouter/Groq/Together/etc.)
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const openaiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  if (openaiKey) {
    return await callOpenAICompatible({
      apiKey: openaiKey,
      baseUrl: openaiBaseUrl,
      model: openaiModel,
      messages,
    });
  }

  // 2) Ollama (local)
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
  const ollamaModel = process.env.OLLAMA_MODEL;
  if (ollamaBaseUrl && ollamaModel) {
    return await callOllama({ baseUrl: ollamaBaseUrl, model: ollamaModel, messages });
  }

  return "AI не настроен. Задай `OPENAI_API_KEY` (и при необходимости `OPENAI_BASE_URL`/`OPENAI_MODEL`) или `OLLAMA_BASE_URL` + `OLLAMA_MODEL`.";
}

