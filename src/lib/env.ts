export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getPublicSupabaseEnv() {
  // Next.js only inlines NEXT_PUBLIC values referenced statically.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!publishableKey) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return {
    url,
    publishableKey,
  };
}

export function getAdminSupabaseEnv() {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getCloudinaryEnv() {
  return {
    url: requireEnv("CLOUDINARY_URL"),
  };
}

/**
 * `null`, never throws, when `DECOR_RECOVERY_SECRET` is unset: the recovery
 * endpoint (DECOR-31) must respond 503 in that case instead of accepting any
 * bearer value or silently running unprotected.
 */
export function getRecoverySecret(): string | null {
  const value = process.env.DECOR_RECOVERY_SECRET;

  return value && value.length > 0 ? value : null;
}

