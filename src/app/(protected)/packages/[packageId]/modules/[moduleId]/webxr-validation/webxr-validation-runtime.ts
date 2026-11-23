import * as THREE from "three";

import type { Activo3DCompartido } from "@/modules/ar/domain/activo-3d-compartido";
import {
  calcularPosicionesDisposicion,
  calcularRotacionGesto,
  colocarEnEscena,
  deseleccionarEnEscena,
  LIMITE_INSTANCIAS_POR_DEFECTO,
  moverSeleccionado,
  resetearEscena,
  rotarSeleccionado,
  seleccionarEnEscena,
  type EscenaWebXR,
} from "@/modules/ar/domain/escena-webxr";
import type { FabricaActivos3D } from "@/modules/ar/domain/fabrica-activos-3d";

import {
  buildDiagnostics,
  createFpsMeter,
  serializeDiagnostics,
  type WebXRValidationDiagnostics,
} from "./webxr-validation-metrics";
import {
  createModelLibrary,
  ModelLibraryDisposedError,
  type WebXRValidationModule,
} from "./webxr-validation-models";
import { startXRSession, type XRSessionHandle } from "./webxr-validation-session";

export type { WebXRValidationDiagnostics } from "./webxr-validation-metrics";
export type { WebXRValidationModule } from "./webxr-validation-models";

export type WebXRValidationRuntime = Readonly<{
  add(): void;
  populateTarget(count: number): void;
  rotate(degrees: number): void;
  reset(): void;
  end(): Promise<void>;
  exportDiagnostics(): string;
}>;

type RuntimeOptions = Readonly<{
  primaryModule: WebXRValidationModule;
  availableModules: readonly WebXRValidationModule[];
  fabrica: FabricaActivos3D;
  targetCount: number;
  container: HTMLElement;
  overlayRoot: HTMLElement;
  onDiagnostics(diagnostics: WebXRValidationDiagnostics): void;
  onEnd(failed: boolean): void;
}>;

type Point = { x: number; y: number; z: number };

const radians = (degrees: number) => THREE.MathUtils.degToRad(degrees);
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function startWebXRValidationRuntime(
  options: RuntimeOptions,
): Promise<WebXRValidationRuntime> {
  if (!navigator.xr) throw new Error("WebXR no está disponible.");

  let targetCount = options.targetCount;
  let lastEvent = "session-start";
  let ended = false;
  let sessionFailed = false;
  let handle: XRSessionHandle | null = null;
  const failureList: string[] = [];
  const fps = createFpsMeter();
  const inputCounters = { select: 0, selectstart: 0 };

  const initialScene = resetearEscena(LIMITE_INSTANCIAS_POR_DEFECTO);
  if (!initialScene.ok) throw initialScene.error;
  let sceneState: EscenaWebXR = initialScene.value;

  function report() {
    if (!handle) return;
    options.onDiagnostics(snapshotDiagnostics(handle));
  }

  function snapshotDiagnostics(active: XRSessionHandle) {
    return buildDiagnostics({
      failures: failureList,
      fabrica: options.fabrica,
      assetStatus: models.status(),
      fps: fps.snapshot(),
      inputCounters,
      lastEvent,
      objectCount: sceneState.instancias.length,
      renderer: active.renderer,
      sceneChildren: scene.children.length,
      session: active.session,
      targetCount,
      xrStats: active.stats(),
    });
  }

  function recordFailure(message: string) {
    if (!failureList.includes(message)) failureList.push(message);
    report();
  }

  function resetScene() {
    const result = resetearEscena(LIMITE_INSTANCIAS_POR_DEFECTO);
    if (result.ok) sceneState = result.value;
    else recordFailure(result.error.message);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 30);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.5));

  const models = createModelLibrary({
    onWarning: recordFailure,
    resolveMeta: (activo) =>
      options.availableModules.find(
        (m) => m.assetId === activo.assetId && m.version === activo.version,
      ) ?? options.primaryModule,
  });

  const threeObjects = new Map<number, THREE.Object3D>();
  let activeHandle: XRSessionHandle | null = null;
  let selectListener: EventListener | null = null;
  let selectStartListener: EventListener | null = null;
  let selectEndListener: EventListener | null = null;

  function cleanup() {
    if (ended) return;
    ended = true;

    if (activeHandle) {
      const { session } = activeHandle;
      if (selectListener) session.removeEventListener("select", selectListener);
      if (selectStartListener) session.removeEventListener("selectstart", selectStartListener);
      if (selectEndListener) session.removeEventListener("selectend", selectEndListener);
    }

    for (const obj of threeObjects.values()) scene.remove(obj);
    threeObjects.clear();
    models.dispose();

    void activeHandle?.close();
    resetScene();
    options.onEnd(sessionFailed);
  }

  activeHandle = await startXRSession({
    container: options.container,
    onEnded: () => cleanup(),
    onFailure: (message) => {
      sessionFailed = true;
      recordFailure(message);
    },
    overlayRoot: options.overlayRoot,
    scene,
  }).catch((error: unknown) => {
    models.dispose();
    throw error;
  });
  if (ended) throw new Error("La sesión WebXR terminó durante el arranque.");
  const active = activeHandle;
  handle = active;
  const { session } = active;

  const initialActivo = options.fabrica.obtener(options.primaryModule);
  if (!initialActivo.ok) {
    recordFailure(initialActivo.error.message);
  } else {
    try {
      await models.load(initialActivo.value, options.primaryModule);
      if (ended) throw new Error("La sesión WebXR terminó durante el arranque.");
    } catch (error) {
      if (ended) throw new Error("La sesión WebXR terminó durante el arranque.");
      recordFailure(`Fallo cargando GLB inicial: ${describe(error)}`);
    }
  }

  const catalogActivos: Activo3DCompartido[] = [];
  for (const mod of options.availableModules) {
    const activo = options.fabrica.obtener(mod);
    if (activo.ok) catalogActivos.push(activo.value);
  }
  if (catalogActivos.length === 0 && initialActivo.ok) catalogActivos.push(initialActivo.value);

  const raycaster = new THREE.Raycaster();
  const activeSources = new Set<XRInputSource>();
  let gestureStartPoints: readonly [Point, Point] | null = null;
  let gestureStartRotation = 0;
  let isSyncing = false;
  let syncRequested = false;

  async function syncThreeObjects() {
    if (isSyncing) {
      syncRequested = true;
      return;
    }
    isSyncing = true;
    try {
      do {
        syncRequested = false;
        const currentIds = new Set(sceneState.instancias.map((i) => i.id));

        for (const [id, obj] of threeObjects.entries()) {
          if (!currentIds.has(id)) {
            scene.remove(obj);
            threeObjects.delete(id);
          }
        }

        for (const item of sceneState.instancias) {
          if (ended) return;
          let object = threeObjects.get(item.id);
          if (!object) {
            try {
              const baseModel = await models.load(item.instancia.activo);
              if (ended) return;
              object = baseModel.clone(true);
              object.userData.instanceId = item.id;
              threeObjects.set(item.id, object);
              scene.add(object);
            } catch (error) {
              if (error instanceof ModelLibraryDisposedError || ended) return;
              recordFailure(`Fallo clonando/cargando modelo instancia ${item.id}: ${describe(error)}`);
            }
          }
          if (object) {
            const { posicion, rotacionGrados } = item.instancia;
            object.position.set(posicion.x, posicion.y, posicion.z);
            object.rotation.y = radians(rotacionGrados);
          }
        }
      } while (syncRequested && !ended);
    } finally {
      isSyncing = false;
      if (!ended) report();
    }
  }

  function inputPoint(source: XRInputSource, frame: XRFrame): Point | null {
    const space = active.referenceSpace();
    if (!space) return null;
    const pose = frame.getPose(source.targetRaySpace, space);
    if (!pose) return null;
    return { x: pose.transform.position.x, y: 0, z: pose.transform.position.z };
  }

  function selectedRotation() {
    const selected = sceneState.instancias.find((i) => i.id === sceneState.idSeleccionado);
    return selected?.instancia.rotacionGrados ?? 0;
  }

  function updateGesture(frame: XRFrame) {
    if (activeSources.size !== 2 || sceneState.idSeleccionado === null) {
      gestureStartPoints = null;
      return;
    }
    const [first, second] = [...activeSources];
    if (!first || !second) return;
    const a = inputPoint(first, frame);
    const b = inputPoint(second, frame);
    if (!a || !b) return;

    if (gestureStartPoints === null) {
      gestureStartPoints = [a, b];
      gestureStartRotation = selectedRotation();
      return;
    }

    const delta = calcularRotacionGesto(gestureStartPoints, [a, b]);
    const rotateResult = rotarSeleccionado(
      sceneState,
      gestureStartRotation + delta - selectedRotation(),
    );
    if (rotateResult.ok) {
      sceneState = rotateResult.value;
      lastEvent = "two-point-rotate";
      void syncThreeObjects();
    }
  }

  async function onSelect(event: XRInputSourceEvent) {
    inputCounters.select += 1;
    lastEvent = `select:${event.inputSource.targetRayMode}`;
    const space = active.referenceSpace();
    const pose = space ? event.frame.getPose(event.inputSource.targetRaySpace, space) : null;
    if (pose) {
      const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
      raycaster.ray.origin.setFromMatrixPosition(matrix);
      raycaster.ray.direction.set(0, 0, -1).transformDirection(matrix);
      const hit = raycaster.intersectObjects([...threeObjects.values()], true)[0];
      let owner: THREE.Object3D | null | undefined = hit?.object;
      while (owner && owner.userData.instanceId === undefined) owner = owner.parent;
      const id = Number(owner?.userData.instanceId);
      if (Number.isFinite(id)) {
        sceneState = seleccionarEnEscena(sceneState, id);
        report();
        return;
      }
    }

    const position = active.reticlePosition();
    if (!position) {
      recordFailure(
        "Toque ignorado: la retícula no está visible; apunta al piso y mueve el teléfono",
      );
      return;
    }
    const point = { x: position.x, y: position.y, z: position.z };

    if (sceneState.idSeleccionado === null || sceneState.instancias.length === 0) {
      const activo =
        catalogActivos[sceneState.instancias.length % catalogActivos.length] ??
        (initialActivo.ok ? initialActivo.value : null);
      if (activo) {
        const placed = colocarEnEscena(sceneState, activo, point);
        if (placed.ok) sceneState = placed.value;
        else recordFailure(placed.error.message);
      }
    } else {
      const moved = moverSeleccionado(sceneState, point);
      if (moved.ok) sceneState = moved.value;
      else recordFailure(moved.error.message);
    }
    await syncThreeObjects();
  }

  selectListener = (event: Event) => {
    void onSelect(event as XRInputSourceEvent);
  };
  selectStartListener = (event: Event) => {
    const { inputSource } = event as XRInputSourceEvent;
    activeSources.add(inputSource);
    inputCounters.selectstart += 1;
    lastEvent = `selectstart:${inputSource.targetRayMode}`;
    report();
  };
  selectEndListener = (event: Event) => {
    const { inputSource } = event as XRInputSourceEvent;
    activeSources.delete(inputSource);
    gestureStartPoints = null;
    lastEvent = `selectend:${inputSource.targetRayMode}`;
    report();
  };

  session.addEventListener("select", selectListener);
  session.addEventListener("selectstart", selectStartListener);
  session.addEventListener("selectend", selectEndListener);

  active.run(camera, (time, frame) => {
    if (frame) updateGesture(frame);
    if (fps.recordFrame(time)) report();
  });

  report();

  return {
    add() {
      if (sceneState.instancias.length >= sceneState.limiteInstancias) {
        recordFailure(`Límite de ${sceneState.limiteInstancias} instancias alcanzado; no se puede añadir más.`);
        return;
      }
      sceneState = deseleccionarEnEscena(sceneState);
      lastEvent = "add-mode";
      report();
    },
    async end() {
      if (!ended) await active.end();
    },
    exportDiagnostics() {
      return serializeDiagnostics(snapshotDiagnostics(active));
    },
    populateTarget(count) {
      targetCount = count;
      lastEvent = `populate-target:${count}`;

      const center = active.reticlePosition();
      if (!center) {
        recordFailure("No se puede poblar: apunta al piso hasta que la retícula esté visible.");
        return;
      }

      resetScene();
      const posiciones = calcularPosicionesDisposicion(count, {
        x: center.x,
        y: center.y,
        z: center.z,
      });
      posiciones.forEach((posicion, index) => {
        const activo = catalogActivos[index % catalogActivos.length];
        if (!activo) return;
        const placed = colocarEnEscena(sceneState, activo, posicion);
        if (placed.ok) sceneState = placed.value;
        else recordFailure(placed.error.message);
      });

      sceneState = deseleccionarEnEscena(sceneState);
      void syncThreeObjects();
    },
    reset() {
      resetScene();
      lastEvent = "reset-scene";
      void syncThreeObjects();
    },
    rotate(degrees) {
      const rotated = rotarSeleccionado(sceneState, degrees);
      if (rotated.ok) {
        sceneState = rotated.value;
        lastEvent = degrees < 0 ? "rotate:-15" : "rotate:+15";
        void syncThreeObjects();
      } else {
        recordFailure(rotated.error.message);
      }
    },
  };
}
