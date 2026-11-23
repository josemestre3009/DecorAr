import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { crearActivo3DCompartido } from "@/modules/ar/domain/activo-3d-compartido";
import { createModelLibrary, type WebXRValidationModule } from "./webxr-validation-models";

const loadAsync = vi.fn();
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    loadAsync = loadAsync;
  },
}));

const meta: WebXRValidationModule = {
  assetId: "mesa",
  depthM: 1,
  glbUrl: "https://example.com/mesa.glb",
  heightM: 1,
  id: "mesa",
  name: "Mesa",
  posterUrl: null,
  usdzUrl: "https://example.com/mesa.usdz",
  version: 1,
  widthM: 1,
};

describe("createModelLibrary", () => {
  it("reintenta una carga rechazada", async () => {
    loadAsync
      .mockRejectedValueOnce(new Error("red caída"))
      .mockResolvedValueOnce({ scene: new THREE.Group() });
    const activo = crearActivo3DCompartido(meta);
    if (!activo.ok) throw new Error("Activo inválido para prueba");
    const library = createModelLibrary({ onWarning: vi.fn(), resolveMeta: () => meta });

    await expect(library.load(activo.value)).rejects.toThrow("red caída");
    await expect(library.load(activo.value)).resolves.toBeInstanceOf(THREE.Group);
    expect(loadAsync).toHaveBeenCalledTimes(2);
  });
});
