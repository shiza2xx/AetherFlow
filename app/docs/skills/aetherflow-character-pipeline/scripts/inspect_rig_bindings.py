"""Trusted, read-only inspection of actual deform-armature mesh bindings."""
import hashlib
import json
import os
import sys
import traceback

import bpy


def run(cfg):
    source = os.path.abspath(cfg["source"])
    if not source.lower().endswith(".blend") or not os.path.isfile(source) or os.path.islink(source):
        raise ValueError("Rig inspection requires a regular staged .blend file.")
    hasher = hashlib.sha256()
    with open(source, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    if digest != cfg.get("sourceHash"):
        raise ValueError("Staged rig source hash mismatch.")
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=source)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    private_root = os.path.realpath(cfg["privateRoot"])
    for image in bpy.data.images:
        if image.packed_file or image.type in ("RENDER_RESULT", "COMPOSITING"):
            continue
        if image.source != "FILE":
            raise ValueError("Pack generated, tiled or movie image dependencies before workbench use: " + image.name)
        image_file = os.path.realpath(bpy.path.abspath(image.filepath))
        try:
            if os.path.commonpath([private_root, image_file]) != private_root or not os.path.isfile(image_file):
                raise ValueError("Rig inspection found an image dependency outside the private staged tree: " + image.name)
        except ValueError:
            raise ValueError("Rig inspection found an image dependency outside the private staged tree: " + image.name)
    arms = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE" and any(bone.use_deform for bone in obj.data.bones)}
    bound = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        arm = obj.find_armature()
        if not arm or arm.name not in arms or not obj.vertex_groups:
            continue
        deform = {bone.name for bone in arm.data.bones if bone.use_deform}
        if any(group.name in deform for group in obj.vertex_groups):
            bound.append(obj.name)
    return {"schemaVersion": 1, "ok": bool(arms and bound), "sourceHash": digest,
            "armatures": sorted(arms), "boundRigObjects": sorted(bound), "blenderVersion": bpy.app.version_string}


def main():
    config_path = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
    cfg = json.load(open(config_path, encoding="utf-8"))
    report = os.path.abspath(cfg["report"])
    if os.path.exists(report) or report in (os.path.abspath(cfg["source"]), config_path):
        raise ValueError("Rig report needs a fresh distinct path.")
    try:
        result = run(cfg)
    except Exception as exc:
        result = {"schemaVersion": 1, "ok": False, "sourceHash": cfg.get("sourceHash"),
                  "boundRigObjects": [], "error": str(exc)}
        traceback.print_exc()
    os.makedirs(os.path.dirname(report), exist_ok=True)
    with open(report, "x", encoding="utf-8") as out:
        json.dump(result, out, indent=2, allow_nan=False)


if __name__ == "__main__":
    main()
