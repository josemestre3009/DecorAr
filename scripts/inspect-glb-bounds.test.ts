import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { calculateCalibrationScale, extractGlbBoundingBox } from "./inspect-glb-bounds";

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

describe("calculateCalibrationScale", () => {
  it("calcula factores que convierten el bounding box a dimensiones físicas", () => {
    const bounds = {
      min: [0, 0, 0] as const,
      max: [10, 5, 4] as const,
      widthM: 10,
      heightM: 5,
      depthM: 4,
    };

    const scale = calculateCalibrationScale(bounds, {
      widthM: 2,
      heightM: 1,
      depthM: 2,
    });

    expect(scale).toEqual({ widthM: 0.2, heightM: 0.2, depthM: 0.5 });
    expect(bounds.widthM * scale.widthM).toBeCloseTo(2);
    expect(bounds.heightM * scale.heightM).toBeCloseTo(1);
    expect(bounds.depthM * scale.depthM).toBeCloseTo(2);
  });

  it("rechaza dimensiones sin volumen", () => {
    expect(() =>
      calculateCalibrationScale(
        { min: [0, 0, 0], max: [0, 1, 1], widthM: 0, heightM: 1, depthM: 1 },
        { widthM: 1, heightM: 1, depthM: 1 },
      ),
    ).toThrow("must be greater than zero");
  });

  it.each([
    ["mesa", "assets/3d/mesa/v1/mahogany_table.glb", [2, 1, 2], [0.145836, 0.154727, 0.24573]],
    ["arco", "assets/3d/arco/v1/flower_arch.glb", [2, 2.4, 1], [0.271407, 0.331813, 0.657462]],
    ["pista", "assets/3d/pista/v1/animated_dance_floor_neon_lights.glb", [4, 0.1, 4], [0.569801, 0.2, 0.569801]],
  ])("mantiene calibración reproducible para %s", async (_id, file, physical, expected) => {
    const bounds = extractGlbBoundingBox(await readFile(file));
    const scale = calculateCalibrationScale(bounds, {
      widthM: physical[0],
      heightM: physical[1],
      depthM: physical[2],
    });

    expect([scale.widthM, scale.heightM, scale.depthM]).toEqual(expected);
    expect(bounds.widthM * scale.widthM).toBeCloseTo(physical[0], 4);
    expect(bounds.heightM * scale.heightM).toBeCloseTo(physical[1], 4);
    expect(bounds.depthM * scale.depthM).toBeCloseTo(physical[2], 4);
  });
});
