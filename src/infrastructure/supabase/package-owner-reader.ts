import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PackageOwnerReader } from "../../modules/packages/application/authorize-package-access.use-case";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";

/**
 * Built with the session client, so RLS also filters the read: a foreign
 * package comes back as `null`. The ownership comparison itself lives in
 * `AuthorizePackageAccessUseCase` and does not depend on that filter.
 */
export function createPackageOwnerReader(client: SupabaseClient): PackageOwnerReader {
  return {
    async findOwnerId(packageId) {
      const { data, error } = await client
        .from("packages")
        .select("user_id")
        .eq("id", packageId)
        .maybeSingle<{ user_id: string }>();

      if (error) {
        return err(new DomainError("package.persistence_error", error.message, { cause: error }));
      }

      return ok(data?.user_id ?? null);
    },
  };
}
