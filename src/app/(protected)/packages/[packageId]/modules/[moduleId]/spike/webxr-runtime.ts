import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  EMPTY_WEBXR_SCENE,
  WEBXR_INSTANCE_LIMIT,
  clearSelection,
  gestureRotationDegrees,
  moveSelected,
  placeInstance,
  rotateSelected,
  selectInstance,
  type WebXRSceneState,
} from "../../../../_lib/webxr-scene-state";

export type WebXRDiagnostics = Readonly<{
  domOverlay: boolean;
  fps: number;
  grantedFeatures: string;
  lastEvent: string;
  objectCount: number;
}>;

export type WebXRRuntime = Readonly<{
  add(): void;
  end(): Promise<void>;
  rotate(degrees: number): void;
}>;

type RuntimeOptions = Readonly<{
  assetUrl: string;
  container: HTMLElement;
  overlayRoot: HTMLElement;
  onDiagnostics(value: WebXRDiagnostics): void;
  onEnd(): void;
}>;

const radians = (degrees: number) => THREE.MathUtils.degToRad(degrees);

export async function startWebXRRuntime(options: RuntimeOptions): Promise<WebXRRuntime> {
  if (!navigator.xr) throw new Error("WebXR no está disponible.");

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(options.container.clientWidth || window.innerWidth, options.container.clientHeight || window.innerHeight);
  options.container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 30);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.5));

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xb8ff5a }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const session = await navigator.xr.requestSession("immersive-ar", {
    optionalFeatures: ["dom-overlay", "local-floor"],
    requiredFeatures: ["hit-test"],
    domOverlay: { root: options.overlayRoot },
  });
  await renderer.xr.setSession(session);

  let gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
  let localSpace: XRReferenceSpace;
  let viewerSpace: XRReferenceSpace;
  let hitTestSource: XRHitTestSource;
  try {
    gltf = await new GLTFLoader().loadAsync(options.assetUrl);
    localSpace = await session.requestReferenceSpace("local");
    viewerSpace = await session.requestReferenceSpace("viewer");
    const requestedHitTestSource = await session.requestHitTestSource?.({ space: viewerSpace });
    if (!requestedHitTestSource) throw new Error("El navegador no entregó hit-test.");
    hitTestSource = requestedHitTestSource;
  } catch (error) {
    await session.end();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }

  const model = gltf.scene;
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });

  let state: WebXRSceneState = EMPTY_WEBXR_SCENE;
  const objects = new Map<number, THREE.Object3D>();
  const raycaster = new THREE.Raycaster();
  const activeSources = new Set<XRInputSource>();
  let gestureStartPoints: readonly [THREE.Vector2, THREE.Vector2] | null = null;
  let gestureStartRotation = 0;
  let lastEvent = "session-start";
  let frameCount = 0;
  let fpsStartedAt = performance.now();
  let fps = 0;
  let ended = false;

  const grantedFeatures = Array.from(session.enabledFeatures ?? []).join(", ") || "hit-test";
  const domOverlay = session.domOverlayState?.type !== undefined;

  function report() {
    options.onDiagnostics({ domOverlay, fps, grantedFeatures, lastEvent, objectCount: state.instances.length });
  }

  function syncObjects() {
    for (const instance of state.instances) {
      let object = objects.get(instance.id);
      if (!object) {
        object = model.clone(true);
        object.userData.instanceId = instance.id;
        objects.set(instance.id, object);
        scene.add(object);
      }
      object.position.set(instance.position.x, instance.position.y, instance.position.z);
      object.rotation.y = radians(instance.rotationDegrees);
    }
    report();
  }

  function inputPoint(source: XRInputSource, frame: XRFrame): THREE.Vector2 | null {
    const pose = frame.getPose(source.targetRaySpace, localSpace);
    if (!pose) return null;
    return new THREE.Vector2(pose.transform.position.x, pose.transform.position.z);
  }

  function updateGesture(frame: XRFrame) {
    if (activeSources.size !== 2 || state.selectedId === null) {
      gestureStartPoints = null;
      return;
    }
    const [first, second] = [...activeSources];
    const a = inputPoint(first, frame);
    const b = inputPoint(second, frame);
    if (!a || !b) return;
    if (gestureStartPoints === null) {
      gestureStartPoints = [a, b];
      gestureStartRotation = state.instances.find((item) => item.id === state.selectedId)?.rotationDegrees ?? 0;
      return;
    }
    const delta = gestureRotationDegrees(
      [
        { x: gestureStartPoints[0].x, y: 0, z: gestureStartPoints[0].y },
        { x: gestureStartPoints[1].x, y: 0, z: gestureStartPoints[1].y },
      ],
      [
        { x: a.x, y: 0, z: a.y },
        { x: b.x, y: 0, z: b.y },
      ],
    );
    const current = state.instances.find((item) => item.id === state.selectedId)?.rotationDegrees ?? 0;
    state = rotateSelected(state, gestureStartRotation + delta - current);
    lastEvent = "two-point-rotate";
    syncObjects();
  }

  function onSelect(event: XRInputSourceEvent) {
    lastEvent = `select:${event.inputSource.targetRayMode}`;
    const pose = event.frame.getPose(event.inputSource.targetRaySpace, localSpace);
    if (pose) {
      const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
      raycaster.ray.origin.setFromMatrixPosition(matrix);
      raycaster.ray.direction.set(0, 0, -1).transformDirection(matrix);
      const hit = raycaster.intersectObjects([...objects.values()], true)[0];
      let owner: THREE.Object3D | null | undefined = hit?.object;
      while (owner && owner.userData.instanceId === undefined) owner = owner.parent;
      const id = Number(owner?.userData.instanceId);
      if (Number.isFinite(id)) {
        state = selectInstance(state, id);
        report();
        return;
      }
    }

    if (!reticle.visible) return;
    const position = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    state = state.selectedId === null || state.instances.length === 0
      ? placeInstance(state, position, WEBXR_INSTANCE_LIMIT)
      : moveSelected(state, position);
    syncObjects();
  }

  const onSelectStart = (event: XRInputSourceEvent) => {
    activeSources.add(event.inputSource);
    lastEvent = `selectstart:${event.inputSource.targetRayMode}`;
    report();
  };
  const onSelectEnd = (event: XRInputSourceEvent) => {
    activeSources.delete(event.inputSource);
    gestureStartPoints = null;
    lastEvent = `selectend:${event.inputSource.targetRayMode}`;
    report();
  };

  session.addEventListener("select", onSelect);
  session.addEventListener("selectstart", onSelectStart);
  session.addEventListener("selectend", onSelectEnd);
  session.addEventListener("end", cleanup, { once: true });

  renderer.setAnimationLoop((time, frame) => {
    if (frame) {
      const hits = frame.getHitTestResults(hitTestSource);
      const pose = hits[0]?.getPose(localSpace);
      reticle.visible = Boolean(pose);
      if (pose) reticle.matrix.fromArray(pose.transform.matrix);
      updateGesture(frame);
    }
    frameCount += 1;
    if (time - fpsStartedAt >= 1000) {
      fps = Math.round((frameCount * 1000) / (time - fpsStartedAt));
      frameCount = 0;
      fpsStartedAt = time;
      report();
    }
    renderer.render(scene, camera);
  });

  function cleanup() {
    if (ended) return;
    ended = true;
    renderer.setAnimationLoop(null);
    hitTestSource.cancel();
    renderer.dispose();
    renderer.domElement.remove();
    state = EMPTY_WEBXR_SCENE;
    objects.clear();
    options.onEnd();
  }

  report();

  return {
    add() {
      if (state.instances.length < WEBXR_INSTANCE_LIMIT) {
        state = clearSelection(state);
        lastEvent = "add-mode";
        report();
      }
    },
    async end() {
      if (!ended) await session.end();
    },
    rotate(degrees) {
      state = rotateSelected(state, degrees);
      lastEvent = degrees < 0 ? "rotate:-15" : "rotate:+15";
      syncObjects();
    },
  };
}
