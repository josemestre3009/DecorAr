import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getAdminSupabaseEnv } from "../env";

export function createAdminClient() {
  const { url, serviceRoleKey } = getAdminSupabaseEnv();

  return createClient(
    url,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
