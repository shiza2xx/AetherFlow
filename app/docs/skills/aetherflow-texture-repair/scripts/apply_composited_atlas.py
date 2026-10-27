"""Apply a pre-composited, hash-pinned atlas to a staged Blender checkpoint.

Run only on a disposable model_workbench_begin_correction copy. This script
never imports artwork from arbitrary paths, changes geometry, or accepts a result.
"""
import bpy
import hashlib
import json
import math
import os
import sys


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_hash(path, expected, label):
    if not os.path.isfile(path) or sha(path) != expected:
        raise ValueError(label + " is missing or its pinned SHA-256 changed.")


def scene_signature():
    digest = hashlib.sha256()
    object_count = 0
    def matrix_values(matrix):
        return [round(float(value), 8) for row in matrix for value in row]
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        row = {"name": obj.name, "type": obj.type, "parent": obj.parent.name if obj.parent else None,
               "parentType": obj.parent_type, "parentBone": obj.parent_bone,
               "matrixWorld": matrix_values(obj.matrix_world),
               "constraints": [{"type": item.type, "target": item.target.name if getattr(item, "target", None) else None,
                                "subtarget": getattr(item, "subtarget", ""), "influence": round(float(item.influence), 8)}
                               for item in obj.constraints],
               "modifiers": [{"type": item.type, "object": item.object.name if getattr(item, "object", None) else None,
                              "subtarget": getattr(item, "subtarget", ""), "useVertexGroups": getattr(item, "use_vertex_groups", None)}
                             for item in obj.modifiers]}
        if obj.type == "MESH":
            mesh = obj.data
            row["vertices"] = [[*[round(float(value), 8) for value in vertex.co],
                                 *[round(float(value), 8) for value in vertex.normal],
                                 sorted((int(group.group), round(float(group.weight), 8)) for group in vertex.groups)]
                                for vertex in mesh.vertices]
            row["polygons"] = [[list(poly.vertices), list(poly.loop_indices), round(float(poly.area), 8),
                                 *[round(float(value), 8) for value in poly.normal], int(poly.material_index)]
                                for poly in mesh.polygons]
            row["loops"] = [[int(loop.vertex_index), int(loop.edge_index),
                             *[round(float(value), 8) for value in loop.normal]] for loop in mesh.loops]
            row["uv"] = [(layer.name, [round(float(value), 7) for loop in layer.data for value in loop.uv]) for layer in mesh.uv_layers]
            row["materialSlots"] = [material.name if material else None for material in obj.data.materials]
            row["shapeKeys"] = None if not mesh.shape_keys else {
                "names": [block.name for block in mesh.shape_keys.key_blocks],
                "coordinates": [[round(float(value), 8) for vertex in block.data for value in vertex.co]
                                for block in mesh.shape_keys.key_blocks],
            }
            row["vertexGroups"] = [group.name for group in obj.vertex_groups]
        elif obj.type == "ARMATURE":
            row["bones"] = [{"name": bone.name, "parent": bone.parent.name if bone.parent else None,
                             "useDeform": bool(bone.use_deform), "matrixLocal": matrix_values(bone.matrix_local)}
                            for bone in obj.data.bones]
            row["pose"] = [{"name": bone.name, "matrix": matrix_values(bone.matrix)} for bone in obj.pose.bones]
        animation = getattr(obj, "animation_data", None)
        row["action"] = animation.action.name if animation and animation.action else None
        digest.update(json.dumps(row, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        digest.update(b"\n")
        object_count += 1
    return digest.hexdigest(), object_count


def image_pixels(path, color_space):
    image = bpy.data.images.load(path, check_existing=False)
    try:
        image.colorspace_settings.name = color_space
        return tuple(image.size), tuple(float(value) for value in image.pixels[:])
    finally:
        bpy.data.images.remove(image)


def compare_pixels(actual, expected, label):
    if len(actual) != len(expected):
        raise ValueError(label + " pixel buffer length does not match the pinned atlas.")
    maximum = max((abs(a - b) for a, b in zip(actual, expected)), default=0.0)
    if not math.isfinite(maximum) or maximum > (1.0 / 255.0 + 1e-6):
        raise ValueError(label + " pixel values differ from the hash-pinned atlas.")
    return maximum


def target_nodes(image_name, material_names):
    found = []
    for name in material_names:
        material = bpy.data.materials.get(name)
        if not material or not material.use_nodes or not material.node_tree:
            raise ValueError("A pinned target material is missing or has no node graph: " + name)
        matches = [node for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image and node.image.name == image_name]
        if not matches:
            raise ValueError("The pinned image is not assigned in target material: " + name)
        found.extend((material, node) for node in matches)
    if not found:
        raise ValueError("No exact material/image binding was supplied.")
    return found


def main():
    config_path = sys.argv[sys.argv.index("--") + 1]
    with open(config_path, "r", encoding="utf-8") as stream:
        cfg = json.load(stream)
    keys = ("blendInput", "originalImage", "mask", "compositedTexture", "outputBlend", "report")
    paths = {key: os.path.abspath(cfg[key]) for key in keys}
    if len({os.path.normcase(path) for path in paths.values()}) != len(paths):
        raise ValueError("Checkpoint, image inputs, candidate and report must use separate paths.")
    for key in ("outputBlend", "report"):
        if os.path.exists(paths[key]):
            raise ValueError("Staged output paths must not already exist.")
    if cfg.get("channel") not in ("albedo", "normal"):
        raise ValueError("Only a diagnosed albedo or normal atlas may be applied.")
    if not isinstance(cfg.get("materialNames"), list) or not cfg["materialNames"] or len(cfg["materialNames"]) > 128:
        raise ValueError("The exact target material names are required.")
    expected = cfg.get("hashes", {})
    require_hash(paths["blendInput"], expected.get("blendInput"), "Checkpoint")
    require_hash(paths["originalImage"], expected.get("originalImage"), "Original atlas")
    require_hash(paths["mask"], expected.get("mask"), "Verified mask")
    require_hash(paths["compositedTexture"], expected.get("compositedTexture"), "Composited atlas")
    composite_report_path = os.path.abspath(cfg.get("compositeReport", ""))
    if not composite_report_path or not os.path.isfile(composite_report_path):
        raise ValueError("The compositor conservation report is required.")
    with open(composite_report_path, "r", encoding="utf-8") as stream:
        composite_report = json.load(stream)
    if composite_report.get("protectedPixelsPreserved") is not True or composite_report.get("inputSHA256") != expected["originalImage"] or composite_report.get("maskSHA256") != expected["mask"] or composite_report.get("outputSHA256") != expected["compositedTexture"] or composite_report.get("channel") != cfg["channel"]:
        raise ValueError("The compositor report does not prove the pinned atlas and protected-pixel contract.")

    bpy.ops.wm.open_mainfile(filepath=paths["blendInput"])
    before_scene, object_count = scene_signature()
    image = bpy.data.images.get(str(cfg.get("imageName", "")))
    if image is None or image.source != "FILE":
        raise ValueError("The exact pinned file image is absent from the checkpoint.")
    materials = [str(name) for name in cfg["materialNames"]]
    nodes = target_nodes(image.name, materials)
    all_users = [(material, node) for material in bpy.data.materials if material.use_nodes and material.node_tree
                 for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image == image]
    if {(material.name, node.name) for material, node in all_users} != {(material.name, node.name) for material, node in nodes}:
        raise ValueError("The pinned image is used outside the declared target materials; refusing an incomplete reassignment.")
    old_color_space = image.colorspace_settings.name
    dimensions, original_pixels = image_pixels(paths["originalImage"], old_color_space)
    if tuple(int(value) for value in image.size) != dimensions:
        raise ValueError("The pinned image dimensions differ from the original atlas.")
    compare_pixels(tuple(float(value) for value in image.pixels[:]), original_pixels, "Checkpoint image")
    staged_dimensions, staged_pixels = image_pixels(paths["compositedTexture"], old_color_space)
    if staged_dimensions != dimensions:
        raise ValueError("Composited atlas dimensions differ from the exact source image.")

    source_image_name = image.name + ".pinned-original-" + expected["originalImage"][:8]
    if bpy.data.images.get(source_image_name):
        raise ValueError("A pinned-original image name collision exists in the checkpoint.")
    image.pack()
    image.use_fake_user = True
    image.name = source_image_name
    replacement = bpy.data.images.load(paths["compositedTexture"], check_existing=False)
    replacement.colorspace_settings.name = old_color_space
    replacement.name = str(cfg["imageName"])
    replacement.pack()
    replacement.filepath = "//" + os.path.basename(paths["compositedTexture"])
    for _, node in nodes:
        node.image = replacement
    if scene_signature()[0] != before_scene:
        raise ValueError("Applying an image atlas unexpectedly changed model geometry, UVs or assignments.")
    bpy.ops.wm.save_as_mainfile(filepath=paths["outputBlend"], check_existing=False)
    output_blend_hash = sha(paths["outputBlend"])

    bpy.ops.wm.open_mainfile(filepath=paths["outputBlend"])
    after_scene, after_count = scene_signature()
    reopened = bpy.data.images.get(str(cfg["imageName"]))
    if reopened is None or tuple(int(value) for value in reopened.size) != dimensions:
        raise ValueError("The staged model did not reopen with the pinned image.")
    target_nodes(reopened.name, materials)
    pixel_delta = compare_pixels(tuple(float(value) for value in reopened.pixels[:]), staged_pixels, "Reopened staged image")
    pinned_original = bpy.data.images.get(source_image_name)
    if pinned_original is None or pinned_original.packed_file is None or not pinned_original.use_fake_user:
        raise ValueError("The packed pinned-original atlas was not preserved in the staged model.")
    original_delta = compare_pixels(tuple(float(value) for value in pinned_original.pixels[:]), original_pixels, "Reopened pinned-original image")
    if after_scene != before_scene or after_count != object_count:
        raise ValueError("Reopening the staged model changed geometry, UVs or object inventory.")
    report = {
        "schemaVersion": 1,
        "operation": "apply-composited-atlas-to-staged-checkpoint",
        "channel": cfg["channel"],
        "sourceHashes": expected,
        "outputBlendSHA256": output_blend_hash,
        "imageName": reopened.name,
        "pinnedOriginalImageName": source_image_name,
        "materialNames": materials,
        "dimensions": list(dimensions),
        "pixelMaximumDelta": pixel_delta,
        "pinnedOriginalPixelMaximumDelta": original_delta,
        "geometryUvRigWeightSignaturePreserved": True,
        "outsideMaskPixelsPreservedByCompositor": True,
        "reopenedAndVerified": True,
        "pendingHumanReview": True,
        "autoexec": "disabled-by-runner",
        "blenderVersion": bpy.app.version_string,
    }
    with open(paths["report"], "x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
