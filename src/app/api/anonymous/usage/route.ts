import { NextResponse, type NextRequest } from "next/server";

import { getAdminClient } from "@/shared/api/supabaseAdmin";


export const runtime = "nodejs";

function getAnonymousId(req: NextRequest): string | null {
  const anon = req.headers.get("x-anonymous-id");
  return anon && anon.trim().length > 0 ? anon : null;
}

export async function GET(req: NextRequest) {
  const anonymousId = getAnonymousId(req);
  if (!anonymousId) return NextResponse.json({ count: 0 });

  const supabaseAdmin = getAdminClient();
  const { data, error } = await supabaseAdmin
    .from("anonymous_usage")
    .select("count")
    .eq("anonymous_id", anonymousId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ count: 0 });
  }

  return NextResponse.json({ count: (data as any)?.count ?? 0 });
}

export async function POST(req: NextRequest) {
  const anonymousId = getAnonymousId(req);
  if (!anonymousId) return NextResponse.json({ error: "X-Anonymous-ID header required" }, { status: 400 });

  const supabaseAdmin = getAdminClient();
  const body = await req.json().catch(() => ({}));
  const delta = typeof body?.delta === "number" ? body.delta : 1;
  const safeDelta = Number.isFinite(delta) ? Math.max(1, Math.floor(delta)) : 1;

  const { data: existing } = await supabaseAdmin
    .from("anonymous_usage")
    .select("count")
    .eq("anonymous_id", anonymousId)
    .maybeSingle();

  const newCount = ((existing as any)?.count ?? 0) + safeDelta;

  const { error } = await supabaseAdmin.from("anonymous_usage").upsert(
    {
      anonymous_id: anonymousId,
      count: newCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "anonymous_id" },
  );

  if (error) {
    return NextResponse.json({ error: "Failed to increment" }, { status: 500 });
  }

  return NextResponse.json({ count: newCount });
}

