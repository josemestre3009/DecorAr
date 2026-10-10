import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { createPublishAndActivateModuleUseCase } from "../src/composition/server";
import { extractGlbBoundingBox } from "./inspect-glb-bounds";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Si no existe .env, asume variables ya configuradas en el entorno
  }
}

interface ModuleDefinition {
  readonly assetId: string;
  readonly version: number;
}

interface PublishOptions {
  readonly assetId?: string;
  readonly version?: number;
}

export const DEFAULT_CATALOG_ASSET_VERSION = 2;

// arco y pista v3 están recentrados en el origen (centro X/Z = 0, base Y = 0) para
// que AR los coloque sobre el punto elegido; mesa v2 ya estaba centrada.
const MODULES_TO_PUBLISH: readonly ModuleDefinition[] = [
  {
    assetId: "mesa",
    version: DEFAULT_CATALOG_ASSET_VERSION,
  },
  {
    assetId: "arco",
    version: 3,
  },
  {
    assetId: "pista",
    version: 3,
  },
];

export function parsePublishOptions(args: readonly string[]): PublishOptions {
  const assetId = args.find((arg) => arg.startsWith("--asset="))?.slice("--asset=".length);
  const versionValue = args.find((arg) => arg.startsWith("--version="))?.slice("--version=".length);
  const version = versionValue === undefined ? undefined : Number(versionValue);

  if (assetId !== undefined && !MODULES_TO_PUBLISH.some((module) => module.assetId === assetId)) {
    throw new Error(`Módulo desconocido: ${assetId}`);
  }
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    throw new Error(`Versión inválida: ${versionValue}`);
  }

  return { assetId, version };
}

async function findModuleFiles(assetDir: string) {
  const entries = await readdir(assetDir);

  const glb = entries.find((file) => file.toLowerCase().endsWith(".glb"));
  const usdz = entries.find((file) => file.toLowerCase().endsWith(".usdz"));
  const poster = entries.find((file) =>
    [".webp", ".png", ".jpg", ".jpeg"].some((ext) => file.toLowerCase().endsWith(ext)),
  );

  if (!glb || !usdz || !poster) {
    throw new Error(
      `Directorio ${assetDir} incompleto. Debe contener un archivo .glb, uno .usdz y un poster (.webp/.png/.jpg). Encontrados: ${entries.join(", ")}`,
    );
  }

  return {
    glbPath: join(assetDir, glb),
    usdzPath: join(assetDir, usdz),
    posterPath: join(assetDir, poster),
  };
}

export async function publishAllModules(options: PublishOptions = {}) {
  console.log("==================================================");
  console.log(" DecorAR - Publicación de Activos 3D (DECOR-36)");
  console.log("==================================================");

  const useCase = createPublishAndActivateModuleUseCase();
  const baseAssetsDir = join(process.cwd(), "assets", "3d");

  const results = [];

  const modules = MODULES_TO_PUBLISH
    .filter((module) => options.assetId === undefined || module.assetId === options.assetId)
    .map((module) => ({ ...module, version: options.version ?? module.version }));

  for (const moduleDef of modules) {
    const versionDir = join(baseAssetsDir, moduleDef.assetId, `v${moduleDef.version}`);
    console.log(`\n[${moduleDef.assetId} v${moduleDef.version}] Localizando archivos en ${versionDir}...`);

    const files = await findModuleFiles(versionDir);
    console.log(`  GLB:    ${files.glbPath}`);
    console.log(`  USDZ:   ${files.usdzPath}`);
    console.log(`  Poster: ${files.posterPath}`);

    const glbBuffer = await readFile(files.glbPath);
    const bounds = extractGlbBoundingBox(glbBuffer);
    console.log(`  Geometría GLB (Bounding Box): Ancho=${bounds.widthM}m, Alto=${bounds.heightM}m, Profundidad=${bounds.depthM}m`);
    console.log(`  Catálogo (escala física 1:1): Ancho=${bounds.widthM}m, Alto=${bounds.heightM}m, Profundidad=${bounds.depthM}m`);

    console.log(`  Subiendo a Cloudinary y activando atómicamente en Supabase...`);
    const result = await useCase.execute({
      assetId: moduleDef.assetId,
      version: moduleDef.version,
      files,
      dimensions: bounds,
    });

    if (!result.ok) {
      console.error(`\n❌ Error al publicar y activar módulo '${moduleDef.assetId}':`, result.error.message);
      throw new Error(result.error.message);
    }

    console.log(`  ✅ Módulo '${moduleDef.assetId}' activado con éxito:`);
    console.log(`     - GLB:    ${result.value.glbUrl}`);
    console.log(`     - USDZ:   ${result.value.usdzUrl}`);
    console.log(`     - Poster: ${result.value.posterUrl}`);
    console.log(`     - Estado: ${result.value.module.status}`);

    results.push(result.value);
  }

  console.log("\n==================================================");
  console.log(` 🎉 Éxito: ${results.length} módulos publicados y activados.`);
  console.log("==================================================");

  return results;
}

// Ejecutar si es invocado directamente
if (process.argv[1]?.endsWith("publish-catalog-assets.ts")) {
  publishAllModules(parsePublishOptions(process.argv.slice(2))).catch((err) => {
    console.error("Fallo general en la publicación:", err.message);
    process.exit(1);
  });
}
