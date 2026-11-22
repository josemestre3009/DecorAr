import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { Activo3DCompartido } from "@/modules/ar/domain/activo-3d-compartido";
import { evaluarEscalaReal } from "@/modules/ar/domain/escena-webxr";

export type WebXRValidationModule = Readonly<{
  id: string;
  name: string;
  assetId: string;
  version: number;
  glbUrl: string;
  usdzUrl: string;
  posterUrl: string | null;
  widthM: number;
  heightM: number;
  depthM: number;
}>;

export class ModelLibraryDisposedError extends Error {
  constructor() {
    super("La biblioteca de modelos ya fue liberada.");
  }
}

export type ModelLibrary = Readonly<{
  load(activo: Activo3DCompartido, moduleMeta?: WebXRValidationModule): Promise<THREE.Object3D>;
  dispose(): void;
}>;

type ModelLibraryOptions = Readonly<{
  resolveMeta(activo: Activo3DCompartido): WebXRValidationModule;
  onWarning(message: string): void;
}>;

function disposeHierarchy(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      const fields = material as unknown as Record<string, unknown>;
      for (const value of Object.values(fields)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export function createModelLibrary({ resolveMeta, onWarning }: ModelLibraryOptions): ModelLibrary {
  const promises = new Map<string, Promise<THREE.Object3D>>();
  const loaded = new Map<string, THREE.Object3D>();
  const loader = new GLTFLoader();
  let disposed = false;

  function checkScale(activo: Activo3DCompartido, root: THREE.Object3D, meta: WebXRValidationModule) {
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const escala = evaluarEscalaReal(
      { alto: meta.heightM, ancho: meta.widthM, profundidad: meta.depthM },
      { alto: size.y, ancho: size.x, profundidad: size.z },
    );
    if (!escala.dentroDeTolerancia) {
      onWarning(
        `Desvío escala 1:1 en ${activo.clave}: medido (${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}m) vs esperado (${meta.widthM}x${meta.heightM}x${meta.depthM}m)`,
      );
    }
  }

  async function fetchModel(activo: Activo3DCompartido, moduleMeta?: WebXRValidationModule) {
    const gltf = await loader.loadAsync(activo.glbUrl);
    const root = gltf.scene;

    if (disposed) {
      disposeHierarchy(root);
      throw new ModelLibraryDisposedError();
    }

    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    checkScale(activo, root, moduleMeta ?? resolveMeta(activo));

    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    loaded.set(activo.clave, root);
    return root;
  }

  return {
    dispose() {
      disposed = true;
      for (const model of loaded.values()) disposeHierarchy(model);
      loaded.clear();
      promises.clear();
    },
    load(activo, moduleMeta) {
      if (disposed) return Promise.reject(new ModelLibraryDisposedError());
      const existing = promises.get(activo.clave);
      if (existing) return existing;

      const promise = fetchModel(activo, moduleMeta).catch((error: unknown) => {
        promises.delete(activo.clave);
        throw error;
      });
      promises.set(activo.clave, promise);
      return promise;
    },
  };
}
