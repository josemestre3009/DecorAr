import { describe, expect, it } from "vitest";

import {
  clearSelection,
  EMPTY_WEBXR_SCENE,
  gestureRotationDegrees,
  moveSelected,
  placeInstance,
  resetScene,
  rotateSelected,
  selectInstance,
} from "./webxr-scene-state";

describe("estado de la escena WebXR", () => {
  it("limita a tres instancias con transformaciones independientes", () => {
    let state = EMPTY_WEBXR_SCENE;
    state = placeInstance(state, { x: 1, y: 0, z: 1 });
    state = placeInstance(state, { x: 2, y: 0, z: 2 });
    state = placeInstance(state, { x: 3, y: 0, z: 3 });
    state = placeInstance(state, { x: 4, y: 0, z: 4 });

    expect(state.instances).toHaveLength(3);
    state = selectInstance(state, 1);
    state = moveSelected(state, { x: 9, y: 0, z: 9 });
    state = rotateSelected(state, -15);

    expect(state.instances[0]).toMatchObject({
      position: { x: 9, y: 0, z: 9 },
      rotationDegrees: 345,
    });
    expect(state.instances[1]).toMatchObject({
      position: { x: 2, y: 0, z: 2 },
      rotationDegrees: 0,
    });
  });

  it("descarta selección y transformaciones al reiniciar", () => {
    const state = placeInstance(EMPTY_WEBXR_SCENE, { x: 1, y: 2, z: 3 });

    expect(clearSelection(state).selectedId).toBeNull();
    expect(resetScene()).toEqual(EMPTY_WEBXR_SCENE);
    expect(resetScene()).not.toBe(state);
  });

  it("calcula el giro angular de dos entradas", () => {
    expect(
      gestureRotationDegrees(
        [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
        [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
      ),
    ).toBeCloseTo(90);
  });
});
