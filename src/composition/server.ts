import "server-only";

import { createAdminClient } from "@/infrastructure/supabase/admin";
import { createClient, type SessionClientOptions } from "@/infrastructure/supabase/server";
import { createSessionGateway } from "@/infrastructure/supabase/session-gateway";
import { createAuthUseCases } from "@/shared/application/auth";

export async function createSessionDependencies(options: SessionClientOptions = {}) {
  const supabase = await createClient(options);
  const auth = createAuthUseCases(createSessionGateway(supabase));

  return { supabase, auth };
}

export function createAdminDependencies() {
  return { supabase: createAdminClient() };
}
