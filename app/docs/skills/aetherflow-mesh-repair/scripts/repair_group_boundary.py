"""Inspect/split an explicitly selected pre-rig face region on copies, never guess a cut.

Blender --background --factory-startup --disable-autoexec --threads 1
  --python repair_group_boundary.py -- config.json
Config: mode catalog|inspect|split, input, expectedHash, object, faceIndices,
outputDirectory (new), expectedSelectionHash (required for split).
"""
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "atelier" if ROOT.name.startswith("atelier-") else "aetherflow"
sys.path.insert(0, str(ROOT.parent / (PREFIX + "-character-pipeline") / "scripts"))
from guided_surface_tools import load_objects, split_component, face_surface, group_surface_signature, guides, save_blend, sha


def run(bpy, cfg):
    source = Path(cfg["input"]).absolute()
    if source.is_symlink() or source.resolve(strict=True) != source or sha(source) != cfg.get("expectedHash"):
        raise ValueError("Source bytes do not match their pinned hash.")
    if cfg.get("mode") not in ("catalog", "inspect", "split"):
        raise ValueError("Choose catalog, inspect or split.")
    output = Path(cfg["outputDirectory"]).absolute()
    if output.exists() or output.is_symlink() or output.resolve() != output:
        raise ValueError("Use a new operation output directory.")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    objects = load_objects(bpy, source)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    if any(obj.type == "ARMATURE" or obj.animation_data or obj.constraints for obj in objects):
        raise ValueError("This route supports only static pre-rig sources.")
    if any(obj.modifiers or obj.data.shape_keys for obj in meshes):
        raise ValueError("Resolve modifiers/shape keys explicitly before this static face partition.")
    if any(not math.isfinite(float(value)) for mesh in meshes for vertex in mesh.data.vertices for value in vertex.co):
        raise ValueError("Resolve non-finite source geometry before partitioning.")
    selected = [obj for obj in meshes if obj.name == cfg.get("object")]
    if len(selected) != 1 or selected[0].children:
        raise ValueError("Choose one exact mesh without dependent child objects.")
    obj = selected[0]
    if cfg["mode"] == "catalog":
        offset, limit = cfg.get("offset", 0), cfg.get("limit", 100)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
            raise ValueError("Use nonnegative face offset and a page limit of 1–200.")
        rows = []
        for face in list(obj.data.polygons)[offset:offset + limit]:
            material = obj.data.materials[face.material_index] if face.material_index < len(obj.data.materials) else None
            rows.append({"faceIndex": face.index, "material": material.name if material else None,
                         "vertexIndices": list(face.vertices), "worldCorners": [list(obj.matrix_world @ obj.data.vertices[v].co) for v in face.vertices]})
        output.mkdir(parents=True, exist_ok=False)
        report = {"mode": "catalog", "inputHash": cfg["expectedHash"], "object": obj.name,
                  "totalFaces": len(obj.data.polygons), "offset": offset, "limit": limit, "faces": rows,
                  "readOnly": True, "originalBytesUnchanged": sha(source) == cfg["expectedHash"]}
        (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report
    indices = cfg.get("faceIndices")
    if not isinstance(indices, list) or not indices or any(type(i) is not int for i in indices):
        raise ValueError("Explicit original face indices are required; no geometric guessing.")
    if len(set(indices)) != len(indices) or min(indices) < 0 or max(indices) >= len(obj.data.polygons):
        raise ValueError("Selected faces are duplicated or out of range.")
    indices = sorted(indices)
    rest = sorted(set(range(len(obj.data.polygons))) - set(indices))
    if not rest:
        raise ValueError("For a whole component use the existing managed repartition operation.")
    face_edges = [set(tuple(sorted(edge)) for edge in face.edge_keys) for face in obj.data.polygons]
    selected_edges = set().union(*(face_edges[i] for i in indices))
    rest_edges = set().union(*(face_edges[i] for i in rest))
    boundary = sorted(selected_edges & rest_edges)
    if not boundary:
        raise ValueError("The selection is already disconnected; use component repartition.")
    if {v for face in obj.data.polygons for v in face.vertices} != set(range(len(obj.data.vertices))):
        raise ValueError("The target has loose vertices; resolve them explicitly rather than dropping them.")
    if {tuple(sorted(edge.vertices)) for edge in obj.data.edges} != selected_edges | rest_edges:
        raise ValueError("The target has wire edges outside its faces.")
    uv_names = [layer.name for layer in obj.data.uv_layers]
    before = {face.index: face_surface(obj, face, uv_names) for face in obj.data.polygons}
    selection_hash = hashlib.sha256(json.dumps({"source": cfg["expectedHash"], "object": obj.name,
        "faces": indices, "surface": [before[i] for i in indices]}, sort_keys=True).encode()).hexdigest()
    if cfg["mode"] == "split" and cfg.get("expectedSelectionHash") != selection_hash:
        raise ValueError("Inspect this exact source/face selection first; selection hash changed.")
    output.mkdir(parents=True, exist_ok=False)
    checkpoint = output / ("checkpoint" + source.suffix)
    shutil.copy2(source, checkpoint)
    if sha(checkpoint) != cfg["expectedHash"]:
        raise ValueError("Checkpoint bytes failed verification.")
    untouched = {other.name: group_surface_signature(other) for other in meshes if other != obj}
    pieces = []
    for label, faces in (("selected_region", indices), ("retained_surface", rest)):
        piece, _ = split_component(bpy, obj, faces, obj.name[:35] + "_" + label)
        piece.parent = obj.parent
        piece.matrix_parent_inverse = obj.matrix_parent_inverse.copy()
        piece.matrix_world = obj.matrix_world.copy()
        piece["aetherflow_repair_piece"] = label
        pieces.append((piece, faces))
    bpy.context.view_layer.update()
    piece_names = {piece.name: piece.get("aetherflow_repair_piece") for piece, faces in pieces}
    original_name = obj.name
    bpy.data.objects.remove(obj, do_unlink=True)
    images = []
    if cfg["mode"] == "inspect":
        pieces[0][0].color = (0.95, 0.15, 0.12, 1)
        pieces[1][0].color = (0.5, 0.5, 0.5, 1)
        directions = (("front",(0,-1,0)),("back",(0,1,0)),("left",(-1,0,0)),("right",(1,0,0)),("top",(0,0,1)),("bottom",(0,0,-1)),("oblique",(1,-1,.6)))
        images, _ = guides(bpy, pieces[0][0], output, "selection-context", 768, [pieces[1][0]], True, directions)
        piece = pieces[0][0]
        normal = (piece.matrix_world.to_3x3().inverted().transposed() @ max(piece.data.polygons, key=lambda face:face.area).normal).normalized()
        closeups, _ = guides(bpy, piece, output, "selected-region", 768, view_directions=(("surface",tuple(normal)),("reverse",tuple(-normal))))
        images.extend(closeups)
    model = save_blend(bpy, output / ("selection-preview.blend" if cfg["mode"] == "inspect" else "corrected-segments.blend"))
    # Reopen the actual output and prove every old face occurs exactly once, with unchanged surface corners.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    reopened = load_objects(bpy, model)
    actual = [item for item in reopened if item.type == "MESH"]
    seen = set()
    max_error = 0.0
    for piece in actual:
        label = piece_names.get(piece.name)
        if label not in ("selected_region", "retained_surface"):
            if piece.name not in untouched or group_surface_signature(piece) != untouched[piece.name]:
                raise ValueError("An unrelated object's saved surface changed.")
            continue
        faces = indices if label == "selected_region" else rest
        if len(piece.data.polygons) != len(faces):
            raise ValueError("The saved partition changed face coverage.")
        for face, old_index in zip(piece.data.polygons, faces):
            if old_index in seen:
                raise ValueError("A source face appears twice.")
            seen.add(old_index)
            expected, found = before[old_index], face_surface(piece, face, uv_names)
            if expected["material"] != found["material"] or len(expected["corners"]) != len(found["corners"]):
                raise ValueError("Material or corner correspondence changed.")
            for old_corner, new_corner in zip(expected["corners"], found["corners"]):
                flatten = lambda c: c[0] + c[1] + [v for uv in c[2] for v in uv]
                max_error = max(max_error, max(abs(a-b) for a,b in zip(flatten(old_corner), flatten(new_corner))))
    if seen != set(before) or max_error > 0.00001 or len(actual) != len(meshes) + 1:
        raise ValueError("Saved surface coverage/preservation did not verify.")
    if sha(source) != cfg["expectedHash"]:
        raise ValueError("Original source bytes changed.")
    report = {"schemaVersion": 1, "mode": cfg["mode"], "inputHash": cfg["expectedHash"],
        "object": original_name, "selectionHash": selection_hash, "selectedFaceIndices": indices,
        "boundaryEdges": boundary, "checkpoint": str(checkpoint), "output": model, "outputHash": sha(model),
        "images": images, "sourceFaces": len(before), "selectedFaces": len(indices), "retainedFaces": len(rest),
        "reopenedVerified": True, "exactFaceCoverage": True, "worldSurfacePreserved": True,
        "uvMaterialsNormalsPreserved": True, "maxCornerError": max_error, "unrelatedObjectsPreserved": True,
        "originalBytesUnchanged": True, "newCapsOrFaces": False, "semanticBoundaryApproved": False,
        "adoption": "pending human review; geometry checks do not establish semantic or anatomical correctness"}
    with (output / "report.json").open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    return report


if __name__ == "__main__":
    import bpy
    cfg = json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text(encoding="utf-8"))
    print(json.dumps(run(bpy, cfg)))
