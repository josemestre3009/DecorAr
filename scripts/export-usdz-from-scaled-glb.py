import shutil
import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
ASSETS = {
    "mesa": ("mahogany_table.glb", "Mahogany_Table.usdz", "poster-table.webp"),
    "arco": ("flower_arch.glb", "Flower_Arch.usdz", "poster-arch.webp"),
    "pista": (
        "animated_dance_floor_neon_lights.glb",
        "Animated_Dance_Floor_neon_lights.usdz",
        "poster-dancefloor.webp",
    ),
}


def main():
    if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1 :]) != 2:
        raise RuntimeError("Pass exactly two args (asset id, version) after --")
    asset_id, version = sys.argv[sys.argv.index("--") + 1 :]
    if asset_id not in ASSETS:
        raise RuntimeError(f"Unknown asset: {asset_id}")

    glb, usdz, poster = ASSETS[asset_id]
    output = ROOT / "assets" / "3d" / asset_id / f"v{version}"

    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(output / glb))
    if result != {"FINISHED"}:
        raise RuntimeError(f"Could not import {output / glb}")
    if asset_id == "arco":
        for obj in bpy.context.scene.objects:
            if obj.type == "MESH":
                modifier = obj.modifiers.new(name="USDZ mobile decimation", type="DECIMATE")
                modifier.ratio = 0.45
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.modifier_apply(modifier=modifier.name)
    result = bpy.ops.wm.usd_export(
        filepath=str(output / usdz),
        export_animation=False,
        export_cameras=False,
        export_lights=False,
        convert_scene_units="METERS",
        meters_per_unit=1.0,
        usdz_downscale_size="1024",
    )
    if result != {"FINISHED"}:
        raise RuntimeError(f"Could not export {output / usdz}")

    previous = ROOT / "assets" / "3d" / asset_id / f"v{int(version) - 1}"
    poster_source = previous / poster if (previous / poster).exists() else ROOT / "assets" / "3d" / asset_id / "v1" / poster
    shutil.copy2(poster_source, output / poster)
    print(f"{asset_id}: exported USDZ from GLB v{version}", flush=True)


if __name__ == "__main__":
    main()
