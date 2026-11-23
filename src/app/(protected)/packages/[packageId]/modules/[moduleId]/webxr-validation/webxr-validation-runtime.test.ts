import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FabricaActivos3D } from "@/modules/ar/domain/fabrica-activos-3d";
import {
  startWebXRValidationRuntime,
  type WebXRValidationModule,
} from "./webxr-validation-runtime";

const mocks = vi.hoisted(() => ({
  loadFailures: 0,
  gate: null as Promise<void> | null,
  renderers: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    setAnimationLoop: ReturnType<typeof vi.fn>;
    xr: {
      getReferenceSpace: ReturnType<typeof vi.fn>;
      setReferenceSpaceType: ReturnType<typeof vi.fn>;
      setSession: ReturnType<typeof vi.fn>;
    };
  }>,
  callOrder: [] as string[],
  localFloorSpace: { name: "local-floor" } as object,
  referenceSpace: null as object | null,
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();

  class MockWebGLRenderer {
    domElement: HTMLCanvasElement;
    xr: {
      enabled: boolean;
      getReferenceSpace: ReturnType<typeof vi.fn>;
      setReferenceSpaceType: ReturnType<typeof vi.fn>;
      setSession: ReturnType<typeof vi.fn>;
    };
    info: {
      memory: { geometries: number; textures: number };
      render: { calls: number; triangles: number };
    };

    constructor() {
      this.domElement = document.createElement("canvas");
      this.xr = {
        enabled: true,
        getReferenceSpace: vi.fn(() => mocks.referenceSpace),
        setReferenceSpaceType: vi.fn(() => {
          mocks.callOrder.push("setReferenceSpaceType");
        }),
        setSession: vi.fn(async () => {
          mocks.callOrder.push("setSession");
        }),
      };
      this.info = {
        memory: { geometries: 1, textures: 1 },
        render: { calls: 1, triangles: 100 },
      };
      mocks.renderers.push(this);
    }

    dispose = vi.fn();
    render = vi.fn();
    setAnimationLoop = vi.fn();
    setPixelRatio = vi.fn();
    setSize = vi.fn();
  }

  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    loadAsync = vi.fn().mockImplementation(async () => {
      if (mocks.gate) await mocks.gate;
      if (mocks.loadFailures > 0) {
        mocks.loadFailures -= 1;
        throw new Error("Fallo transitorio");
      }
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.94, 1.19),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      const group = new THREE.Group();
      group.add(mesh);
      return { scene: group };
    });
  },
}));

const MOCK_MODULE: WebXRValidationModule = {
  assetId: "mesa",
  depthM: 1.19,
  glbUrl: "https://example.com/mesa.glb",
  heightM: 0.94,
  id: "mod-mesa",
  name: "Mesa principal",
  posterUrl: null,
  usdzUrl: "https://example.com/mesa.usdz",
  version: 1,
  widthM: 2,
};

const SECOND_MODULE: WebXRValidationModule = {
  ...MOCK_MODULE,
  assetId: "silla",
  glbUrl: "https://example.com/silla.glb",
  id: "mod-silla",
  name: "Silla",
};

const LOCAL_SPACE = { name: "local" };

function createMockXRSession() {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const hitTestSource = { cancel: vi.fn() };

  const session = {
    addEventListener: vi.fn((event: string, cb: (e: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(cb);
    }),
    domOverlayState: { type: "screen" },
    enabledFeatures: ["hit-test", "dom-overlay", "local-floor"],
    end: vi.fn().mockImplementation(async () => {
      for (const cb of [...(listeners.get("end") ?? [])]) cb({});
    }),
    removeEventListener: vi.fn((event: string, cb: (e: unknown) => void) => {
      listeners.get(event)?.delete(cb);
    }),
    requestHitTestSource: vi.fn().mockResolvedValue(hitTestSource),
    requestReferenceSpace: vi.fn().mockResolvedValue(LOCAL_SPACE),
  };

  const emit = (event: string, payload: unknown = {}) => {
    for (const cb of [...(listeners.get(event) ?? [])]) cb(payload);
  };

  return { emit, hitTestSource, listeners, session };
}

async function startRuntime(
  overrides: Partial<Parameters<typeof startWebXRValidationRuntime>[0]> = {},
  mock = createMockXRSession(),
) {
  vi.stubGlobal("navigator", {
    userAgent: "test-agent",
    xr: { requestSession: vi.fn().mockResolvedValue(mock.session) },
  });
  const container = document.createElement("div");
  const overlayRoot = document.createElement("div");
  const onDiagnostics = vi.fn();
  const onEnd = vi.fn();
  const runtime = await startWebXRValidationRuntime({
    availableModules: [MOCK_MODULE],
    container,
    fabrica: new FabricaActivos3D(),
    onDiagnostics,
    onEnd,
    overlayRoot,
    primaryModule: MOCK_MODULE,
    targetCount: 1,
    ...overrides,
  });
  const renderer = mocks.renderers[mocks.renderers.length - 1];
  return { container, mock, onDiagnostics, onEnd, overlayRoot, renderer, runtime };
}

function showReticle(renderer: (typeof mocks.renderers)[number]) {
  const frame = {
    getHitTestResults: () => [
      {
        getPose: (space: object) =>
          space === mocks.localFloorSpace
            ? {
                transform: {
                  matrix: new THREE.Matrix4().makeTranslation(1, 0.126, -1).toArray(),
                  position: { x: 1, y: 0.126, z: -1 },
                },
              }
            : null,
      },
    ],
    getPose: () => null,
  };
  const loop = renderer.setAnimationLoop.mock.calls[0]?.[0] as (t: number, f: unknown) => void;
  loop(0, frame);
}

function lastDiagnostics(onDiagnostics: ReturnType<typeof vi.fn>) {
  return onDiagnostics.mock.calls[onDiagnostics.mock.calls.length - 1]?.[0];
}

const selectEvent = {
  frame: { getPose: () => null },
  inputSource: { targetRayMode: "screen", targetRaySpace: {} },
};

describe("webxr-validation-runtime", () => {
  beforeEach(() => {
    mocks.renderers.length = 0;
    mocks.gate = null;
    mocks.loadFailures = 0;
    mocks.callOrder.length = 0;
    mocks.referenceSpace = mocks.localFloorSpace;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("si falla el arranque, limpia sesión y renderer", async () => {
    const mock = createMockXRSession();
    mock.session.requestHitTestSource.mockRejectedValueOnce(new Error("Hit test falló"));
    vi.stubGlobal("navigator", {
      userAgent: "test-agent",
      xr: { requestSession: vi.fn().mockResolvedValue(mock.session) },
    });
    const container = document.createElement("div");

    await expect(
      startWebXRValidationRuntime({
        availableModules: [MOCK_MODULE],
        container,
        fabrica: new FabricaActivos3D(),
        onDiagnostics: vi.fn(),
        onEnd: vi.fn(),
        overlayRoot: document.createElement("div"),
        primaryModule: MOCK_MODULE,
        targetCount: 1,
      }),
    ).rejects.toThrow("Hit test falló");

    expect(mock.session.end).toHaveBeenCalled();
    expect(container.children.length).toBe(0);
  });

  it("arranca, exporta diagnóstico con userAgent, avisa sin retícula y finaliza", async () => {
    const { container, mock, onEnd, runtime } = await startRuntime();

    expect(container.querySelector("canvas")).not.toBeNull();
    const parsed = JSON.parse(runtime.exportDiagnostics());
    expect(parsed.targetCount).toBe(1);
    expect(parsed.domOverlay).toBe(true);
    expect(parsed.grantedFeatures).toContain("hit-test");
    expect(parsed.userAgent).toBe("test-agent");

    runtime.populateTarget(5);
    expect(runtime.exportDiagnostics()).toContain("No se puede poblar");

    await runtime.end();
    expect(mock.session.end).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(container.children.length).toBe(0);
  });

  it("onSelect coloca un objeto sobre la retícula", async () => {
    const { mock, onDiagnostics, renderer } = await startRuntime();
    showReticle(renderer);

    mock.emit("select", selectEvent);

    await vi.waitFor(() => expect(lastDiagnostics(onDiagnostics).objectCount).toBe(1));
    expect(lastDiagnostics(onDiagnostics).lastEvent).toBe("select:screen");
  });

  it("rotate, add y reset actualizan el último evento y la escena", async () => {
    const { mock, onDiagnostics, renderer, runtime } = await startRuntime();
    showReticle(renderer);
    mock.emit("select", selectEvent);
    await vi.waitFor(() => expect(lastDiagnostics(onDiagnostics).objectCount).toBe(1));

    runtime.rotate(15);
    await vi.waitFor(() => expect(lastDiagnostics(onDiagnostics).lastEvent).toBe("rotate:+15"));
    runtime.rotate(-15);
    await vi.waitFor(() => expect(lastDiagnostics(onDiagnostics).lastEvent).toBe("rotate:-15"));

    runtime.add();
    expect(lastDiagnostics(onDiagnostics).lastEvent).toBe("add-mode");

    runtime.reset();
    expect(lastDiagnostics(onDiagnostics).lastEvent).toBe("reset-scene");
    await vi.waitFor(() => expect(lastDiagnostics(onDiagnostics).objectCount).toBe(0));
  });

  it("add() al alcanzar el límite registra un fallo visible", async () => {
    const { onDiagnostics, renderer, runtime } = await startRuntime();
    showReticle(renderer);
    runtime.populateTarget(20);
    await vi.waitFor(() => expect(lastDiagnostics(onDiagnostics).objectCount).toBe(20));

    runtime.add();

    expect(lastDiagnostics(onDiagnostics).failures).toContain("Límite de 20 instancias");
  });

  it("populateTarget con retícula visible puebla la escena y deselecciona", async () => {
    const { onDiagnostics, renderer, runtime } = await startRuntime({
      availableModules: [MOCK_MODULE, SECOND_MODULE],
    });
    showReticle(renderer);

    runtime.populateTarget(5);

    await vi.waitFor(() => expect(lastDiagnostics(onDiagnostics).objectCount).toBe(5));
    const diagnostics = lastDiagnostics(onDiagnostics);
    expect(diagnostics.targetCount).toBe(5);
    expect(diagnostics.failures).toBe("ninguno");
    expect(diagnostics.activosFlyweight).toBe(2);
  });

  it("avisa del desvío de escala 1:1", async () => {
    const { runtime } = await startRuntime({
      primaryModule: { ...MOCK_MODULE, widthM: 1 },
    });

    expect(runtime.exportDiagnostics()).toContain("Desvío escala 1:1");
  });

  it("el evento 'end' de la sesión limpia sin llamar a session.end ni setSession(null)", async () => {
    const { container, mock, onEnd, renderer } = await startRuntime();

    mock.emit("end");

    expect(onEnd).toHaveBeenCalledWith(false);
    expect(mock.hitTestSource.cancel).toHaveBeenCalled();
    expect(mock.session.end).not.toHaveBeenCalled();
    expect(renderer.setAnimationLoop).toHaveBeenLastCalledWith(null);
    expect(renderer.dispose).toHaveBeenCalled();
    expect(container.children.length).toBe(0);
    expect(renderer.xr.setSession).toHaveBeenCalledTimes(1);
    expect(renderer.xr.setSession).not.toHaveBeenCalledWith(null);
  });

  it("onEnd informa fallo de sesión si el cierre falló", async () => {
    const { mock, onEnd } = await startRuntime();
    mock.hitTestSource.cancel.mockImplementation(() => {
      throw new Error("cancel roto");
    });

    mock.emit("end");

    expect(onEnd).toHaveBeenCalledWith(true);
  });

  it("beforexrselect se cancela solo en controles y no en el root, y deja de cancelar al terminar", async () => {
    const overlayRoot = document.createElement("div");
    const button = document.createElement("button");
    overlayRoot.append(button);
    const { runtime } = await startRuntime({ overlayRoot });

    const onButton = new Event("beforexrselect", { bubbles: true, cancelable: true });
    button.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(true);

    const onRoot = new Event("beforexrselect", { bubbles: true, cancelable: true });
    overlayRoot.dispatchEvent(onRoot);
    expect(onRoot.defaultPrevented).toBe(false);

    expect(JSON.parse(runtime.exportDiagnostics()).beforexrselectCancelados).toBe(1);

    await runtime.end();
    const after = new Event("beforexrselect", { bubbles: true, cancelable: true });
    button.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("fija local-floor antes de setSession y usa el espacio del renderer (no uno paralelo)", async () => {
    const { mock, renderer } = await startRuntime();

    expect(renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith("local-floor");
    expect(mocks.callOrder).toEqual(["setReferenceSpaceType", "setSession"]);
    const requested = mock.session.requestReferenceSpace.mock.calls.map((c: unknown[]) => c[0]);
    expect(requested).not.toContain("local");
  });

  it("la retícula y getPose usan el espacio de renderer.xr; sin espacio no hay retícula pero cuenta el frame", async () => {
    const { onDiagnostics, renderer, runtime } = await startRuntime();

    mocks.referenceSpace = null;
    showReticle(renderer);
    let parsed = JSON.parse(runtime.exportDiagnostics());
    expect(parsed.framesTotales).toBe(1);
    expect(parsed.framesConPose).toBe(0);
    expect(parsed.reticleVisible).toBe(false);

    mocks.referenceSpace = mocks.localFloorSpace;
    showReticle(renderer);
    parsed = JSON.parse(runtime.exportDiagnostics());
    expect(parsed.framesTotales).toBe(2);
    expect(parsed.framesConResultadoHitTest).toBe(1);
    expect(parsed.framesConPose).toBe(1);
    expect(parsed.reticleVisible).toBe(true);
    expect(parsed.reticleAltura).toBe(0.13);
    expect(parsed.tipoEspacioReferencia).toBe("local-floor");
    expect(parsed.sceneChildren).toBeGreaterThan(0);
    expect(onDiagnostics).toHaveBeenCalled();
  });

  it("select usa el espacio de renderer.xr para getPose", async () => {
    const { mock, renderer } = await startRuntime();
    showReticle(renderer);
    const getPose = vi.fn(() => null);

    mock.emit("select", { frame: { getPose }, inputSource: selectEvent.inputSource });

    expect(getPose).toHaveBeenCalledWith(selectEvent.inputSource.targetRaySpace, mocks.localFloorSpace);
  });

  it("select sin retícula registra un fallo visible y cuenta los eventos", async () => {
    const { mock, onDiagnostics } = await startRuntime();

    mock.emit("selectstart", selectEvent);
    mock.emit("select", selectEvent);

    const diagnostics = lastDiagnostics(onDiagnostics);
    expect(diagnostics.failures).toContain("Toque ignorado: la retícula no está visible");
    expect(diagnostics.select).toBe(1);
    expect(diagnostics.selectstart).toBe(1);
  });

  it("el estado de carga por activo aparece en el diagnóstico", async () => {
    const { runtime } = await startRuntime();

    expect(JSON.parse(runtime.exportDiagnostics()).estadoActivos).toEqual({
      "mesa@v1": "cargado",
    });
  });

  it("una carga GLB en vuelo tras cleanup no crea instancias", async () => {
    const cloneSpy = vi.spyOn(THREE.Object3D.prototype, "clone");
    const { onDiagnostics, renderer, runtime } = await startRuntime({
      availableModules: [MOCK_MODULE, SECOND_MODULE],
    });
    showReticle(renderer);

    let release: () => void = () => {};
    mocks.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runtime.populateTarget(2);
    await vi.waitFor(() => expect(cloneSpy).toHaveBeenCalled());

    await runtime.end();
    const clonesAtEnd = cloneSpy.mock.calls.length;
    const reportsAtEnd = onDiagnostics.mock.calls.length;
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(cloneSpy.mock.calls.length).toBe(clonesAtEnd);
    expect(onDiagnostics.mock.calls.length).toBe(reportsAtEnd);
  });

  it("cancela el arranque limpiamente si la sesión termina durante la carga inicial", async () => {
    let release: () => void = () => {};
    mocks.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = createMockXRSession();
    vi.stubGlobal("navigator", {
      userAgent: "test-agent",
      xr: { requestSession: vi.fn().mockResolvedValue(mock.session) },
    });
    const container = document.createElement("div");
    const onEnd = vi.fn();
    const starting = startWebXRValidationRuntime({
      availableModules: [MOCK_MODULE],
      container,
      fabrica: new FabricaActivos3D(),
      onDiagnostics: vi.fn(),
      onEnd,
      overlayRoot: document.createElement("div"),
      primaryModule: MOCK_MODULE,
      targetCount: 1,
    });

    await vi.waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());
    expect(() => mock.emit("end")).not.toThrow();
    release();

    await expect(starting).rejects.toThrow("terminó durante el arranque");
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(container.children.length).toBe(0);
    expect(mock.listeners.get("select")?.size ?? 0).toBe(0);
  });
});

