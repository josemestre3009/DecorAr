import type * as THREE from "three";

import type { FabricaActivos3D } from "@/modules/ar/domain/fabrica-activos-3d";

export type WebXRValidationDiagnostics = Readonly<{
  domOverlay: boolean;
  fpsCurrent: number;
  fpsMin: number;
  fpsAverage: number;
  memory: string;
  objectCount: number;
  targetCount: number;
  grantedFeatures: string;
  lastEvent: string;
  failures: string;
  activosFlyweight: number;
  renderInfo: Readonly<{
    geometries: number;
    textures: number;
    calls: number;
    triangles: number;
  }>;
}>;

type FpsSnapshot = Readonly<{ fpsCurrent: number; fpsMin: number; fpsAverage: number }>;

export type FpsMeter = Readonly<{
  recordFrame(time: number): boolean;
  snapshot(): FpsSnapshot;
}>;

type DiagnosticsInput = Readonly<{
  session: XRSession;
  renderer: THREE.WebGLRenderer;
  fabrica: FabricaActivos3D;
  failures: readonly string[];
  lastEvent: string;
  targetCount: number;
  objectCount: number;
  fps: FpsSnapshot;
}>;

export function createFpsMeter(startedAt: number = performance.now()): FpsMeter {
  let frameCount = 0;
  let totalFrames = 0;
  let windowStartedAt = startedAt;
  let fpsCurrent = 0;
  let fpsMin = Number.POSITIVE_INFINITY;
  let fpsAverage = 0;

  return {
    recordFrame(time) {
      frameCount += 1;
      totalFrames += 1;

      const deltaSec = (time - windowStartedAt) / 1000;
      if (deltaSec < 1) return false;

      fpsCurrent = Math.round(frameCount / deltaSec);
      fpsMin = Math.min(fpsMin, fpsCurrent);
      frameCount = 0;
      windowStartedAt = time;

      const totalTimeMs = time - startedAt;
      if (totalTimeMs > 0) fpsAverage = Math.round((totalFrames * 1000) / totalTimeMs);
      return true;
    },
    snapshot() {
      return {
        fpsAverage,
        fpsCurrent,
        fpsMin: Number.isFinite(fpsMin) ? fpsMin : 0,
      };
    },
  };
}

export function readMemoryUsage(): string {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };
  if (perf.memory && typeof perf.memory.usedJSHeapSize === "number") {
    return `${(perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  return "n/d";
}

export function buildDiagnostics(input: DiagnosticsInput): WebXRValidationDiagnostics {
  const { renderer, session } = input;
  return {
    activosFlyweight: input.fabrica.activosCreados,
    domOverlay: session.domOverlayState?.type !== undefined,
    failures: input.failures.length > 0 ? input.failures.join(" | ") : "ninguno",
    fpsAverage: input.fps.fpsAverage,
    fpsCurrent: input.fps.fpsCurrent,
    fpsMin: input.fps.fpsMin,
    grantedFeatures: Array.from(session.enabledFeatures ?? []).join(", ") || "hit-test",
    lastEvent: input.lastEvent,
    memory: readMemoryUsage(),
    objectCount: input.objectCount,
    renderInfo: {
      calls: renderer.info.render.calls,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      triangles: renderer.info.render.triangles,
    },
    targetCount: input.targetCount,
  };
}

export function serializeDiagnostics(diagnostics: WebXRValidationDiagnostics): string {
  return JSON.stringify(
    {
      ...diagnostics,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    },
    null,
    2,
  );
}
