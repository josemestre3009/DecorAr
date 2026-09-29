import "server-only";

import { createAdminClient } from "@/infrastructure/supabase/admin";
import { createClient } from "@/infrastructure/supabase/server";

export async function createSessionDependencies() {
  return { supabase: await createClient() };
}

export function createAdminDependencies() {
  return { supabase: createAdminClient() };
}
