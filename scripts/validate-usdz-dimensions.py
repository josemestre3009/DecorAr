import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "mesa": "Mahogany_Table.usdz",
    "arco": "Flower_Arch.usdz",
    "pista": "Animated_Dance_Floor_neon_lights.usdz",
}
EXPECTED = {
    "mesa": (2.0, 1.187, 0.943),
    "arco": (2.445, 0.505, 2.4),
    "pista": (4.0, 4.0, 0.285),
}


def main():
    if "--" not in sys.argv or sys.argv[-1] not in FILES:
        raise RuntimeError("Pass one of mesa, arco or pista after --")
    asset_id = sys.argv[-1]
    path = ROOT / "assets" / "3d" / asset_id / "v2" / FILES[asset_id]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.wm.usd_import(filepath=str(path), import_textures_mode="IMPORT_NONE")
    if result != {"FINISHED"}:
        raise RuntimeError(f"Could not import {path}")

    points = []
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        raise RuntimeError(f"No mesh geometry in {path}")

    dimensions = tuple(
        round(max(point[i] for point in points) - min(point[i] for point in points), 3)
        for i in range(3)
    )
    if any(abs(actual - expected) > 0.02 for actual, expected in zip(dimensions, EXPECTED[asset_id])):
        raise RuntimeError(f"{asset_id}: expected {EXPECTED[asset_id]}, got {dimensions}")
    print(f"{asset_id}: USDZ Blender XYZ dimensions={dimensions}", flush=True)


if __name__ == "__main__":
    main()
