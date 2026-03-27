import { NextResponse, type NextRequest } from "next/server";

import { getAdminClient } from "@/shared/api/supabaseAdmin";
import { generateAssistantReply } from "@/shared/ai/chat";
import { streamOllamaChat } from "@/shared/ai/ollamaStream";
import { streamOpenAICompatibleChat } from "@/shared/ai/openaiStream";

export const runtime = "nodejs";

const ANON_LIMIT = 3;

function getAnonymousId(req: NextRequest): string | null {
  const anon = req.headers.get("x-anonymous-id");
  return anon && anon.trim().length > 0 ? anon : null;
}

export async function POST(req: NextRequest) {
  const anonymousId = getAnonymousId(req);
  if (!anonymousId) {
    return NextResponse.json({ error: "X-Anonymous-ID header required" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const documents = Array.isArray(body?.documents) ? body.documents : [];
  const wantsStream = body?.stream === true;

  if (!content) return NextResponse.json({ error: "Message content is required" }, { status: 400 });

  const supabaseAdmin = getAdminClient();

  // Check quota
  const { data: existing } = await supabaseAdmin
    .from("anonymous_usage")
    .select("count")
    .eq("anonymous_id", anonymousId)
    .maybeSingle();

  const currentCount = (existing as any)?.count ?? 0;
  if (currentCount >= ANON_LIMIT) {
    return NextResponse.json({ error: "Anonymous limit exceeded" }, { status: 429 });
  }

  // Increment usage
  const newCount = currentCount + 1;
  await supabaseAdmin.from("anonymous_usage").upsert(
    {
      anonymous_id: anonymousId,
      count: newCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "anonymous_id" },
  );

  // Build prompt context (optional)
  try {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
    const ollamaModel = process.env.OLLAMA_MODEL;
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiBaseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const openaiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const contextPrompt =
      documents.length > 0
        ? "\n\nКонтекст из загруженных документов:\n" +
          documents.map((doc: any) => `${doc.name}:\n${doc.content}`).join("\n\n")
        : "";

    if (wantsStream && ollamaBaseUrl && ollamaModel) {
      const encoder = new TextEncoder();
      let assistantContent = "";

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: any) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          try {
            send("start", { count: newCount, limit: ANON_LIMIT });

            assistantContent = await streamOllamaChat({
              baseUrl: ollamaBaseUrl,
              model: ollamaModel,
              messages: [{ role: "user", content: content + contextPrompt }],
              signal: req.signal,
              handlers: {
                onDelta: (delta) => send("delta", { delta }),
              },
            });

            send("done", { content: assistantContent, count: newCount, limit: ANON_LIMIT });
            controller.close();
          } catch (e: any) {
            send("error", { error: e?.message ?? "AI call failed" });
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    if (wantsStream && openaiKey) {
      const encoder = new TextEncoder();
      let assistantContent = "";

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: any) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          try {
            send("start", { count: newCount, limit: ANON_LIMIT });

            assistantContent = await streamOpenAICompatibleChat({
              apiKey: openaiKey,
              baseUrl: openaiBaseUrl,
              model: openaiModel,
              messages: [{ role: "user", content: content + contextPrompt }],
              signal: req.signal,
              handlers: {
                onDelta: (delta) => send("delta", { delta }),
              },
            });

            send("done", { content: assistantContent, count: newCount, limit: ANON_LIMIT });
            controller.close();
          } catch (e: any) {
            send("error", { error: e?.message ?? "AI call failed" });
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const assistantContent = await generateAssistantReply({
      messages: [{ role: "user", content }],
      documents,
    });

    return NextResponse.json({
      content: assistantContent || "Пустой ответ от модели.",
      count: newCount,
      limit: ANON_LIMIT,
    });
  } catch (e) {
    console.error("AI call failed:", e);
    return NextResponse.json({ error: "AI call failed" }, { status: 502 });
  }
}

