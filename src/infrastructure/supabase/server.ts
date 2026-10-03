import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicSupabaseEnv } from "../../lib/env";

function isReadOnlyCookieStore(error: unknown) {
  return error instanceof Error && error.message.includes("Cookies can only be modified");
}

export type SessionClientOptions = {
  /**
   * Recibe los encabezados que `@supabase/ssr` entrega junto a las cookies de
   * sesión para que la respuesta no sea almacenable por un CDN ni por un proxy
   * inverso. El proxy y los Route Handlers los aplican; los Server Components
   * y las Server Actions no exponen la respuesta y quedan fuera de alcance.
   */
  onHeaders?: (headers: Record<string, string>) => void | Promise<void>;
};

export async function createClient(options: SessionClientOptions = {}) {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicSupabaseEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      async setAll(cookiesToSet, headers) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch (error) {
          if (!isReadOnlyCookieStore(error)) {
            throw error;
          }
        }

        if (options.onHeaders && headers) {
          await options.onHeaders(headers);
        }
      },
    },
  });
}
