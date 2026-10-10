import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { center, getBounds } from "@gltf-transform/functions";

const assets = {
  arco: ["flower_arch.glb", "poster-arch.webp"],
  pista: ["animated_dance_floor_neon_lights.glb", "poster-dancefloor.webp"],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const fmt = (b) =>
  `min=[${b.min.map((n) => n.toFixed(3)).join(", ")}] max=[${b.max.map((n) => n.toFixed(3)).join(", ")}] ` +
  `dims=${(b.max[0] - b.min[0]).toFixed(3)}/${(b.max[1] - b.min[1]).toFixed(3)}/${(b.max[2] - b.min[2]).toFixed(3)}`;

for (const [assetId, [filename, poster]] of Object.entries(assets)) {
  const source = join(process.cwd(), "assets", "3d", assetId, "v2");
  const output = join(process.cwd(), "assets", "3d", assetId, "v3");
  await mkdir(output, { recursive: true });

  const document = await io.read(join(source, filename));
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const before = getBounds(scene);
  await document.transform(center({ pivot: "below" }));
  const after = getBounds(scene);

  await io.write(join(output, filename), document);
  await copyFile(join(source, poster), join(output, poster));

  console.log(`${assetId}:`);
  console.log(`  before ${fmt(before)}`);
  console.log(`  after  ${fmt(after)}`);
}
