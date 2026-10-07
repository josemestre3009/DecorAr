import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface BoundingBoxResult {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly widthM: number;
  readonly heightM: number;
  readonly depthM: number;
}

interface GlTFNode {
  readonly matrix?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly mesh?: number;
  readonly children?: readonly number[];
}

interface GlTFMeshPrimitive {
  readonly attributes?: {
    readonly POSITION?: number;
  };
}

interface GlTFMesh {
  readonly primitives?: readonly GlTFMeshPrimitive[];
}

interface GlTFAccessor {
  readonly min?: readonly number[];
  readonly max?: readonly number[];
  readonly componentType?: number;
}

interface GlTFStructure {
  readonly scene?: number;
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly nodes?: readonly GlTFNode[];
  readonly meshes?: readonly GlTFMesh[];
  readonly accessors?: readonly GlTFAccessor[];
}

function multiplyMat4(out: number[], a: readonly number[], b: readonly number[]): number[] {
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i];
    const ai1 = a[i + 4];
    const ai2 = a[i + 8];
    const ai3 = a[i + 12];
    out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
    out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
    out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

function getLocalMatrix(node: GlTFNode): number[] {
  if (node.matrix && node.matrix.length === 16) {
    return [...node.matrix];
  }

  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];

  const x = r[0];
  const y = r[1];
  const z = r[2];
  const w = r[3];

  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;

  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    (1 - (yy + zz)) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - (xx + zz)) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

function transformPoint(m: readonly number[], p: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function extractGlbBoundingBox(buf: Buffer): BoundingBoxResult {
  if (buf.length < 20) {
    throw new Error("Buffer too short for GLB");
  }

  // GLB Magic: 0x46546C67 ("glTF")
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) {
    throw new Error(`Invalid GLB magic: 0x${magic.toString(16)} (expected 0x46546c67)`);
  }

  const chunk0Length = buf.readUInt32LE(12);
  const chunk0Type = buf.readUInt32LE(16);
  if (chunk0Type !== 0x4e4f534a) {
    throw new Error(`Invalid Chunk 0 type: 0x${chunk0Type.toString(16)} (expected 0x4e4f534a 'JSON')`);
  }

  const jsonStr = buf.toString("utf8", 20, 20 + chunk0Length);
  const gltf: GlTFStructure = JSON.parse(jsonStr);

  if (!gltf.nodes || !gltf.meshes || !gltf.accessors) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      widthM: 0,
      heightM: 0,
      depthM: 0,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const identity: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function traverseNode(nodeIdx: number, parentMat: readonly number[]) {
    const node = gltf.nodes?.[nodeIdx];
    if (!node) return;

    const localMat = getLocalMatrix(node);
    const worldMat = multiplyMat4(new Array(16), parentMat, localMat);

    if (node.mesh !== undefined && gltf.meshes?.[node.mesh]) {
      const mesh = gltf.meshes[node.mesh];
      for (const prim of mesh.primitives || []) {
        if (prim.attributes?.POSITION !== undefined) {
          const acc = gltf.accessors?.[prim.attributes.POSITION];
          if (acc?.min && acc?.max && acc.min.length >= 3 && acc.max.length >= 3) {
            const corners: readonly [number, number, number][] = [
              [acc.min[0], acc.min[1], acc.min[2]],
              [acc.min[0], acc.min[1], acc.max[2]],
              [acc.min[0], acc.max[1], acc.min[2]],
              [acc.min[0], acc.max[1], acc.max[2]],
              [acc.max[0], acc.min[1], acc.min[2]],
              [acc.max[0], acc.min[1], acc.max[2]],
              [acc.max[0], acc.max[1], acc.min[2]],
              [acc.max[0], acc.max[1], acc.max[2]],
            ];

            for (const pt of corners) {
              const [tx, ty, tz] = transformPoint(worldMat, pt);
              if (tx < minX) minX = tx;
              if (ty < minY) minY = ty;
              if (tz < minZ) minZ = tz;
              if (tx > maxX) maxX = tx;
              if (ty > maxY) maxY = ty;
              if (tz > maxZ) maxZ = tz;
            }
          }
        }
      }
    }

    if (node.children) {
      for (const childIdx of node.children) {
        traverseNode(childIdx, worldMat);
      }
    }
  }

  const rootSceneIndex = gltf.scene ?? 0;
  const rootNodes = gltf.scenes?.[rootSceneIndex]?.nodes || [0];

  for (const r of rootNodes) {
    traverseNode(r, identity);
  }

  const widthM = Number(Math.max(0, maxX - minX).toFixed(3));
  const heightM = Number(Math.max(0, maxY - minY).toFixed(3));
  const depthM = Number(Math.max(0, maxZ - minZ).toFixed(3));

  return {
    min: [Number(minX.toFixed(3)), Number(minY.toFixed(3)), Number(minZ.toFixed(3))],
    max: [Number(maxX.toFixed(3)), Number(maxY.toFixed(3)), Number(maxZ.toFixed(3))],
    widthM,
    heightM,
    depthM,
  };
}

export async function inspectAllAssets() {
  const assets = [
    {
      id: "mesa",
      file: "assets/3d/mesa/v1/mahogany_table.glb",
      catalogDimensions: { widthM: 2.0, heightM: 1.0, depthM: 2.0 },
    },
    {
      id: "arco",
      file: "assets/3d/arco/v1/flower_arch.glb",
      catalogDimensions: { widthM: 2.0, heightM: 2.4, depthM: 1.0 },
    },
    {
      id: "pista",
      file: "assets/3d/pista/v1/animated_dance_floor_neon_lights.glb",
      catalogDimensions: { widthM: 4.0, heightM: 0.1, depthM: 4.0 },
    },
  ];

  console.log("===============================================================");
  console.log(" Inspección de Bounding Box y Dimensiones 3D (DECOR-36 / F3)");
  console.log("===============================================================\n");

  const results = [];

  for (const item of assets) {
    const fullPath = join(process.cwd(), item.file);
    const buf = await readFile(fullPath);
    const bounds = extractGlbBoundingBox(buf);

    console.log(`📦 Módulo: ${item.id.toUpperCase()}`);
    console.log(`   Archivo: ${item.file}`);
    console.log(`   Bounding Box transformado:`);
    console.log(`     Min: [${bounds.min.join(", ")}]`);
    console.log(`     Max: [${bounds.max.join(", ")}]`);
    console.log(`     Dimensiones geométricas: Ancho=${bounds.widthM}m, Alto=${bounds.heightM}m, Profundidad=${bounds.depthM}m`);
    console.log(`   Dimensiones de Catálogo (Escala 1:1 en AR con ar-scale="fixed"):`);
    console.log(`     Ancho=${item.catalogDimensions.widthM}m, Alto=${item.catalogDimensions.heightM}m, Profundidad=${item.catalogDimensions.depthM}m`);
    console.log("---------------------------------------------------------------");

    results.push({ item, bounds });
  }

  return results;
}

if (process.argv[1]?.includes("inspect-glb-bounds")) {
  inspectAllAssets().catch((err) => {
    console.error("Error al inspeccionar GLB:", err);
    process.exit(1);
  });
}
