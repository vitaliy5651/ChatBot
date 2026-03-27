import { NextResponse, type NextRequest } from "next/server";

import { getAdminClient } from "@/shared/api/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = body?.email;
    const password = body?.password;
    const name = body?.name;

    if (typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const supabaseAdmin = getAdminClient();
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: { name: typeof name === "string" ? name : email.split("@")[0] },
      email_confirm: true,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ userId: data.user.id });
  } catch (e: any) {
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  }
}

