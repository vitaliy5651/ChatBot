import { NextResponse, type NextRequest } from "next/server";

import { getAdminClient, getUserIdFromRequest } from "@/shared/api/supabaseAdmin";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabaseAdmin = getAdminClient();
  const { chatId } = await params;
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";

  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("chats")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", chatId)
    .eq("user_id", userId)
    .select("id,title,created_at,updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Failed to update chat" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ chat: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabaseAdmin = getAdminClient();
  const { chatId } = await params;

  const { data: chat } = await supabaseAdmin
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await supabaseAdmin.from("messages").delete().eq("chat_id", chatId).eq("user_id", userId);
  const { error } = await supabaseAdmin.from("chats").delete().eq("id", chatId).eq("user_id", userId);

  if (error) return NextResponse.json({ error: "Failed to delete chat" }, { status: 500 });

  return NextResponse.json({ success: true });
}

