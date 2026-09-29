import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getAdminSupabaseEnv } from "../../lib/env";

export function createAdminClient() {
  const { url, serviceRoleKey } = getAdminSupabaseEnv();

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
