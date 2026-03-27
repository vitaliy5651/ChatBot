import { NextResponse, type NextRequest } from "next/server";

import { getAdminClient, getUserIdFromRequest } from "@/shared/api/supabaseAdmin";
import { generateAssistantReply } from "@/shared/ai/chat";
import { streamOllamaChat } from "@/shared/ai/ollamaStream";
import { streamOpenAICompatibleChat } from "@/shared/ai/openaiStream";
import { makeChatTitleFromMessage } from "@/shared/lib/chatTitle";

export const runtime = "nodejs";

async function chatBelongsToUser(chatId: string, userId: string): Promise<boolean> {
  const supabaseAdmin = getAdminClient();
  const { data } = await supabaseAdmin
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await params;
  if (!(await chatBelongsToUser(chatId, userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabaseAdmin = getAdminClient();
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id,role,content,images,documents,created_at")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });

  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await params;
  if (!(await chatBelongsToUser(chatId, userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabaseAdmin = getAdminClient();
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const images = Array.isArray(body?.images) ? body.images : [];
  const documents = Array.isArray(body?.documents) ? body.documents : [];
  const wantsStream = body?.stream === true;

  if (!content) return NextResponse.json({ error: "Message content is required" }, { status: 400 });

  const now = new Date().toISOString();

  const userMessage = {
    id: crypto.randomUUID(),
    chat_id: chatId,
    user_id: userId,
    role: "user",
    content,
    images,
    documents,
    created_at: now,
  };

  const { error: insertUserError } = await supabaseAdmin.from("messages").insert(userMessage);
  if (insertUserError) return NextResponse.json({ error: "Failed to save message" }, { status: 500 });

  await supabaseAdmin.from("chats").update({ updated_at: now }).eq("id", chatId).eq("user_id", userId);

  // If chat was created manually with default title, auto-title it from the first message
  try {
    const { data: chatRow } = await supabaseAdmin
      .from("chats")
      .select("title")
      .eq("id", chatId)
      .eq("user_id", userId)
      .maybeSingle();

    if ((chatRow as any)?.title === "New Chat") {
      const { count } = await supabaseAdmin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("chat_id", chatId)
        .eq("user_id", userId);

      if (count === 1) {
        await supabaseAdmin
          .from("chats")
          .update({ title: makeChatTitleFromMessage(content), updated_at: new Date().toISOString() })
          .eq("id", chatId)
          .eq("user_id", userId);
      }
    }
  } catch {
    // non-critical
  }

  const { data: previous } = await supabaseAdmin
    .from("messages")
    .select("role,content,created_at")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const conversationHistory = previous?.map((m: any) => ({ role: m.role, content: m.content })) ?? [];

  let assistantContent = "";
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
      const assistantId = crypto.randomUUID();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: any) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          try {
            send("start", { userMessage, assistantMessageId: assistantId });

            assistantContent = await streamOllamaChat({
              baseUrl: ollamaBaseUrl,
              model: ollamaModel,
              messages: [...conversationHistory.slice(0, -1), { role: "user", content: content + contextPrompt }],
              signal: req.signal,
              handlers: {
                onDelta: (delta) => send("delta", { delta }),
              },
            });

            const assistantMessage = {
              id: assistantId,
              chat_id: chatId,
              user_id: userId,
              role: "assistant",
              content: assistantContent,
              created_at: new Date().toISOString(),
            };

            const { error: insertAssistantError } = await supabaseAdmin.from("messages").insert(assistantMessage);
            if (insertAssistantError) {
              send("error", { error: "Failed to save assistant message" });
              controller.close();
              return;
            }

            send("done", { userMessage, assistantMessage });
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
      const assistantId = crypto.randomUUID();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: any) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          try {
            send("start", { userMessage, assistantMessageId: assistantId });

            assistantContent = await streamOpenAICompatibleChat({
              apiKey: openaiKey,
              baseUrl: openaiBaseUrl,
              model: openaiModel,
              messages: [...conversationHistory.slice(0, -1), { role: "user", content: content + contextPrompt }],
              signal: req.signal,
              handlers: {
                onDelta: (delta) => send("delta", { delta }),
              },
            });

            const assistantMessage = {
              id: assistantId,
              chat_id: chatId,
              user_id: userId,
              role: "assistant",
              content: assistantContent,
              created_at: new Date().toISOString(),
            };

            const { error: insertAssistantError } = await supabaseAdmin.from("messages").insert(assistantMessage);
            if (insertAssistantError) {
              send("error", { error: "Failed to save assistant message" });
              controller.close();
              return;
            }

            send("done", { userMessage, assistantMessage });
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

    assistantContent = await generateAssistantReply({
      messages: [
        ...conversationHistory.slice(0, -1),
        { role: "user", content },
      ],
      documents,
    });
  } catch (e) {
    console.error("AI call failed:", e);
    assistantContent = "Не удалось получить ответ от AI провайдера.";
  }

  const assistantMessage = {
    id: crypto.randomUUID(),
    chat_id: chatId,
    user_id: userId,
    role: "assistant",
    content: assistantContent,
    created_at: new Date().toISOString(),
  };

  const { error: insertAssistantError } = await supabaseAdmin.from("messages").insert(assistantMessage);
  if (insertAssistantError) return NextResponse.json({ error: "Failed to save assistant message" }, { status: 500 });

  return NextResponse.json({ userMessage, assistantMessage });
}

