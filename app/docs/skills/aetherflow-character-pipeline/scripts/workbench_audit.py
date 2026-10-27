"""Independent, object-scoped checks for copied .blend workbench corrections.

Run with factory startup, --disable-autoexec and --threads 1. This is an audit,
not a modelling algorithm, anatomical approval or a proof of Unity appearance.
"""
import hashlib
import importlib.util
import json
import math
import os
import sys
import traceback
from types import SimpleNamespace

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("atelier_workbench_validator", os.path.join(HERE, "validate_workflow.py"))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def matrix(value):
    return [[float(v) for v in row] for row in value]


def scalar(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("A protected property contains a nonfinite value.")
        return value
    if isinstance(value, dict):
        return {str(k): scalar(v) for k, v in value.items()}
    if isinstance(value, set):
        return sorted(scalar(v) for v in value)
    if isinstance(value, bpy.types.ID):
        return {"idType": value.bl_rna.identifier, "name": value.name}
    if hasattr(value, "to_list"):
        return scalar(value.to_list())
    if isinstance(value, (list, tuple)) or hasattr(value, "__iter__") or (hasattr(value, "__len__") and hasattr(value, "__getitem__")):
        return [scalar(v) for v in value]
    raise ValueError("Unsupported protected property type: " + type(value).__name__)


def rna(value):
    result = {"type": value.bl_rna.identifier}
    for prop in value.bl_rna.properties:
        key = prop.identifier
        if prop.is_readonly or key in ("rna_type", "name") or prop.type == "COLLECTION":
            continue
        try:
            result[key] = scalar(getattr(value, key))
        except (TypeError, ValueError):
            # Nested RNA data are captured explicitly below, never repr(pointer).
            if prop.type != "POINTER":
                raise
    return result


def driver_rows(value):
    ad = getattr(value, "animation_data", None)
    return [{"path": c.data_path, "index": c.array_index, "driver": rna(c.driver),
             "variables": [{"name": v.name, "type": v.type, "targets": [rna(t) for t in v.targets]} for v in c.driver.variables]} for c in ad.drivers] if ad else []


def graph(material):
    result = validator.material_graph_snapshot(material, False)
    groups = {}

    def walk(tree, ancestry):
        for node in tree.nodes:
            child = getattr(node, "node_tree", None)
            if child is None:
                continue
            if child.name in ancestry:
                raise ValueError("Recursive node group cannot be independently verified.")
            if child.name not in groups:
                proxy = SimpleNamespace(name=child.name, use_nodes=True, node_tree=child)
                groups[child.name] = {"graph": validator.material_graph_snapshot(proxy, False),
                                      "drivers": driver_rows(child),
                                      "interface": [rna(i) for i in child.interface.items_tree]}
                walk(child, ancestry + [child.name])
    if material.use_nodes:
        walk(material.node_tree, [])
        result["drivers"] = driver_rows(material.node_tree)
    result["nodeGroups"] = groups
    return result


def shape_keys(mesh):
    keys = mesh.shape_keys
    if not keys:
        return None
    return {"relative": keys.use_relative, "evalTime": keys.eval_time, "drivers": driver_rows(keys),
            "keys": [{"name": k.name, "relative": k.relative_key.name if k.relative_key else None,
                      "value": k.value, "mute": k.mute, "min": k.slider_min, "max": k.slider_max,
                      "vertexGroup": k.vertex_group, "coordinates": digest([tuple(v.co) for v in k.data])} for k in keys.key_blocks]}


def custom_attributes(mesh):
    ignored = {"position", ".edge_verts", ".corner_vert", ".corner_edge", ".select_vert", ".select_edge", ".select_poly"}
    result = {}
    for att in mesh.attributes:
        if att.name in ignored:
            continue
        h = hashlib.sha256()
        for item in att.data:
            value = next((getattr(item, key) for key in ("value", "vector", "color") if hasattr(item, key)), None)
            if value is None:
                raise ValueError("Unsupported mesh attribute: " + att.name)
            h.update(json.dumps(scalar(value), separators=(",", ":"), allow_nan=False).encode())
        result[att.name] = {"domain": att.domain, "type": att.data_type, "count": len(att.data), "hash": h.hexdigest()}
    return result


def images():
    result = {}
    for image in bpy.data.images:
        if image.type in ("RENDER_RESULT", "COMPOSITING"):
            continue
        if image.packed_file:
            content = hashlib.sha256(bytes(image.packed_file.data)).hexdigest()
        elif image.source == "FILE":
            file = os.path.realpath(bpy.path.abspath(image.filepath))
            if not os.path.isfile(file):
                raise ValueError("Missing image dependency: " + image.name)
            content = validator.sha_file(file)
        else:
            raise ValueError("Pack generated/tiled/movie image dependencies before a workbench correction: " + image.name)
        result[image.name] = {"hash": content, "colorspace": image.colorspace_settings.name}
    return result


def capture(file, allowed_roots):
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=file)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    validator.clear_image_fingerprint_cache()
    # A saved .blend may reference an arbitrary disk path even with autoexec off.
    # Only hashed dependencies staged into the private operation tree may be read.
    for image in bpy.data.images:
        if image.packed_file or image.type in ("RENDER_RESULT", "COMPOSITING"):
            continue
        if image.source == "FILE":
            target = os.path.realpath(bpy.path.abspath(image.filepath))
            require(any(os.path.commonpath([root, target]) == root for root in allowed_roots), "Image dependency is outside the private staged directories: " + image.name)
        else:
            raise ValueError("Pack generated/tiled/movie image dependencies before correction: " + image.name)
    bpy.context.view_layer.update()
    validator.enforce_blender_memory_budget("workbench model capture")
    rows = {}
    for obj in bpy.context.scene.objects:
        item = {"type": obj.type, "world": matrix(obj.matrix_world), "local": matrix(obj.matrix_local),
                "parentInverse": matrix(obj.matrix_parent_inverse), "parent": obj.parent.name if obj.parent else None,
                "parentType": obj.parent_type, "parentBone": obj.parent_bone,
                "constraints": [rna(c) for c in obj.constraints], "modifiers": [rna(m) for m in obj.modifiers],
                "drivers": driver_rows(obj), "properties": scalar(dict(obj.items())) if obj.items() else {},
                "hiddenRender": obj.hide_render, "hiddenViewport": obj.hide_viewport}
        if obj.type == "MESH":
            item["mesh"] = validator.mesh_fingerprint(obj, full=False)
            item["weights"] = {"groups": [g.name for g in obj.vertex_groups], "hash": validator.weight_snapshot(obj, False)[-1]}
            item["keys"] = shape_keys(obj.data)
            item["attributes"] = custom_attributes(obj.data)
            item["materials"] = [graph(m) if m else None for m in obj.data.materials]
        if obj.type == "ARMATURE":
            item["pose"] = [{"bone": b.name, "basis": matrix(b.matrix_basis), "constraints": [rna(c) for c in b.constraints]} for b in obj.pose.bones]
        rows[obj.name] = item
        validator.enforce_blender_memory_budget("workbench object capture")
    return {"objects": rows, "animation": validator.animation_fingerprint(), "images": images()}


def without_image_content(value):
    if isinstance(value, list):
        return [without_image_content(v) for v in value]
    if isinstance(value, dict):
        return {k: without_image_content(v) for k, v in value.items() if k not in ("payloadSHA256", "payloadBytes", "content", "size", "packed")}
    return value


def protected_target(row, purpose):
    # A deep copy lets the original complete snapshot remain useful as evidence.
    out = json.loads(json.dumps(row))
    if purpose == "geometry":
        for key in ("mesh", "attributes", "keys", "weights", "materials", "world", "local"):
            out.pop(key, None)
    elif purpose == "placement":
        for key in ("world", "local"):
            out.pop(key, None)
    elif purpose == "materials":
        out.pop("materials", None)
        for key in ("materials", "materialNames", "materialSlots", "materialData"):
            out.get("mesh", {}).pop(key, None)
        for key in ("material_index", ".material_index"):
            out.get("attributes", {}).pop(key, None)
    elif purpose == "textures":
        out["materials"] = without_image_content(out.get("materials"))
    elif purpose == "weights":
        out.pop("weights", None)
        # Blender's vertex-group weight storage is not a general geometry attribute.
    return out


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(cfg):
    purpose = cfg["purpose"]
    require(purpose in ("geometry", "materials", "textures", "weights", "placement"), "Inspection is read-only; choose a declared correction purpose.")
    source, candidate = (os.path.abspath(cfg[k]) for k in ("source", "candidate"))
    require(source != candidate, "Source and candidate must be separate immutable versions.")
    for file, key in ((source, "sourceHash"), (candidate, "candidateHash")):
        require(file.lower().endswith(".blend") and os.path.isfile(file) and not os.path.islink(file) and os.path.normcase(os.path.realpath(file)) == os.path.normcase(file), "Audit requires regular staged .blend files.")
        require(validator.sha_file(file) == cfg[key], "Staged model hash mismatch: " + key)
    targets = cfg.get("targetObjects")
    require(isinstance(targets, list) and 0 < len(targets) <= 128 and all(isinstance(n, str) and n for n in targets) and len(set(targets)) == len(targets), "Declare unique target object names.")
    roots = [os.path.realpath(os.path.dirname(source)), os.path.realpath(os.path.dirname(candidate))]
    before = capture(source, roots)
    if purpose == "weights":
        require(any(o["type"] == "ARMATURE" for o in before["objects"].values()), "Weight correction requires an actual rig.")
    after = capture(candidate, roots)
    left, right = before["objects"], after["objects"]
    require(any(o["type"] == "MESH" for o in right.values()), "Candidate contains no model meshes.")
    require(set(targets).issubset(set(left) | set(right)), "A declared correction target does not exist in either staged model.")
    require(before["animation"] == after["animation"], "Armature rest, action, binding or animation controls changed.")
    require(all(n in targets for n in set(left) ^ set(right)), "An undeclared object was added or removed.")
    if purpose != "geometry":
        require(set(left) == set(right) and all(n in left for n in targets), "Object membership changed outside a geometry correction.")
    for name in set(left) | set(right):
        a, b = left.get(name), right.get(name)
        if name not in targets:
            require(a == b, "Protected object changed: " + name)
            continue
        require((a is None or a["type"] == "MESH") and (b is None or b["type"] == "MESH"), "Correction targets must be mesh objects; rig controls are protected.")
        if a is not None and b is not None:
            require(protected_target(a, purpose) == protected_target(b, purpose), "Protected properties changed on target: " + name)
            if purpose == "geometry" and a.get("keys"):
                old = {k["name"] for k in a["keys"]["keys"]}
                new = {k["name"] for k in b.get("keys", {}).get("keys", [])} if b.get("keys") else set()
                require(old.issubset(new), "Geometry repair dropped an existing shape key without a separate retirement plan: " + name)
    if purpose in ("materials", "weights", "placement"):
        if purpose == "materials":
            require(all(after["images"].get(n, {}).get("hash") == v["hash"] for n, v in before["images"].items()), "Materials-only correction changed original image pixels.")
            original_payloads = {v["hash"] for v in before["images"].values()}
            require(all(v["hash"] in original_payloads for v in after["images"].values()), "Materials-only correction introduced new image pixels; use a separate texture correction.")
        else:
            require(before["images"] == after["images"], "Images were added or removed outside the declared correction purpose.")
    if purpose == "weights":
        require(any(o["type"] == "ARMATURE" for o in left.values()), "Weight correction requires an actual rig.")
        for name in targets:
            obj = bpy.context.scene.objects[name]
            arm = obj.find_armature()
            require(arm is not None, "Weight target has no armature binding: " + name)
            deform = {b.name for b in arm.data.bones if b.use_deform}
            for vertex in obj.data.vertices:
                weights = [g.weight for g in vertex.groups if obj.vertex_groups[g.group].name in deform]
                require(weights and all(math.isfinite(w) and 0 <= w <= 1 for w in weights) and abs(sum(weights) - 1) <= .001, "Target deform weights must be finite, nonzero and normalized: " + name)
    for file, key in ((source, "sourceHash"), (candidate, "candidateHash")):
        require(validator.sha_file(file) == cfg[key], "Model bytes changed during audit.")
    changed = [n for n in targets if left.get(n) != right.get(n)]
    require(changed, "The candidate contains no semantic change to a declared correction target.")
    topology = [n for n in targets if any(left.get(n, {}).get("mesh", {}).get(key) != right.get(n, {}).get("mesh", {}).get(key) for key in ("geometry", "uv", "normals"))]
    armatures = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE" and any(bone.use_deform for bone in obj.data.bones)}
    bound_rig_objects = sorted(obj.name for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.find_armature() is not None and obj.find_armature().name in armatures and any(group.name in {bone.name for bone in obj.find_armature().data.bones if bone.use_deform} for group in obj.vertex_groups))
    rig_present = bool(armatures and bound_rig_objects)
    return {"schemaVersion": 1, "operation": "workbench-audit", "ok": True, "sourceHash": cfg["sourceHash"], "candidateHash": cfg["candidateHash"], "purpose": purpose, "targetObjects": targets,
            "checks": {"sourceBytesPreserved": True, "candidateBytesVerified": True, "reopenedVerified": True, "protectedObjectsPreserved": True, "declaredTargetPropertiesPreserved": True, "rigAndActionsPreserved": True, "rigPresent": rig_present,
                       "changedObjects": changed, "geometryChangedObjects": topology, "requiresNewSurfaceBaseline": bool(topology or purpose == "placement"), "boundRigObjects": bound_rig_objects},
            "limitations": ["Protection is at declared object granularity, not proof of unchanged vertices within a target object.", "No anatomical, boundary-closure, complete deformation, visual-quality or Unity-rendering approval.", "Geometry/UV/attribute changes require new applicable baselines and explicit downstream review."], "blenderVersion": bpy.app.version_string}


def main():
    cfg = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    report = os.path.abspath(cfg["report"])
    if os.path.exists(report) or report in (os.path.abspath(cfg["source"]), os.path.abspath(cfg["candidate"])):
        raise ValueError("Report needs a fresh distinct path.")
    try:
        result = run(cfg)
    except Exception as error:
        result = {"schemaVersion": 1, "operation": "workbench-audit", "ok": False, "sourceHash": cfg.get("sourceHash"), "candidateHash": cfg.get("candidateHash"), "purpose": cfg.get("purpose"), "targetObjects": cfg.get("targetObjects"), "checks": {}, "limitations": [], "error": str(error), "blenderVersion": bpy.app.version_string}
        traceback.print_exc()
    os.makedirs(os.path.dirname(report), exist_ok=True)
    with open(report, "x", encoding="utf-8") as out:
        json.dump(result, out, indent=2, allow_nan=False)


if __name__ == "__main__":
    main()
