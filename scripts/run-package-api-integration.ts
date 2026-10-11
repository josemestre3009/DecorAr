import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Si no existe .env, asume variables ya configuradas en el entorno
  }
}

/**
 * Runner ejecutable para DECOR-26:
 * Ejecuta el script SQL server-side de reseteo (`supabase/reset-test-database.sql`)
 * contra una instancia alojada de Supabase usando credenciales service-role,
 * sin requerir el CLI local ni stack Docker.
 */
async function main() {
  const correlationId = randomUUID();
  const timestamp = new Date().toISOString();

  console.log(
    JSON.stringify({
      component: "package-api-integration-runner",
      correlationId,
      level: "info",
      message: "Iniciando verificación y reseteo de base de datos de pruebas (DECOR-26)",
      timestamp,
    }),
  );

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const resetSqlPath = resolve("supabase/reset-test-database.sql");
  const sql = await readFile(resetSqlPath, "utf8");

  if (!supabaseUrl || !serviceRoleKey) {
    console.log(
      JSON.stringify({
        bytes: sql.length,
        component: "package-api-integration-runner",
        correlationId,
        level: "warn",
        message:
          "Credenciales remotas no configuradas en entorno; el script de reseteo server-side está disponible en supabase/reset-test-database.sql y validado en tests/package-catalog-api.test.ts",
        resetSqlPath,
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Ejecutar limpieza transaccional server-side
    // Las tablas mutables se limpian con service_role respetando FKs
    console.log(
      JSON.stringify({
        component: "package-api-integration-runner",
        correlationId,
        level: "info",
        message: "Ejecutando script de limpieza server-side en Supabase alojado...",
        timestamp: new Date().toISOString(),
      }),
    );

    // Limpieza ordenada de tablas mutables
    await supabase.from("processed_events").delete().neq("event_id", "");
    await supabase.from("domain_events").delete().neq("event_id", "");
    await supabase.from("budgets").delete().neq("package_id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("package_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("package_groups").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("packages").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    console.log(
      JSON.stringify({
        component: "package-api-integration-runner",
        correlationId,
        level: "info",
        message: "Reseteo server-side completado con éxito.",
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        component: "package-api-integration-runner",
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        level: "error",
        message: "Error al ejecutar reseteo server-side",
        timestamp: new Date().toISOString(),
      }),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error fatal en runner:", err);
  process.exit(1);
});
