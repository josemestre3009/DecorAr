import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractGlbBoundingBox, inspectAllAssets, parseInspectOptions } from "./inspect-glb-bounds";

describe("extractGlbBoundingBox", () => {
  it("lanza error si el buffer es demasiado corto", () => {
    const shortBuf = Buffer.from([1, 2, 3]);
    expect(() => extractGlbBoundingBox(shortBuf)).toThrow("Buffer too short for GLB");
  });

  it("lanza error si el magic de GLB es inválido", () => {
    const invalidMagic = Buffer.alloc(32);
    invalidMagic.writeUInt32LE(0x12345678, 0); // Invalid magic
    expect(() => extractGlbBoundingBox(invalidMagic)).toThrow("Invalid GLB magic");
  });

  it("calcula bounding box correctamente a partir de una estructura GLB válida simulada", () => {
    const gltfJson = JSON.stringify({
      scenes: [{ nodes: [0] }],
      scene: 0,
      nodes: [
        {
          mesh: 0,
          scale: [2, 2, 2],
          translation: [1, 0, -1],
        },
      ],
      meshes: [
        {
          primitives: [
            {
              attributes: {
                POSITION: 0,
              },
            },
          ],
        },
      ],
      accessors: [
        {
          min: [-1, -1, -1],
          max: [1, 1, 1],
        },
      ],
    });

    const jsonBuffer = Buffer.from(gltfJson, "utf8");
    // Header (12 bytes) + Chunk 0 (8 bytes) + JSON bytes
    const totalLength = 12 + 8 + jsonBuffer.length;
    const buf = Buffer.alloc(totalLength);

    // Magic 0x46546C67 ('glTF')
    buf.writeUInt32LE(0x46546c67, 0);
    // Version 2
    buf.writeUInt32LE(2, 4);
    // Total Length
    buf.writeUInt32LE(totalLength, 8);

    // Chunk 0 length
    buf.writeUInt32LE(jsonBuffer.length, 12);
    // Chunk 0 type 0x4E4F534A ('JSON')
    buf.writeUInt32LE(0x4e4f534a, 16);
    // JSON content
    jsonBuffer.copy(buf, 20);

    const bounds = extractGlbBoundingBox(buf);

    // Extents: min [-1, -1, -1] * 2 + [1, 0, -1] = [-1, -2, -3]
    // max [1, 1, 1] * 2 + [1, 0, -1] = [3, 2, 1]
    expect(bounds.min).toEqual([-1, -2, -3]);
    expect(bounds.max).toEqual([3, 2, 1]);
    expect(bounds.widthM).toBe(4);
    expect(bounds.heightM).toBe(4);
    expect(bounds.depthM).toBe(4);
  });
});

describe("inspectAllAssets", () => {
  it.each([
    ["mesa", "assets/3d/mesa/v1/mahogany_table.glb", [13.714, 6.463, 8.139]],
    ["arco", "assets/3d/arco/v1/flower_arch.glb", [7.369, 7.233, 1.521]],
    ["pista", "assets/3d/pista/v1/animated_dance_floor_neon_lights.glb", [7.02, 0.5, 7.02]],
  ])("reporta las dimensiones nativas verificables para %s", async (_id, file, expected) => {
    const bounds = extractGlbBoundingBox(await readFile(file));
    expect([bounds.widthM, bounds.heightM, bounds.depthM]).toEqual(expected);
  });

  it("selecciona la versión solicitada sin inspeccionar v1", async () => {
    expect(parseInspectOptions(["--asset=mesa", "--version=2"])).toEqual({
      assetId: "mesa",
      version: 2,
    });
    await expect(inspectAllAssets({ assetId: "mesa", version: 2 })).rejects.toThrow(/mesa[\\/]v2/);
  });

  it("rechaza módulo o versión inválidos", () => {
    expect(() => parseInspectOptions(["--asset=silla"])).toThrow("Módulo desconocido");
    expect(() => parseInspectOptions(["--version=0"])).toThrow("Versión inválida");
  });
});
