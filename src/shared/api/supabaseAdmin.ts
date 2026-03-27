import "server-only";

import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { supabaseEnv } from "@/shared/config/supabase";

let _admin: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (_admin) return _admin;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Missing env var: SUPABASE_SERVICE_ROLE_KEY");
  }

  if (!supabaseEnv.url) {
    throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_URL");
  }

  _admin = createClient(supabaseEnv.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

export async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) return null;

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return data.user.id;
}

export function getAdminClient() {
  return getSupabaseAdmin() as any;
}

