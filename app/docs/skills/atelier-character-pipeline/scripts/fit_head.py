"""Fit declared head-source groups as one rigid assembly on an immutable copy.

This verifies preservation, never anatomical correctness. A human must inspect
the saved candidate and approve the neck junction before creating a rig source.
"""
import importlib.util
import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from group_contract import valid_group_key, MAX_GROUPS
spec = importlib.util.spec_from_file_location("atelier_fit_validator", os.path.join(HERE, "validate_workflow.py"))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def vector(value, label, limit):
    if not isinstance(value, list) or len(value) != 3 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or abs(x) > limit for x in value):
        raise ValueError(label + " requires three finite bounded numbers.")
    return [float(x) for x in value]


def matrix_rows(matrix):
    return [[float(x) for x in row] for row in matrix]


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        raise ValueError("An explicit nonempty mesh group is required.")
    return {"min": [min(p[i] for p in points) for i in range(3)], "max": [max(p[i] for p in points) for i in range(3)]}


def preservation():
    # Blender discards unused, zero-user startup materials on save/reopen.
    # Compare every actual mesh slot, including slots unused by polygons.
    materials = {m.name: m for obj in bpy.context.scene.objects if obj.type == "MESH" for m in obj.data.materials if m}
    return {
        "meshes": {obj.name: validator.mesh_fingerprint(obj, full=False) for obj in bpy.context.scene.objects if obj.type == "MESH"},
        "weights": {obj.name: validator.weight_snapshot(obj, keep_rows=False)[-1] for obj in bpy.context.scene.objects if obj.type == "MESH"},
        "materials": {name: validator.material_graph_snapshot(materials[name], False) for name in sorted(materials)},
        "animation": validator.animation_fingerprint()["fingerprint"],
    }


def near_matrix(actual, expected):
    return all(abs(actual[i][j] - expected[i][j]) <= 2e-5 * max(1, abs(expected[i][j])) for i in range(4) for j in range(4))


def run(cfg):
    source, output = os.path.abspath(cfg["input"]), os.path.abspath(cfg["output"])
    if source == output or os.path.exists(output):
        raise ValueError("Fit output must be a new path, separate from the immutable source.")
    input_hash = validator.sha_file(source)
    if input_hash != cfg["inputHash"]:
        raise ValueError("Head-fit input hash does not match the managed source.")
    translation = vector(cfg.get("translation"), "Translation", 10000)
    rotation = vector(cfg.get("rotationDegrees"), "Rotation", 360)
    scale = cfg.get("scale")
    if isinstance(scale, bool) or not isinstance(scale, (float, int)) or not math.isfinite(scale) or not 0.01 <= scale <= 100:
        raise ValueError("Use a positive uniform head scale between 0.01 and 100.")
    groups = cfg.get("groups")
    if not isinstance(groups, list) or not groups or len(groups) > MAX_GROUPS or any(not isinstance(g, dict) or not valid_group_key(g.get("key")) or g.get("source") not in ("head", "body") for g in groups):
        raise ValueError("Use the exact registered group keys and their declared head/body sources.")
    if len({g["key"] for g in groups}) != len(groups) or not any(g["key"] == "head" and g["source"] == "head" for g in groups):
        raise ValueError("Group identities must be unique and include a head-source head.")
    if any(g["key"] in ("head", "hair") and g["source"] != "head" or g["key"] in ("upper_body", "lower_body") and g["source"] != "body" for g in groups):
        raise ValueError("Head/hair and body group provenance conflict.")
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=source)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    validator.enforce_blender_memory_budget("head fitting source")
    bpy.context.view_layer.update()
    meshes = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == "MESH"}
    expected_names = {"Atelier_" + g["key"] for g in groups}
    if set(meshes) != expected_names:
        raise ValueError("Assembly mesh identities do not exactly match the registered texture-group manifest.")
    # Pre-rig stage only: animated/constrained transforms cannot be overridden
    # faithfully by a simple static placement. Keep them for a separate repair.
    if any(obj.type == "ARMATURE" or obj.constraints or obj.animation_data or obj.parent or obj.modifiers for obj in bpy.context.scene.objects):
        raise ValueError("Head fitting requires a static, unparented pre-rig assembly without modifiers, constraints or animation bindings.")
    head_names = ["Atelier_" + g["key"] for g in groups if g["source"] == "head"]
    body_names = ["Atelier_" + g["key"] for g in groups if g["source"] == "body"]
    if not body_names:
        raise ValueError("A body-source group must remain fixed during head fitting.")
    before = preservation()
    transforms = {obj.name: obj.matrix_world.copy() for obj in bpy.context.scene.objects}
    head_box = bounds([meshes["Atelier_head"]])
    pivot = Vector([(head_box["min"][i] + head_box["max"][i]) / 2 for i in range(3)])
    before_bounds = {"head": bounds([meshes[n] for n in head_names]), "body": bounds([meshes[n] for n in body_names])}
    delta = Matrix.Translation(Vector(translation)) @ Matrix.Translation(pivot) @ Euler([math.radians(x) for x in rotation], "XYZ").to_matrix().to_4x4() @ Matrix.Scale(float(scale), 4) @ Matrix.Translation(-pivot)
    for name in head_names:
        meshes[name].matrix_world = delta @ transforms[name]
    bpy.context.view_layer.update()
    expected = {name: delta @ matrix if name in head_names else matrix for name, matrix in transforms.items()}
    if preservation() != before:
        raise ValueError("Head fitting changed mesh, UV, normals, weights, material/image graphs or animation data.")
    if any(not near_matrix(bpy.context.scene.objects[name].matrix_world, matrix) for name, matrix in expected.items()):
        raise ValueError("Head group did not receive the shared transform or an untouched object moved.")
    os.makedirs(os.path.dirname(output), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=output)
    bpy.ops.wm.open_mainfile(filepath=output)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.context.view_layer.update()
    validator.enforce_blender_memory_budget("head fitting saved output verification")
    if preservation() != before or {obj.name for obj in bpy.context.scene.objects} != set(transforms):
        raise ValueError("Reopened head-fit output failed mesh/material/rig/object preservation.")
    if any(not near_matrix(bpy.context.scene.objects[name].matrix_world, matrix) for name, matrix in expected.items()):
        raise ValueError("Reopened head-fit output did not retain the exact head/body placement.")
    if validator.sha_file(source) != input_hash:
        raise ValueError("Immutable head-fit source changed during processing.")
    objects = bpy.context.scene.objects
    return {
        "schemaVersion": 1, "operation": "head-fit", "autoexec": "disabled",
        "inputHash": input_hash, "outputHash": validator.sha_file(output),
        "headObjects": head_names, "bodyObjects": body_names,
        "pivot": list(pivot), "translation": translation, "rotationDegrees": rotation,
        "scale": float(scale), "headMatrix": matrix_rows(delta),
        "meshGeometryPreserved": True, "materialGraphsPreserved": True,
        "animationFingerprintPreserved": True, "bodyTransformsPreserved": True,
        "headGroupTransformVerified": True, "reopenedVerified": True,
        "anatomicalFitVerified": False,
        "boundsBefore": before_bounds,
        "boundsAfter": {"head": bounds([objects[n] for n in head_names]), "body": bounds([objects[n] for n in body_names])},
        "blenderVersion": bpy.app.version_string,
    }


def main():
    cfg = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf8"))
    paths = [os.path.normcase(os.path.realpath(os.path.abspath(cfg[key]))) for key in ("input", "output", "report")]
    if len(set(paths)) != 3 or os.path.exists(cfg["report"]):
        raise ValueError("Input, new output and new report must be distinct paths; existing reports cannot be overwritten.")
    try:
        report = run(cfg)
    except Exception as error:
        report = {"schemaVersion": 1, "operation": "head-fit", "ok": False, "error": str(error), "technicalDetails": traceback.format_exc()[-12000:]}
        with open(cfg["report"], "w", encoding="utf8") as handle:
            json.dump(report, handle, indent=2)
        raise
    with open(cfg["report"], "w", encoding="utf8") as handle:
        json.dump(report, handle, indent=2)


if __name__ == "__main__":
    main()
