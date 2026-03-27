import { NextResponse, type NextRequest } from "next/server";

import { getAdminClient, getUserIdFromRequest } from "@/shared/api/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabaseAdmin = getAdminClient();
  const { data, error } = await supabaseAdmin
    .from("chats")
    .select("id,title,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    const code = (error as any)?.code;
    const msg = String((error as any)?.message ?? "");
    if (code === "PGRST205" || msg.includes("schema cache")) {
      return NextResponse.json(
        {
          error: "DB schema not applied (missing table public.chats). Run supabase/schema.sql in Supabase.",
          code: "DB_SCHEMA_MISSING",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Failed to fetch chats" }, { status: 500 });
  }

  return NextResponse.json({ chats: data ?? [] });
}

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabaseAdmin = getAdminClient();
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" && body.title.trim().length > 0 ? body.title.trim() : "New Chat";

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("chats")
    .insert({ user_id: userId, title, created_at: now, updated_at: now })
    .select("id,title,created_at,updated_at")
    .single();

  if (error) {
    const code = (error as any)?.code;
    const msg = String((error as any)?.message ?? "");
    if (code === "PGRST205" || msg.includes("schema cache")) {
      return NextResponse.json(
        {
          error: "DB schema not applied (missing table public.chats). Run supabase/schema.sql in Supabase.",
          code: "DB_SCHEMA_MISSING",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Failed to create chat" }, { status: 500 });
  }

  return NextResponse.json({ chat: data });
}

