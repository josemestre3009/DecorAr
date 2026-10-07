import { copyFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const assets = {
  mesa: ["mahogany_table.glb", "poster-table.webp", 0.145836],
  arco: ["flower_arch.glb", "poster-arch.webp", 0.331813],
  pista: ["animated_dance_floor_neon_lights.glb", "poster-dancefloor.webp", 0.569801],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const execFileAsync = promisify(execFile);

for (const [assetId, [filename, poster, factor]] of Object.entries(assets)) {
  const source = join(process.cwd(), "assets", "3d", assetId, "v1");
  const output = join(process.cwd(), "assets", "3d", assetId, "v2");
  await mkdir(output, { recursive: true });

  const document = await io.read(join(source, filename));
  for (const scene of document.getRoot().listScenes()) {
    for (const node of scene.listChildren()) {
      const scale = node.getScale();
      node.setScale([scale[0] * factor, scale[1] * factor, scale[2] * factor]);
    }
  }
  await io.write(join(output, filename), document);
  if (assetId === "arco") {
    const cli = join(process.cwd(), "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
    const resized = join(output, "flower_arch-resized.glb");
    const simplified = join(output, "flower_arch-simplified.glb");
    await execFileAsync(process.execPath, [
      cli,
      "resize",
      join(output, filename),
      resized,
      "--width",
      "512",
      "--height",
      "512",
    ]);
    await execFileAsync(process.execPath, [
      cli,
      "simplify",
      resized,
      simplified,
      "--ratio",
      "0.75",
      "--error",
      "0.001",
      "--lock-border",
      "true",
    ]);
    await copyFile(simplified, join(output, filename));
    await Promise.all([unlink(resized), unlink(simplified)]);
  }
  await copyFile(join(source, poster), join(output, poster));
  console.log(`${assetId}: exported GLB with uniform scale ${factor.toFixed(6)}`);
}
