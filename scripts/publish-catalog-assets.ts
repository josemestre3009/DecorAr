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
  readonly dimensions: {
    readonly widthM: number;
    readonly heightM: number;
    readonly depthM: number;
  };
}

const MODULES_TO_PUBLISH: readonly ModuleDefinition[] = [
  {
    assetId: "mesa",
    version: 1,
    dimensions: { widthM: 2.0, heightM: 1.0, depthM: 2.0 },
  },
  {
    assetId: "arco",
    version: 1,
    dimensions: { widthM: 2.0, heightM: 2.4, depthM: 1.0 },
  },
  {
    assetId: "pista",
    version: 1,
    dimensions: { widthM: 4.0, heightM: 0.1, depthM: 4.0 },
  },
];

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

export async function publishAllModules() {
  console.log("==================================================");
  console.log(" DecorAR - Publicación de Activos 3D (DECOR-36)");
  console.log("==================================================");

  const useCase = createPublishAndActivateModuleUseCase();
  const baseAssetsDir = join(process.cwd(), "assets", "3d");

  const results = [];

  for (const moduleDef of MODULES_TO_PUBLISH) {
    const versionDir = join(baseAssetsDir, moduleDef.assetId, `v${moduleDef.version}`);
    console.log(`\n[${moduleDef.assetId} v${moduleDef.version}] Localizando archivos en ${versionDir}...`);

    const files = await findModuleFiles(versionDir);
    console.log(`  GLB:    ${files.glbPath}`);
    console.log(`  USDZ:   ${files.usdzPath}`);
    console.log(`  Poster: ${files.posterPath}`);

    const glbBuffer = await readFile(files.glbPath);
    const bounds = extractGlbBoundingBox(glbBuffer);
    console.log(`  Geometría GLB (Bounding Box): Ancho=${bounds.widthM}m, Alto=${bounds.heightM}m, Profundidad=${bounds.depthM}m`);
    console.log(`  Catálogo (AR 1:1 fija):       Ancho=${moduleDef.dimensions.widthM}m, Alto=${moduleDef.dimensions.heightM}m, Profundidad=${moduleDef.dimensions.depthM}m`);

    console.log(`  Subiendo a Cloudinary y activando atómicamente en Supabase...`);
    const result = await useCase.execute({
      assetId: moduleDef.assetId,
      version: moduleDef.version,
      files,
      dimensions: moduleDef.dimensions,
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
  publishAllModules().catch((err) => {
    console.error("Fallo general en la publicación:", err.message);
    process.exit(1);
  });
}
