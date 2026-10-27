"""Observe named copied meshes; boundaries are not automatically defects.

Blender --background --factory-startup --disable-autoexec --threads 1
--python inspect_mesh_boundaries.py -- request.json
Config: source, sourceHash, objects, report; optional zeroAreaEpsilon>=0.
No geometry is edited and no source is saved.
"""
import hashlib
import json
import math
import os
import sys
import bpy


def sha(file):
    h = hashlib.sha256()
    with open(file, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def inspect(obj, maximum, epsilon):
    mesh = obj.data
    uses = {tuple(sorted(e.vertices)): 0 for e in mesh.edges}
    for face in mesh.polygons:
        for key in face.edge_keys:
            key = tuple(sorted(key))
            uses[key] = uses.get(key, 0) + 1
    edges = [key for key, count in uses.items() if count == 1]
    adjacency = {}
    for a, b in edges:
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)
    remaining = set(adjacency)
    components = []
    while remaining:
        start = min(remaining)
        pending, vertices = [start], set()
        while pending:
            vertex = pending.pop()
            if vertex in vertices:
                continue
            vertices.add(vertex)
            pending.extend(adjacency[vertex] - vertices)
        remaining -= vertices
        branches = [v for v in sorted(vertices) if len(adjacency[v]) > 2]
        endpoints = [v for v in sorted(vertices) if len(adjacency[v]) == 1]
        closed = not branches and not endpoints and all(len(adjacency[v]) == 2 for v in vertices)
        order = []
        if not branches:
            current, previous = endpoints[0] if endpoints else start, None
            visited = set()
            while current not in visited:
                visited.add(current)
                order.append(current)
                possible = sorted(adjacency[current] - ({previous} if previous is not None else set()))
                if not possible:
                    break
                previous, current = current, possible[0]
        else:
            order = sorted(vertices)
        sample = order[:maximum]
        components.append({"vertexCount": len(vertices), "closedLoop": closed, "branchVertices": branches[:maximum], "endVertices": endpoints,
                           "ordering": "trace" if not branches else "unordered-branched-component", "indices": sample,
                           "worldPoints": [list(obj.matrix_world @ mesh.vertices[v].co) for v in sample], "truncated": len(order) > maximum,
                           "classification": "unreviewed boundary; may be an intended opening"})
    return {"object": obj.name, "vertices": len(mesh.vertices), "faces": len(mesh.polygons), "boundaryEdges": len(edges),
            "wireEdges": sum(v == 0 for v in uses.values()), "overusedEdges": sum(v > 2 for v in uses.values()),
            "zeroOrSmallAreaFaces": sum(face.area <= epsilon for face in mesh.polygons), "areaEpsilonLocalUnitsSquared": epsilon,
            "components": components, "uvLayers": [layer.name for layer in mesh.uv_layers], "hasShapeKeys": bool(mesh.shape_keys),
            "armature": obj.find_armature().name if obj.find_armature() else None}


def main():
    cfg = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    source, report = os.path.abspath(cfg["source"]), os.path.abspath(cfg["report"])
    if os.path.exists(report) or report == source:
        raise ValueError("Use a fresh report path, distinct from the model.")
    if not source.lower().endswith(".blend") or not os.path.isfile(source) or os.path.islink(source) or sha(source) != cfg["sourceHash"]:
        raise ValueError("A copied .blend with its actual source hash is required.")
    names = cfg.get("objects")
    if not isinstance(names, list) or not names or len(set(names)) != len(names):
        raise ValueError("Supply explicit unique mesh object names.")
    maximum = int(cfg.get("maxBoundaryVertices", 2048))
    epsilon = float(cfg.get("zeroAreaEpsilon", 0))
    if not 1 <= maximum <= 10000 or not math.isfinite(epsilon) or epsilon < 0:
        raise ValueError("Invalid report bound or area tolerance.")
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=source)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.context.view_layer.update()
    objects = [bpy.context.scene.objects.get(name) for name in names]
    if any(obj is None or obj.type != "MESH" for obj in objects):
        raise ValueError("Every requested object must be an actual source mesh.")
    results = [inspect(obj, maximum, epsilon) for obj in objects]
    if sha(source) != cfg["sourceHash"]:
        raise ValueError("Source bytes changed during inspection.")
    output = {"schemaVersion": 1, "operation": "mesh-boundary-inspection", "ok": True, "sourceHash": cfg["sourceHash"], "sourceUnchanged": True, "objects": results,
              "limitations": ["Boundary edges may be intentional; this is not automatic hole repair.", "No winding correctness, anatomical quality, self-intersection, deformation or Unity approval.", "Indices describe this exact source hash only; do not reuse after topology changes."]}
    os.makedirs(os.path.dirname(report), exist_ok=True)
    with open(report, "x", encoding="utf-8") as stream:
        json.dump(output, stream, indent=2, allow_nan=False)


if __name__ == "__main__":
    main()
