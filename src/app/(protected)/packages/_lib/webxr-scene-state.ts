export type ScenePosition = Readonly<{ x: number; y: number; z: number }>;

export type SceneInstance = Readonly<{
  id: number;
  position: ScenePosition;
  rotationDegrees: number;
}>;

export type WebXRSceneState = Readonly<{
  instances: readonly SceneInstance[];
  nextId: number;
  selectedId: number | null;
}>;

export const WEBXR_INSTANCE_LIMIT = 3;

export const EMPTY_WEBXR_SCENE: WebXRSceneState = Object.freeze({
  instances: Object.freeze([]),
  nextId: 1,
  selectedId: null,
});

function normalizeDegrees(value: number): number {
  const remainder = value % 360;
  return remainder < 0 ? remainder + 360 : remainder;
}

export function placeInstance(
  state: WebXRSceneState,
  position: ScenePosition,
  limit = WEBXR_INSTANCE_LIMIT,
): WebXRSceneState {
  if (state.instances.length >= limit) return state;

  const instance = Object.freeze({ id: state.nextId, position: Object.freeze({ ...position }), rotationDegrees: 0 });
  return Object.freeze({
    instances: Object.freeze([...state.instances, instance]),
    nextId: state.nextId + 1,
    selectedId: instance.id,
  });
}

export function selectInstance(state: WebXRSceneState, id: number): WebXRSceneState {
  return state.instances.some((instance) => instance.id === id)
    ? Object.freeze({ ...state, selectedId: id })
    : state;
}

export function clearSelection(state: WebXRSceneState): WebXRSceneState {
  return Object.freeze({ ...state, selectedId: null });
}

export function moveSelected(state: WebXRSceneState, position: ScenePosition): WebXRSceneState {
  if (state.selectedId === null) return state;

  return Object.freeze({
    ...state,
    instances: Object.freeze(
      state.instances.map((instance) =>
        instance.id === state.selectedId
          ? Object.freeze({ ...instance, position: Object.freeze({ ...position }) })
          : instance,
      ),
    ),
  });
}

export function rotateSelected(state: WebXRSceneState, degrees: number): WebXRSceneState {
  if (state.selectedId === null || !Number.isFinite(degrees)) return state;

  return Object.freeze({
    ...state,
    instances: Object.freeze(
      state.instances.map((instance) =>
        instance.id === state.selectedId
          ? Object.freeze({
              ...instance,
              rotationDegrees: normalizeDegrees(instance.rotationDegrees + degrees),
            })
          : instance,
      ),
    ),
  });
}

export function gestureRotationDegrees(
  start: readonly [ScenePosition, ScenePosition],
  current: readonly [ScenePosition, ScenePosition],
): number {
  const angle = (points: readonly [ScenePosition, ScenePosition]) =>
    Math.atan2(points[1].z - points[0].z, points[1].x - points[0].x);
  return ((angle(current) - angle(start)) * 180) / Math.PI;
}

export function resetScene(): WebXRSceneState {
  return EMPTY_WEBXR_SCENE;
}
