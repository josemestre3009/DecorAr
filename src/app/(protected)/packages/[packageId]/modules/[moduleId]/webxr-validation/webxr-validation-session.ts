import * as THREE from "three";

export type XRSessionHandle = Readonly<{
  session: XRSession;
  renderer: THREE.WebGLRenderer;
  localSpace: XRReferenceSpace;
  run(
    camera: THREE.Camera,
    onFrame: (time: number, frame: XRFrame | undefined) => void,
  ): void;
  reticlePosition(): THREE.Vector3 | null;
  end(): Promise<void>;
  close(): Promise<void>;
}>;

type XRSessionOptions = Readonly<{
  container: HTMLElement;
  overlayRoot: HTMLElement;
  scene: THREE.Scene;
  onEnded(): void;
  onFailure(message: string): void;
}>;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function startXRSession(options: XRSessionOptions): Promise<XRSessionHandle> {
  const { container, overlayRoot, scene } = options;
  if (!navigator.xr) throw new Error("WebXR no está disponible.");

  const session = await navigator.xr.requestSession("immersive-ar", {
    domOverlay: { root: overlayRoot },
    optionalFeatures: ["dom-overlay", "local-floor"],
    requiredFeatures: ["hit-test"],
  });

  let ready = false;
  let ended = false;
  let closed = false;
  let hitTestSource: XRHitTestSource | null = null;
  let renderer: THREE.WebGLRenderer | null = null;

  const reticleGeometry = new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2);
  const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0xb8ff5a });
  const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;

  const preventSelect = (event: Event) => event.preventDefault();
  const onSessionEnd = () => {
    ended = true;
    if (ready) options.onEnded();
  };

  overlayRoot.addEventListener("beforexrselect", preventSelect);
  session.addEventListener("end", onSessionEnd, { once: true });

  async function close() {
    if (closed) return;
    closed = true;

    overlayRoot.removeEventListener("beforexrselect", preventSelect);
    session.removeEventListener("end", onSessionEnd);

    try {
      hitTestSource?.cancel();
    } catch (error) {
      options.onFailure(`Error cancelando hitTestSource: ${describe(error)}`);
    }

    let ending: Promise<void> | null = null;
    if (!ended) {
      ended = true;
      ending = session.end();
    }

    renderer?.setAnimationLoop(null);
    scene.remove(reticle);
    reticleGeometry.dispose();
    reticleMaterial.dispose();
    if (renderer) {
      renderer.dispose();
      renderer.domElement.remove();
    }

    try {
      await ending;
    } catch (error) {
      options.onFailure(`Error finalizando sesión: ${describe(error)}`);
    }
  }

  try {
    const activeRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer = activeRenderer;
    activeRenderer.xr.enabled = true;
    activeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    activeRenderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
    );
    container.append(activeRenderer.domElement);
    await activeRenderer.xr.setSession(session);

    scene.add(reticle);

    const localSpace = await session.requestReferenceSpace("local");
    const viewerSpace = await session.requestReferenceSpace("viewer");
    const source = await session.requestHitTestSource?.({ space: viewerSpace });
    if (!source) throw new Error("El navegador no entregó hit-test.");
    hitTestSource = source;
    ready = true;

    return {
      close,
      async end() {
        if (!ended) await session.end();
      },
      localSpace,
      reticlePosition() {
        return reticle.visible
          ? new THREE.Vector3().setFromMatrixPosition(reticle.matrix)
          : null;
      },
      renderer: activeRenderer,
      run(camera, onFrame) {
        activeRenderer.setAnimationLoop((time, frame) => {
          if (frame) {
            const pose = frame.getHitTestResults(source)[0]?.getPose(localSpace);
            reticle.visible = Boolean(pose);
            if (pose) reticle.matrix.fromArray(pose.transform.matrix);
          }
          onFrame(time, frame);
          activeRenderer.render(scene, camera);
        });
      },
      session,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
