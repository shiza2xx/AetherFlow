"""Atelier component/group/rig-surface tools; no import-time scene mutations.

Blender --background --factory-startup --disable-autoexec --threads 1
  --python guided_surface_tools.py -- config.json
Config modes: inventory, inspect-components, prepare-groups, repartition-groups,
assemble-returns, rig-source, restore-rig-materials.
All outputs are new files. Reports describe actual bytes; external approval and
independent checks remain required. No service/network/GUI automation.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from group_contract import BASE_GROUPS, MAX_GROUPS, group_names


def sha(file):
    h = hashlib.sha256()
    with open(file, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fresh(file):
    file = Path(file).resolve()
    if file.exists():
        raise ValueError("Output already exists; choose a new operation directory: " + str(file))
    file.parent.mkdir(parents=True, exist_ok=True)
    return file


def write_json(file, value):
    file = fresh(file)
    with file.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
    return str(file)


def load_objects(bpy, file):
    before = set(bpy.context.scene.objects)
    suffix = Path(file).suffix.lower()
    if suffix == ".blend":
        with bpy.data.libraries.load(str(file), link=False) as (src, dst):
            dst.objects = src.objects
        for obj in dst.objects:
            if obj is not None:
                bpy.context.collection.objects.link(obj)
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(file), use_anim=True)
    elif suffix in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(file))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(file))
    else:
        raise ValueError("Unsupported model input: " + suffix)
    # Library-linked objects need evaluated world matrices before component copies.
    bpy.context.view_layer.update()
    return sorted(set(bpy.context.scene.objects) - before, key=lambda o: o.name)


def components(mesh):
    incident = [[] for _ in mesh.vertices]
    for face in mesh.polygons:
        for vertex in face.vertices:
            incident[vertex].append(face.index)
    unseen = set(range(len(mesh.polygons)))
    while unseen:
        seed = min(unseen)
        stack, faces = [seed], []
        unseen.remove(seed)
        while stack:
            index = stack.pop()
            faces.append(index)
            for vertex in mesh.polygons[index].vertices:
                for other in incident[vertex]:
                    if other in unseen:
                        unseen.remove(other)
                        stack.append(other)
        yield sorted(faces)


def split_component(bpy, obj, face_indices, name):
    original = obj.data
    vertex_indices = sorted({v for i in face_indices for v in original.polygons[i].vertices})
    index_map = {v: i for i, v in enumerate(vertex_indices)}
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(original.vertices[i].co) for i in vertex_indices], [],
                     [[index_map[v] for v in original.polygons[i].vertices] for i in face_indices])
    for material in original.materials:
        mesh.materials.append(material)
    old_loops = [loop for i in face_indices for loop in original.polygons[i].loop_indices]
    for layer in original.uv_layers:
        copied = mesh.uv_layers.new(name=layer.name)
        for target, source in zip(copied.data, old_loops):
            target.uv = layer.data[source].uv
    for target, source in zip(mesh.polygons, face_indices):
        target.material_index = original.polygons[source].material_index
        target.use_smooth = original.polygons[source].use_smooth
    if len(original.corner_normals) == len(original.loops):
        mesh.normals_split_custom_set([tuple(original.corner_normals[i].vector) for i in old_loops])
    edge_lookup = {tuple(sorted(edge.vertices)): edge.index for edge in original.edges}
    edge_sources = [edge_lookup[tuple(sorted(vertex_indices[v] for v in edge.vertices))] for edge in mesh.edges]
    domains = {"POINT": vertex_indices, "FACE": face_indices, "CORNER": old_loops, "EDGE": edge_sources}
    uv_names = {layer.name for layer in original.uv_layers}
    for attribute in original.attributes:
        if attribute.name == "position" or attribute.name in uv_names or getattr(attribute, "is_internal", False):
            continue
        if attribute.domain not in domains:
            raise ValueError("Unsupported component attribute domain: " + attribute.name)
        target = mesh.attributes.get(attribute.name)
        if target and (target.data_type != attribute.data_type or target.domain != attribute.domain):
            raise ValueError("Component attribute type conflict: " + attribute.name)
        target = target or mesh.attributes.new(name=attribute.name, type=attribute.data_type, domain=attribute.domain)
        for destination, source_index in zip(target.data, domains[attribute.domain]):
            item = attribute.data[source_index]
            prop = next((key for key in ("value", "vector", "color") if hasattr(item, key)), None)
            if prop is None:
                raise ValueError("Unsupported component attribute: " + attribute.name)
            value = getattr(item, prop)
            if not isinstance(value, (str, bytes, int, float, bool)):
                value = tuple(value)
            setattr(destination, prop, value)
    if original.uv_layers.active:
        mesh.uv_layers.active = mesh.uv_layers[original.uv_layers.active.name]
    for layer in original.uv_layers:
        mesh.uv_layers[layer.name].active_render = layer.active_render
    face_origin = mesh.attributes.get("aetherflow_source_face") or mesh.attributes.new(name="aetherflow_source_face", type="INT", domain="FACE")
    face_origin.data.foreach_set("value", face_indices)
    mesh.update()
    result = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(result)
    result.matrix_world = obj.matrix_world.copy()
    for group in obj.vertex_groups:
        copied_group = result.vertex_groups.new(name=group.name)
        for new_index, old_index in enumerate(vertex_indices):
            entry = next((weight for weight in original.vertices[old_index].groups if weight.group == group.index), None)
            if entry:
                copied_group.add([new_index], float(entry.weight), "REPLACE")
    for key in obj.keys():
        if key != "_RNA_UI":
            value = obj[key]
            result[key] = value.to_dict() if hasattr(value, "to_dict") else value.to_list() if hasattr(value, "to_list") else value
    return result, vertex_indices


def inventory(bpy, inputs):
    rows, objects = [], {}
    for source in inputs:
        role = source.get("source")
        if role not in ("head", "body"):
            raise ValueError("Segmentation sources must explicitly be head or body.")
        imported = load_objects(bpy, source["path"])
        meshes = [o for o in imported if o.type == "MESH" and len(o.data.polygons)]
        if not meshes:
            raise ValueError("Segmentation input has no nonempty meshes: " + role)
        for obj in meshes:
            if obj.data.shape_keys or obj.modifiers or obj.constraints or obj.animation_data:
                raise ValueError("Segmentation inventory requires an explicit unrigged baseline.")
            used_vertices = {vertex for face in obj.data.polygons for vertex in face.vertices}
            used_edges = {tuple(sorted(edge)) for face in obj.data.polygons for edge in face.edge_keys}
            if len(used_vertices) != len(obj.data.vertices) or any(tuple(sorted(edge.vertices)) not in used_edges for edge in obj.data.edges):
                raise ValueError("Separate wire-only or loose geometry explicitly before component grouping.")
            if obj.data.attributes.get("aetherflow_source_face"):
                raise ValueError("Source uses a reserved component provenance attribute.")
            original_name = obj.name
            for number, faces in enumerate(components(obj.data)):
                identity = json.dumps([role, source["hash"], original_name, faces], separators=(",", ":"))
                component_id = hashlib.sha256(identity.encode()).hexdigest()[:24]
                copied, vertices = split_component(bpy, obj, faces, role + "_" + component_id)
                points = [copied.matrix_world @ vertex.co for vertex in copied.data.vertices]
                bounds = {"min": [min(point[i] for point in points) for i in range(3)], "max": [max(point[i] for point in points) for i in range(3)]}
                rows.append({"bounds": bounds, "sourceHash": source["hash"], "matrixWorld": [list(row) for row in copied.matrix_world], "materials": [material.name if material else None for material in copied.data.materials], "componentId": component_id, "source": role, "object": original_name,
                             "meshObject": copied.name, "vertexIndices": vertices, "faceIndices": faces,
                             "vertexCount": len(vertices), "faceCount": len(faces)})
                objects[component_id] = copied
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)
    return rows, objects


def select_only(bpy, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def save_blend(bpy, file):
    file = fresh(file)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(file), check_existing=False)
    return str(file)


def export_fbx(bpy, objects, file, mesh_only=False):
    file = fresh(file)
    select_only(bpy, objects)
    bpy.ops.export_scene.fbx(filepath=str(file), use_selection=True,
                             object_types={"MESH"} if mesh_only else {"MESH", "ARMATURE"},
                             use_mesh_modifiers=False, add_leaf_bones=False, bake_anim=False,
                             path_mode="COPY", embed_textures=not mesh_only,
                             axis_forward="-Z", axis_up="Y")
    return str(file)


def triangulate_derivative(obj):
    """Fix the handoff triangulation on a copy, retaining surface corner data."""
    import bmesh
    original = obj.data
    if original.shape_keys:
        raise ValueError("Resolve shape-key triangulation before preparing a surface baseline.")
    coordinates = [tuple(vertex.co) for vertex in original.vertices]
    loop_by_face_vertex = {(face.index, original.loops[loop].vertex_index): loop
                           for face in original.polygons for loop in face.loop_indices}
    normals = [tuple(normal.vector) for normal in original.corner_normals]
    uv_layers = {layer.name: [tuple(loop.uv) for loop in layer.data] for layer in original.uv_layers}
    active_uv = original.uv_layers.active.name if original.uv_layers.active else None
    render_uv = next((layer.name for layer in original.uv_layers if layer.active_render), None)
    source_faces = len(original.polygons)
    mesh = original.copy()
    obj.data = mesh
    provenance_name = "atelier_triangulated_source_face"
    if mesh.attributes.get(provenance_name):
        mesh.attributes.remove(mesh.attributes[provenance_name])
    provenance = mesh.attributes.new(name=provenance_name, type="INT", domain="FACE")
    provenance.data.foreach_set("value", list(range(source_faces)))
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method="FIXED", ngon_method="EAR_CLIP")
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()
    if len(mesh.vertices) != len(coordinates) or any(tuple(v.co) != coordinates[v.index] for v in mesh.vertices):
        raise ValueError("Triangulation unexpectedly changed the indexed vertex geometry.")
    provenance = mesh.attributes.get(provenance_name)
    if not provenance or any(len(face.vertices) != 3 for face in mesh.polygons):
        raise ValueError("The derivative did not retain a complete triangulated face map.")
    corner_normals = [None] * len(mesh.loops)
    for face in mesh.polygons:
        source_face = int(provenance.data[face.index].value)
        if not 0 <= source_face < source_faces:
            raise ValueError("Triangulated face has invalid source provenance.")
        source = original.polygons[source_face]
        if face.material_index != source.material_index:
            raise ValueError("Triangulation changed material assignment.")
        source_component = original.attributes.get("atelier_component")
        target_component = mesh.attributes.get("atelier_component")
        if source_component and (not target_component or
                target_component.data[face.index].value != source_component.data[source_face].value):
            raise ValueError("Triangulation changed component provenance.")
        face.use_smooth = source.use_smooth
        for loop in face.loop_indices:
            source_loop = loop_by_face_vertex.get((source_face, mesh.loops[loop].vertex_index))
            if source_loop is None:
                raise ValueError("Triangulated corner does not map to its original surface.")
            if len(normals) == len(original.loops):
                corner_normals[loop] = normals[source_loop]
            for name, values in uv_layers.items():
                mesh.uv_layers[name].data[loop].uv = values[source_loop]
    if corner_normals and all(normal is not None for normal in corner_normals):
        mesh.normals_split_custom_set(corner_normals)
    if active_uv:
        mesh.uv_layers.active = mesh.uv_layers[active_uv]
    if render_uv:
        mesh.uv_layers[render_uv].active_render = True
    mesh.update()
    return {"sourceFaces": source_faces, "triangles": len(mesh.polygons),
            "vertexCount": len(coordinates), "verticesChanged": False,
            "cornerDataPreserved": True, "faceProvenanceAttribute": provenance_name}


def guides(bpy, obj, directory, group, resolution, companions=(), object_colors=False, view_directions=None):
    from mathutils import Vector
    scene = bpy.context.scene
    visible = [obj, *companions]
    points = [item.matrix_world @ Vector(corner) for item in visible for corner in item.bound_box]
    low = Vector([min(p[a] for p in points) for a in range(3)])
    high = Vector([max(p[a] for p in points) for a in range(3)])
    center, extent = (low + high) / 2, high - low
    scale = max(extent.x, extent.z, .001) * 1.16
    camera_data = bpy.data.cameras.new("AtelierGuideCamera")
    camera = bpy.data.objects.new("AtelierGuideCamera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.type, camera_data.ortho_scale = "ORTHO", scale
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.threads_mode, scene.render.threads = "FIXED", 1
    shading = scene.display.shading
    shading.light, shading.color_type = "FLAT", "OBJECT" if object_colors else "SINGLE"
    shading.single_color = (.6, .6, .6)
    shading.show_shadows = shading.show_cavity = shading.show_specular_highlight = False
    shading.show_object_outline = True
    obj.show_wire = obj.show_all_edges = not object_colors
    hidden = {o: o.hide_render for o in scene.objects}
    for other in scene.objects:
        other.hide_render = other not in visible and other != camera
    outputs = []
    try:
        for view, direction in (view_directions or (("front", (0,-1,0)), ("back", (0,1,0)))):
            camera.location = center + Vector(direction).normalized() * max(extent.length * 2, 2)
            camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
            rotation = camera.rotation_euler.to_quaternion()
            right, up = rotation @ Vector((1,0,0)), rotation @ Vector((0,1,0))
            # Fit the actual projected bounds for side/top/oblique views too.
            projected_radius = max(max(abs((point-center).dot(right)), abs((point-center).dot(up))) for point in points)
            camera_data.ortho_scale = max(projected_radius * 2, .001) * 1.16
            target = fresh(directory / (group + "-" + view + ".png"))
            scene.render.filepath = str(target)
            bpy.ops.render.render(write_still=True)
            if not target.is_file():
                raise ValueError("Mesh guide did not render: " + view)
            outputs.append({"path": str(target), "hash": sha(target), "role": "mesh-guide",
                            "group": group, "view": view})
    finally:
        for other, value in hidden.items():
            if other.name in scene.objects:
                other.hide_render = value
        bpy.data.objects.remove(camera, do_unlink=True)
    return outputs, {"projection": "orthographic", "frontAxis": "-Y", "center": list(center),
                     "scale": scale, "resolution": resolution, "style": "actual-mesh-guide"}


def face_surface(obj, face, uv_names):
    normals = obj.data.corner_normals
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    corners = []
    for loop in face.loop_indices:
        vertex = obj.data.vertices[obj.data.loops[loop].vertex_index]
        position = obj.matrix_world @ vertex.co
        normal = (normal_matrix @ normals[loop].vector).normalized()
        corners.append((list(position), list(normal), [list(obj.data.uv_layers[name].data[loop].uv) for name in uv_names]))
    material = obj.data.materials[face.material_index] if face.material_index < len(obj.data.materials) else None
    return {"corners": corners, "material": material.name if material else None}


def verify_group_surface(obj, expected, component_order):
    component = obj.data.attributes.get("atelier_component")
    origin = obj.data.attributes.get("aetherflow_source_face")
    if not component or not origin:
        raise ValueError("Joined group lost component/face provenance.")
    by_index = {value: key for key, value in component_order.items()}
    seen, maximum = set(), 0.0
    for face in obj.data.polygons:
        component_id = by_index.get(int(component.data[face.index].value))
        original_face = int(origin.data[face.index].value)
        key = (component_id, original_face)
        if key in seen or component_id not in expected or original_face not in expected[component_id]["faces"]:
            raise ValueError("Group contains missing or duplicate component faces.")
        wanted = expected[component_id]
        if any(not obj.data.uv_layers.get(name) for name in wanted["uvNames"]):
            raise ValueError("Group join lost an existing UV layer.")
        before = wanted["faces"][original_face]
        after = face_surface(obj, face, wanted["uvNames"])
        if before["material"] != after["material"] or len(before["corners"]) != len(after["corners"]):
            raise ValueError("Group join changed surface/material construction.")
        # Cyclic corner rotation is harmless; reversing winding is not.
        first, second = before["corners"], after["corners"]
        def flatten(corner):
            return corner[0] + corner[1] + [number for uv in corner[2] for number in uv]
        residual = min(max(abs(a - b) for ca, cb in zip(first, second[offset:] + second[:offset])
                           for a, b in zip(flatten(ca), flatten(cb))) for offset in range(len(second)))
        maximum = max(maximum, residual)
        if residual > 0.00001:
            raise ValueError("Group join changed world geometry, corner normals or UV coordinates.")
        seen.add(key)
    wanted_keys = {(key, face) for key, value in expected.items() for face in value["faces"]}
    if seen != wanted_keys:
        raise ValueError("Group partition lost an original surface face.")
    return {"sourceFaces": len(seen), "worldSurfacePreserved": True, "uvAndMaterialPreserved": True,
            "cornerNormalsPreserved": True, "maxSurfaceResidual": maximum, "tolerance": 0.00001}


def group_surface_signature(obj):
    """Order-independent directed surface signature for safe carry-forward."""
    uv_names = sorted(layer.name for layer in obj.data.uv_layers)
    faces = []
    for face in obj.data.polygons:
        sample = face_surface(obj, face, uv_names)
        corners = []
        for position, normal, coordinates in sample["corners"]:
            corners.append(tuple(round(float(value), 6) for value in position + normal + [value for uv in coordinates for value in uv]))
        directed = min(tuple(corners[index:] + corners[:index]) for index in range(len(corners)))
        faces.append((directed, sample["material"]))
    payload = {"faces": sorted(faces, key=repr), "uvNames": uv_names,
               "activeUV": obj.data.uv_layers.active.name if obj.data.uv_layers.active else None}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def previous_group_surfaces(bpy, cfg):
    if not cfg.get("baseline") or sha(cfg["baseline"]) != cfg.get("baselineHash"):
        raise ValueError("Repartition requires the exact prior group baseline.")
    imported = load_objects(bpy, cfg["baseline"])
    meshes = [obj for obj in imported if obj.type == "MESH"]
    keys = [obj.get("atelier_group") for obj in meshes]
    if not meshes or any(not key for key in keys) or len(set(keys)) != len(keys):
        raise ValueError("Prior group baseline has ambiguous group identities.")
    result = {str(obj["atelier_group"]): group_surface_signature(obj) for obj in meshes}
    # Isolate the old baseline inspection from new source datablock names and memory.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    return result


def inspect_components(bpy, cfg, directory, rows, objects):
    selected = cfg.get("componentIds", [])
    if not isinstance(selected, list) or not 1 <= len(selected) <= 8 or len(set(selected)) != len(selected) or any(key not in objects for key in selected):
        raise ValueError("Inspect one to eight exact inventory component IDs.")
    outputs = []
    for key in selected:
        images, projection = guides(bpy, objects[key], directory, "component_" + key, 512)
        for image in images:
            image.update({"role": "component-guide", "componentId": key})
        outputs.extend(images)
    for key, obj in list(objects.items()):
        if key not in selected:
            bpy.data.objects.remove(obj, do_unlink=True)
    model = save_blend(bpy, directory / "selected-components.blend")
    outputs.append({"path": model, "hash": sha(model), "role": "component-inspection-model"})
    return {"inventory": [row for row in rows if row["componentId"] in selected],
            "selectedComponentIds": selected, "outputs": outputs, "inspectionOnly": True,
            "productionPartitionChanged": False}


def prepare_groups(bpy, cfg, directory, rows, objects):
    names = group_names(cfg.get("assignments", []), cfg.get("groupDefinitions", []))
    assignment = {}
    for row in cfg.get("assignments", []):
        component, group = row.get("componentId"), row.get("group")
        if component not in objects or component in assignment or not isinstance(group, str):
            raise ValueError("Every real component must have exactly one valid texture group.")
        assignment[component] = group
    if set(assignment) != set(objects):
        raise ValueError("Texture classification does not cover every component exactly once.")
    present = set(assignment.values())
    if not {"head", "upper_body", "lower_body"}.issubset(present):
        raise ValueError("Head, upper_body and lower_body groups are required.")
    source_by_id = {r["componentId"]: r["source"] for r in rows}
    groups, outputs, joined = [], [], []
    component_order = {row["componentId"]: index for index, row in enumerate(rows)}
    for component_id, obj in objects.items():
        attribute = obj.data.attributes.new(name="atelier_component", type="INT", domain="FACE")
        attribute.data.foreach_set("value", [component_order[component_id]] * len(obj.data.polygons))
    for group in sorted(present, key=lambda key: (BASE_GROUPS.index(key), key) if key in BASE_GROUPS else (len(BASE_GROUPS), key)):
        ids = sorted(k for k, v in assignment.items() if v == group)
        if not ids:
            continue
        sources = {source_by_id[k] for k in ids}
        if len(sources) != 1 or group in ("head", "hair") and sources != {"head"} or group in ("upper_body", "lower_body") and sources != {"body"}:
            raise ValueError("A texture group cannot mix incompatible head/body source frames.")
        items = [objects[k] for k in ids]
        count = sum(len(o.data.vertices) for o in items)
        expected = {}
        attribute_types = {}
        for key, item in zip(ids, items):
            uv_names = [layer.name for layer in item.data.uv_layers]
            expected[key] = {"uvNames": uv_names, "faces": {int(item.data.attributes["aetherflow_source_face"].data[face.index].value): face_surface(item, face, uv_names) for face in item.data.polygons}}
            for attribute in item.data.attributes:
                if getattr(attribute, "is_internal", False):
                    continue
                kind = (attribute.domain, attribute.data_type)
                if attribute.name in attribute_types and attribute_types[attribute.name] != kind:
                    raise ValueError("Resolve conflicting attribute types before grouping: " + attribute.name)
                attribute_types[attribute.name] = kind
        select_only(bpy, items)
        if len(items) > 1:
            bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        obj.name = "Atelier_" + group
        obj["atelier_group"] = group
        if len(obj.data.vertices) != count:
            raise ValueError("Group join unexpectedly changed vertex count.")
        preservation = verify_group_surface(obj, expected, component_order)
        triangulation = triangulate_derivative(obj)
        joined.append(obj)
        model = export_fbx(bpy, [obj], directory / (group + ".fbx"))
        outputs.append({"path": model, "hash": sha(model), "role": "texture-group-model", "group": group})
        groups.append({"id": group, **({"name": names[group]} if group in names else {}), "componentIds": ids, "source": next(iter(sources)), "model": model,
                       "vertexCount": count, "faceCount": len(obj.data.polygons),
                       "triangulation": triangulation, "preservation": preservation, "surfaceSignature": group_surface_signature(obj)})
    baseline = save_blend(bpy, directory / "baseline.blend")
    outputs.append({"path": baseline, "hash": sha(baseline), "role": "group-baseline"})
    resolution = int(cfg.get("resolution", 1024))
    if resolution not in (256, 512, 1024, 2048):
        raise ValueError("Guide resolution must be a bounded supported size.")
    for row, obj in zip(groups, joined):
        images, projection = guides(bpy, obj, directory, row["id"], resolution)
        row.update({image["view"]: image["path"] for image in images})
        row["guideProjection"] = projection
        outputs.extend(images)
    palette = [(0.15,0.55,0.95,1), (0.95,0.28,0.22,1), (0.25,0.8,0.4,1), (0.85,0.5,0.95,1), (1,0.7,0.15,1), (0.1,0.85,0.85,1), (0.95,0.45,0.65,1)]
    legend, copies = [], []
    try:
        for index, (row, obj) in enumerate(zip(groups, joined)):
            copy = obj.copy()
            bpy.context.collection.objects.link(copy)
            copy.color = palette[index % len(palette)]
            copy.show_wire = copy.show_all_edges = False
            copies.append((row, copy))
            legend.append({"key": row["id"], "name": row.get("name", row["id"]), "source": row["source"], "color": list(copy.color), "componentCount": len(row["componentIds"])})
        for source in ("head", "body"):
            visible = [obj for row, obj in copies if row["source"] == source]
            if visible:
                images, projection = guides(bpy, visible[0], directory, source + "-partition", min(resolution, 1024), visible[1:], True)
                for image in images:
                    image.update({"role": "partition-overview", "source": source})
                    outputs.append(image)
    finally:
        for row, obj in copies:
            bpy.data.objects.remove(obj, do_unlink=True)
    return {"inventory": rows, "groups": groups, "outputs": outputs, "partitionLegend": legend,
            "coverageComplete": True, "verticesWelded": False, "triangulatedDerivative": True,
            "worldSurfacePreserved": True, "uvAndMaterialPreserved": True}


def rig_signature(objects, include_world=True):
    # Shared audited fingerprint covers complete action curves/slots, bindings,
    # NLA and armature world/rest transforms, not only action names/frame ranges.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from preservation_fingerprint import animation_fingerprint
    data = []
    for obj in sorted(objects, key=lambda o: o.name):
        if obj.type == "ARMATURE":
            data.append([obj.name, "rig", [[b.name, b.parent.name if b.parent else None,
                         [float(c) for row in b.matrix_local for c in row]] for b in obj.data.bones]])
        elif obj.type == "MESH":
            data.append([obj.name, "skin", [g.name for g in obj.vertex_groups],
                         [[[g.group, float(g.weight)] for g in v.groups] for v in obj.data.vertices]])
        if obj.animation_data and obj.animation_data.action:
            action = obj.animation_data.action
            data.append([obj.name, "action", action.name, list(action.frame_range)])
    animation = animation_fingerprint()
    if include_world:
        data.append(["animation", animation["fingerprint"]])
    else:
        for armature in animation["payload"]["armatures"]:
            armature.pop("world", None)
        data.append(["animationCore", animation["payload"]])
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def uniform_alignment(moving, fixed, enabled):
    """Bounds propose a transform; exhaustive face mapping is the proof."""
    from mathutils import Matrix, Vector
    if not enabled:
        return Matrix.Identity(4)
    def bounds(objects):
        points = [o.matrix_world @ v.co for o in objects if o.type == "MESH" for v in o.data.vertices]
        if not points:
            raise ValueError("Cannot align an empty mesh set.")
        low = Vector([min(p[a] for p in points) for a in range(3)])
        high = Vector([max(p[a] for p in points) for a in range(3)])
        return (low + high) / 2, high - low
    moving_center, moving_size = bounds(moving)
    fixed_center, fixed_size = bounds(fixed)
    axis = max(range(3), key=lambda a: fixed_size[a])
    if moving_size[axis] <= 1e-12:
        raise ValueError("Returned model cannot be uniformly aligned to the baseline.")
    scale = fixed_size[axis] / moving_size[axis]
    if not math.isfinite(scale) or not 1e-6 <= scale <= 1e6:
        raise ValueError("Uniform correspondence scale is invalid.")
    offset = fixed_center - moving_center * scale
    if abs(scale - 1.0) < 1e-8 and offset.length < 1e-8:
        return Matrix.Identity(4)
    return Matrix.Translation(offset) @ Matrix.Scale(scale, 4)


def rig_source(bpy, cfg, directory):
    imported = load_objects(bpy, cfg["inputs"][0]["path"])
    objects = [o for o in imported if o.type == "MESH"]
    if not objects or any(o.data.shape_keys for o in objects):
        raise ValueError("Rig-source baseline needs meshes without unresolved shape-key triangulation.")
    if any(o.type == "ARMATURE" for o in imported):
        raise ValueError("The pre-rig source already contains an armature; inspect it before replacement.")
    triangulation = {obj.name: triangulate_derivative(obj) for obj in objects}
    baseline = save_blend(bpy, directory / "baseline.blend")
    surface = {"schemaVersion": 1, "baselineHash": sha(baseline), "sourceHash": cfg["inputs"][0]["hash"],
               "triangulatedDerivative": True, "triangulation": triangulation,
               "objects": [{"name": o.name, "vertices": len(o.data.vertices),
               "faces": len(o.data.polygons), "uvLayers": [u.name for u in o.data.uv_layers]} for o in objects]}
    snapshot = write_json(directory / "surface-baseline.json", surface)
    for obj in objects:
        obj.data.materials.clear()
        for face in obj.data.polygons:
            face.material_index = 0
    model = export_fbx(bpy, objects, directory / "rig-source.fbx", mesh_only=True)
    return {"baseline": baseline, "baselineHash": sha(baseline), "triangulatedDerivative": True,
            "outputs": [{"path": model, "hash": sha(model), "role": "rig-source"},
                        {"path": baseline, "hash": sha(baseline), "role": "rig-baseline"},
                        {"path": snapshot, "hash": sha(snapshot), "role": "surface-baseline"}]}


def restore_materials(bpy, cfg, directory, assembly=False):
    from mathutils.kdtree import KDTree
    baseline = Path(cfg["baseline"]).resolve()
    if not cfg.get("baselineHash") or sha(baseline) != cfg["baselineHash"]:
        raise ValueError("The managed rig-source baseline hash is missing or changed.")
    returned = load_objects(bpy, baseline if assembly else cfg["inputs"][0]["path"])
    if not assembly and not any(o.type == "ARMATURE" and len(o.data.bones) for o in returned):
        raise ValueError("Returned rig has no skeleton.")
    before_rig = rig_signature(returned)
    before_core = rig_signature(returned, include_world=False)
    returned_actions = set(bpy.data.actions)
    reference_alignment = {}
    group_inputs = {}
    if assembly:
        reference_objects = []
        for source in cfg["inputs"]:
            loaded = load_objects(bpy, source["path"])
            group = source.get("source")
            fixed = [o for o in returned if o.type == "MESH" and o.get("atelier_group") == group]
            if not fixed:
                raise SurfaceDiagnosticError("SURFACE_GROUP_MISSING", "A texture return has no matching saved baseline group.", {
                    "group": group, "object": None, "baselineFaceCount": 0,
                    "referenceFaceCount": sum(len(o.data.polygons) for o in loaded if o.type == "MESH")})
            if not group or group in group_inputs:
                raise SurfaceDiagnosticError("SURFACE_GROUP_DUPLICATE", "Texture return group names must be present and unique.", {
                    "group": group, "object": None})
            try:
                transform = uniform_alignment(loaded, fixed, cfg.get("alignToBaseline", True))
            except Exception as error:
                raise SurfaceDiagnosticError("SURFACE_GROUP_ALIGNMENT_FAILED",
                    "A returned texture group could not be aligned to its saved baseline.", {
                        "group": group, "object": [o.name for o in loaded if o.type == "MESH"],
                        "baselineFaceCount": sum(len(o.data.polygons) for o in fixed),
                        "referenceFaceCount": sum(len(o.data.polygons) for o in loaded if o.type == "MESH"),
                        "tolerance": float(cfg.get("tolerance", 0.00001)),
                        "alignmentError": str(error)[:500]}) from error
            reference_alignment.update({o: transform for o in loaded if o.type == "MESH"})
            reference_objects.extend(loaded)
            group_inputs[group] = {"objects": [o for o in loaded if o.type == "MESH"],
                                   "baseline": fixed, "alignment": transform}
    else:
        with bpy.data.libraries.load(str(baseline), link=False) as (src, dst):
            dst.objects = src.objects
        reference_objects = [o for o in dst.objects if o is not None]
    refs = [o for o in reference_objects if o.type == "MESH"]
    if not refs:
        raise ValueError("Rig baseline contains no mesh.")
    material_refs = {}
    material_source_hash = None
    if not assembly and cfg.get("materialSource"):
        material_source = Path(cfg["materialSource"]).resolve()
        material_source_hash = cfg.get("materialSourceHash")
        if not material_source_hash or sha(material_source) != material_source_hash:
            raise ValueError("The managed Workbench material-source hash is missing or changed.")
        with bpy.data.libraries.load(str(material_source), link=False) as (src, dst):
            dst.objects = src.objects
        material_meshes = [obj for obj in dst.objects if obj is not None and obj.type == "MESH"]
        if not material_meshes:
            raise ValueError("The current Workbench material source contains no meshes.")
        material_refs = {}
        material_face_maps = {}
        def world_vertex_set(obj):
            return {tuple(round(float(x), 9) for x in obj.matrix_world @ vertex.co) for vertex in obj.data.vertices}
        for source_obj in refs:
            positions = world_vertex_set(source_obj)
            matches = [obj for obj in material_meshes if world_vertex_set(obj) == positions]
            if len(matches) != 1:
                raise ValueError("The Workbench material source has missing or ambiguous baseline mesh geometry.")
            material_refs[source_obj] = matches[0]
            by_position = {}
            for face in matches[0].data.polygons:
                for vertex_index in face.vertices:
                    position = tuple(round(float(x), 9) for x in matches[0].matrix_world @ matches[0].data.vertices[vertex_index].co)
                    by_position.setdefault(position, set()).add(face.index)
            material_face_maps[source_obj] = by_position

    def corrected_material(source, source_face):
        if not material_refs:
            return source.material_slots[source_face.material_index].material if source_face.material_index < len(source.material_slots) else None
        corrected = material_refs[source]
        target_positions = {tuple(round(float(x), 9) for x in source.matrix_world @ source.data.vertices[v].co)
                           for v in source_face.vertices}
        face_maps = material_face_maps[source]
        matching_faces = None
        for position in target_positions:
            incident = face_maps.get(position, set())
            matching_faces = incident.copy() if matching_faces is None else matching_faces.intersection(incident)
        if len(target_positions) != 3 or len(matching_faces or ()) != 1:
            raise ValueError("The Workbench material source has missing or ambiguous per-face geometry correspondence.")
        face = corrected.data.polygons[next(iter(matching_faces))]
        if face.material_index >= len(corrected.material_slots):
            raise ValueError("The Workbench material source face has no corresponding material slot.")
        return corrected.material_slots[face.material_index].material
    # The raw helper and rig path retain the 1e-5 default. The guided adapter
    # supplies the separately approved fixed 2.5e-5 value for assembly only.
    tolerance = float(cfg.get("tolerance", 0.00001))
    tolerance_cap = 0.0001
    if not math.isfinite(tolerance) or not 0 < tolerance <= tolerance_cap:
        raise ValueError("Surface tolerance must be explicit and bounded.")
    if assembly:
        return restore_assembly_materials(bpy, cfg, directory, returned, group_inputs,
                                          baseline_hash=cfg["baselineHash"], tolerance=tolerance,
                                          tolerance_cap=tolerance_cap, before_rig=before_rig,
                                          before_core=before_core, returned_actions=returned_actions)
    from mathutils import Matrix
    target_alignment = uniform_alignment(returned, refs, cfg.get("alignToBaseline", True))
    def reference_position(obj, vertex):
        return reference_alignment.get(obj, Matrix.Identity(4)) @ obj.matrix_world @ vertex.co
    points, point_ids, base_faces = [], {}, {}
    for obj in refs:
        for vertex in obj.data.vertices:
            position = tuple(float(x) for x in reference_position(obj, vertex))
            if not all(math.isfinite(x) for x in position):
                raise ValueError("Baseline contains invalid coordinates.")
            key = tuple(round(x, 9) for x in position)
            if key not in point_ids:
                point_ids[key] = len(points)
                points.append(position)
        for face in obj.data.polygons:
            if len(face.vertices) != 3:
                raise ValueError("Rig source must use its saved triangulated baseline.")
            ids = [point_ids[tuple(round(float(x), 9) for x in reference_position(obj, obj.data.vertices[v]))] for v in face.vertices]
            key = tuple(sorted(ids))
            if len(set(ids)) != 3 or key in base_faces:
                raise ValueError("Degenerate or coincident baseline faces make surface mapping ambiguous.")
            base_faces[key] = (obj, face, ids)
    tree = KDTree(len(points))
    for i, point in enumerate(points):
        tree.insert(point, i)
    tree.balance()
    active_names = {o.data.uv_layers.active.name for o in refs if o.data.uv_layers.active}
    active_name = next(iter(active_names)) if len(active_names) == 1 else "Atelier_RestoredUV"
    used, maximum = set(), 0.0
    for obj in (o for o in returned if o.type == "MESH"):
        mapped = []
        restored_normals = [tuple(normal.vector) for normal in obj.data.corner_normals]
        for vertex in obj.data.vertices:
            position = target_alignment @ obj.matrix_world @ vertex.co
            matches = tree.find_range(position, tolerance)
            if len(matches) != 1:
                raise ValueError("Returned vertex has missing or ambiguous baseline correspondence.")
            _, index, distance = matches[0]
            maximum = max(maximum, distance)
            mapped.append(index)
        material_map = {}
        obj.data.materials.clear()
        for face in obj.data.polygons:
            ids = [mapped[i] for i in face.vertices]
            key = tuple(sorted(ids))
            if len(ids) != 3 or key not in base_faces or key in used:
                raise ValueError("Returned mesh has changed, duplicated or unknown faces.")
            source, source_face, source_ids = base_faces[key]
            cyclic = any(ids == source_ids[i:] + source_ids[:i] for i in range(3))
            if not cyclic:
                raise ValueError("Returned face winding differs from its baseline.")
            used.add(key)
            if not assembly:
                source_normal_matrix = source.matrix_world.to_3x3().inverted().transposed()
                target_normal_matrix = (target_alignment @ obj.matrix_world).to_3x3().transposed()
                for loop, point_id in zip(face.loop_indices, ids):
                    source_loop = source_face.loop_indices[source_ids.index(point_id)]
                    world_normal = (source_normal_matrix @ source.data.corner_normals[source_loop].vector).normalized()
                    restored_normals[loop] = tuple((target_normal_matrix @ world_normal).normalized())
            for layer in source.data.uv_layers:
                target = obj.data.uv_layers.get(layer.name) or obj.data.uv_layers.new(name=layer.name)
                for loop, point_id in zip(face.loop_indices, ids):
                    source_loop = source_face.loop_indices[source_ids.index(point_id)]
                    target.data[loop].uv = layer.data[source_loop].uv
            if not source.data.uv_layers.active:
                raise ValueError("A textured baseline face has no active UV layer.")
            active_target = obj.data.uv_layers.get(active_name) or obj.data.uv_layers.new(name=active_name)
            for loop, point_id in zip(face.loop_indices, ids):
                source_loop = source_face.loop_indices[source_ids.index(point_id)]
                active_target.data[loop].uv = source.data.uv_layers.active.data[source_loop].uv
            material = corrected_material(source, source_face)
            material_key = material.as_pointer() if material else 0
            if material_key not in material_map:
                material_map[material_key] = len(obj.data.materials)
                obj.data.materials.append(material)
            face.material_index = material_map[material_key]
        obj.data.uv_layers.active = obj.data.uv_layers[active_name]
        obj.data.uv_layers[active_name].active_render = True
        if not assembly and restored_normals:
            obj.data.normals_split_custom_set(restored_normals)
        obj.data.update()
    if used != set(base_faces):
        raise ValueError("Returned rig is missing baseline faces.")
    alignment_report = {o.name: [[float(c) for c in row] for row in mat]
                        for o, mat in reference_alignment.items()}
    for obj in reference_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        if action not in returned_actions and action.users == 0:
            bpy.data.actions.remove(action)
    after_rig = rig_signature(returned)
    if before_rig != after_rig:
        raise ValueError("Material restoration changed returned rig/weights/actions.")
    alignment_rows = [[float(c) for c in row] for row in target_alignment]
    identity = Matrix.Identity(4)
    aligned = any(abs(target_alignment[r][c] - identity[r][c]) > 1e-10 for r in range(4) for c in range(4))
    root_name = None
    if aligned and not assembly:
        roots = [o for o in returned if o.parent not in returned]
        if not roots:
            raise ValueError("Returned hierarchy has no alignable root.")
        original_world = {o: o.matrix_world.copy() for o in returned}
        root = bpy.data.objects.new("Atelier_Rig_Alignment", None)
        bpy.context.collection.objects.link(root)
        for obj in roots:
            obj.parent = root
            obj.matrix_parent_inverse = Matrix.Identity(4)
        root.matrix_world = target_alignment
        bpy.context.view_layer.update()
        for obj, old_world in original_world.items():
            expected = target_alignment @ old_world
            if any(abs(obj.matrix_world[r][c] - expected[r][c]) > tolerance for r in range(4) for c in range(4)):
                raise ValueError("Static parent alignment did not preserve the returned hierarchy.")
        root_name = root.name
    after_core = rig_signature(returned, include_world=False)
    if before_core != after_core:
        raise ValueError("Global alignment changed local rest data, weights or animation controls.")
    after_rig = rig_signature(returned)
    output = save_blend(bpy, directory / ("assembled.blend" if assembly else "restored.blend"))
    return {"outputs": [{"path": output, "hash": sha(output), "role": "assembled-textured-model" if assembly else "restored-rig-model"}],
            "baselineHash": cfg["baselineHash"], "geometryCorrespondenceProven": True,
            "materialSourceHash": material_source_hash,
            "mappedFaceCount": len(used), "maxPositionError": maximum, "tolerance": tolerance,
            "rigWeightsActionsPreserved": True, "rigBeforeHash": before_rig, "rigAfterHash": after_rig,
            "rigCoreBeforeHash": before_core, "rigCoreAfterHash": after_core,
            "baselineCornerNormalsRestored": not assembly,
            "globalAlignment": {"matrix": alignment_rows, "staticParent": root_name,
                                "applied": aligned and not assembly, "rotationGuessed": False},
            "groupReturnAlignment": alignment_report}


class SurfaceDiagnosticError(ValueError):
    def __init__(self, code, message, facts=None):
        super().__init__(message)
        self.code = code
        self.facts = facts or {}
        self.recovery = "Check the registered group return against the saved baseline; replace only the affected return if its topology is incompatible, then retry assembly."


def restore_assembly_materials(bpy, cfg, directory, returned, group_inputs, *, baseline_hash,
                               tolerance, tolerance_cap, before_rig, before_core, returned_actions):
    """Transfer per-corner materials from each declared group by complete directed-face proof."""
    from mathutils import Vector
    from mathutils.kdtree import KDTree
    baseline_meshes = [o for o in returned if o.type == "MESH"]
    ungrouped = [o.name for o in baseline_meshes if not o.get("atelier_group")]
    if ungrouped:
        raise SurfaceDiagnosticError("SURFACE_BASELINE_GROUP_MISSING",
            "Every saved baseline mesh must declare exactly one texture group.", {
                "objects": ungrouped, "baselineMeshCount": len(baseline_meshes),
                "providedGroups": sorted(group_inputs)})
    expected_groups = {str(o.get("atelier_group")) for o in baseline_meshes}
    provided_groups = set(group_inputs)
    if expected_groups != provided_groups:
        raise SurfaceDiagnosticError("SURFACE_GROUP_SET_MISMATCH",
            "Returned texture groups do not match the saved baseline groups.", {
                "missingGroups": sorted(expected_groups - provided_groups),
                "unexpectedGroups": sorted(provided_groups - expected_groups),
                "baselineGroups": sorted(expected_groups), "providedGroups": sorted(provided_groups)})

    def point(obj, vertex, transform):
        return transform @ obj.matrix_world @ vertex.co

    def max_error(left, right):
        return max((left[i] - right[i]).length for i in range(3))

    total_faces, maximum = 0, 0.0
    group_reports = {}
    for group in sorted(provided_groups):
        source = group_inputs[group]
        target_objects = source["baseline"]
        source_objects = source["objects"]
        alignment = source["alignment"]
        material_maps = {}
        active_names = {obj.data.uv_layers.active.name for obj in source_objects
                        if obj.data.uv_layers.active}
        if len(active_names) == 1:
            restored_active_name = next(iter(active_names))
        else:
            reserved_names = {layer.name for obj in target_objects for layer in obj.data.uv_layers}
            reserved_names.update(layer.name for obj in source_objects for layer in obj.data.uv_layers)
            restored_active_name = "Atelier_RestoredActiveUV"
            suffix = 1
            while restored_active_name in reserved_names:
                restored_active_name = "Atelier_RestoredActiveUV_" + str(suffix)
                suffix += 1
        for target_obj in target_objects:
            target_obj.data.materials.clear()
            material_maps[target_obj] = {}
            target_obj.data.uv_layers.get(restored_active_name) or target_obj.data.uv_layers.new(name=restored_active_name)
        references = []
        for source_obj in source_objects:
            for face in source_obj.data.polygons:
                if len(face.vertices) != 3:
                    raise SurfaceDiagnosticError("SURFACE_NON_TRIANGULATED_REFERENCE",
                        "A returned texture group contains a non-triangle face.", {
                            "group": group, "object": source_obj.name, "face": face.index,
                            "referenceFaceCount": len(source_obj.data.polygons), "tolerance": tolerance})
                coords = [point(source_obj, source_obj.data.vertices[index], alignment)
                          for index in face.vertices]
                center = sum(coords, Vector()) / 3
                references.append((source_obj, face, coords, center))
        target_faces = [(obj, face) for obj in target_objects for face in obj.data.polygons]
        if not references or len(references) != len(target_faces):
            raise SurfaceDiagnosticError("SURFACE_FACE_COUNT_MISMATCH",
                "The returned group does not contain the saved number of surface triangles.", {
                    "group": group, "baselineFaceCount": len(target_faces),
                    "referenceFaceCount": len(references), "tolerance": tolerance})
        tree = KDTree(len(references))
        for index, (_, _, _, center) in enumerate(references):
            tree.insert(center, index)
        tree.balance()
        used = set()
        max_group_error = 0.0
        for target_obj, target_face in target_faces:
            if len(target_face.vertices) != 3:
                raise SurfaceDiagnosticError("SURFACE_NON_TRIANGULATED_BASELINE",
                    "The saved baseline contains a non-triangle face.", {
                        "group": group, "object": target_obj.name, "face": target_face.index,
                        "baselineFaceCount": len(target_faces), "referenceFaceCount": len(references),
                        "tolerance": tolerance})
            coords = [target_obj.matrix_world @ target_obj.data.vertices[index].co
                      for index in target_face.vertices]
            center = sum(coords, Vector()) / 3
            candidate_faces = []
            reverse_faces = []
            for _, index, _ in tree.find_range(center, tolerance * 2.0):
                _, reference_face, reference_coords, _ = references[index]
                for shift in range(3):
                    cyclic = reference_coords[shift:] + reference_coords[:shift]
                    error = max_error(coords, cyclic)
                    if error <= tolerance:
                        candidate_faces.append((index, reference_face, shift, error))
                    reverse = [reference_coords[(shift - corner) % 3] for corner in range(3)]
                    reverse_error = max_error(coords, reverse)
                    if reverse_error <= tolerance:
                        reverse_faces.append((index, reference_face, shift, reverse_error))
            nearest_center = tree.find(center)
            nearest_error = None
            if nearest_center:
                _, nearest_index, _ = nearest_center
                nearest_coords = references[nearest_index][2]
                nearest_error = min(max_error(coords, nearest_coords[i:] + nearest_coords[:i])
                                    for i in range(3))
            if len(candidate_faces) != 1:
                code = ("SURFACE_FACE_WINDING_MISMATCH" if not candidate_faces and reverse_faces else
                        "SURFACE_FACE_CORRESPONDENCE_MISSING" if not candidate_faces else
                        "SURFACE_FACE_CORRESPONDENCE_AMBIGUOUS")
                raise SurfaceDiagnosticError(code,
                    "A saved surface triangle has no unique same-winding match in its registered texture group.", {
                        "group": group, "object": target_obj.name, "face": target_face.index,
                        "baselineFaceCount": len(target_faces), "referenceFaceCount": len(references),
                        "matchedFaceCount": len(used), "candidateCount": len(candidate_faces),
                        "reverseCandidateCount": len({item[0] for item in reverse_faces}),
                        "tolerance": tolerance, "toleranceCap": tolerance_cap,
                        "nearestFaceCornerError": nearest_error,
                        "nearestFaceCenterDistance": float(nearest_center[2]) if nearest_center else None})
            reference_index, reference_face, shift, error = candidate_faces[0]
            if reference_index in used:
                raise SurfaceDiagnosticError("SURFACE_FACE_CORRESPONDENCE_DUPLICATE",
                    "Two saved triangles resolve to the same returned texture face.", {
                        "group": group, "object": target_obj.name, "face": target_face.index,
                        "referenceFace": reference_face.index, "matchedFaceCount": len(used),
                        "baselineFaceCount": len(target_faces), "referenceFaceCount": len(references),
                        "tolerance": tolerance, "maxPositionError": error})
            used.add(reference_index)
            source_obj = references[reference_index][0]
            material = (source_obj.material_slots[reference_face.material_index].material
                        if reference_face.material_index < len(source_obj.material_slots) else None)
            if not source_obj.data.uv_layers.active:
                raise SurfaceDiagnosticError("SURFACE_REFERENCE_UV_MISSING",
                    "A matched returned face has no active UV layer.", {
                        "group": group, "object": source_obj.name, "face": reference_face.index,
                        "tolerance": tolerance})
            material_key = material.as_pointer() if material else 0
            material_map = material_maps[target_obj]
            if material_key not in material_map:
                material_map[material_key] = len(target_obj.data.materials)
                target_obj.data.materials.append(material)
            target_face.material_index = material_map[material_key]
            for layer in source_obj.data.uv_layers:
                target_layer = target_obj.data.uv_layers.get(layer.name) or target_obj.data.uv_layers.new(name=layer.name)
                for corner, loop_index in enumerate(target_face.loop_indices):
                    source_loop = reference_face.loop_indices[(shift + corner) % 3]
                    target_layer.data[loop_index].uv = layer.data[source_loop].uv
            active_source_layer = source_obj.data.uv_layers.active
            restored_active_layer = target_obj.data.uv_layers[restored_active_name]
            for corner, loop_index in enumerate(target_face.loop_indices):
                source_loop = reference_face.loop_indices[(shift + corner) % 3]
                restored_active_layer.data[loop_index].uv = active_source_layer.data[source_loop].uv
            target_obj.data.uv_layers.active = restored_active_layer
            restored_active_layer.active_render = True
            max_group_error = max(max_group_error, error)
        if len(used) != len(references):
            raise SurfaceDiagnosticError("SURFACE_REFERENCE_FACE_UNCOVERED",
                "The returned texture group contains faces with no saved baseline counterpart.", {
                    "group": group, "baselineFaceCount": len(target_faces),
                    "referenceFaceCount": len(references), "matchedFaceCount": len(used),
                    "unmatchedReferenceFaceCount": len(references) - len(used), "tolerance": tolerance})
        for obj in target_objects:
            obj.data.update()
        group_reports[group] = {"baselineFaceCount": len(target_faces),
                                "referenceFaceCount": len(references),
                                "matchedFaceCount": len(used), "maxPositionError": max_group_error,
                                "sourceActiveUVNames": sorted(active_names),
                                "restoredActiveUVName": restored_active_name,
                                "alignment": [[float(c) for c in row] for row in alignment]}
        total_faces += len(used)
        maximum = max(maximum, max_group_error)

    before_after_core = rig_signature(returned, include_world=False)
    if before_core != before_after_core:
        raise SurfaceDiagnosticError("SURFACE_RESTORE_CHANGED_RIG_CORE",
            "Material restoration changed local rest data, weights, or animation controls.", {
                "tolerance": tolerance})
    for source in group_inputs.values():
        for obj in source["objects"]:
            bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        if action not in returned_actions and action.users == 0:
            bpy.data.actions.remove(action)
    output = save_blend(bpy, directory / "assembled.blend")
    return {"outputs": [{"path": output, "hash": sha(output), "role": "assembled-textured-model"}],
            "baselineHash": baseline_hash, "geometryCorrespondenceProven": True,
            "mappedFaceCount": total_faces, "maxPositionError": maximum, "tolerance": tolerance,
            "tolerancePolicy": {"kind": "bounded-conversion-alignment-precision", "default": 0.00001,
                                "used": tolerance, "limit": tolerance_cap, "adaptive": False},
            "groupCorrespondence": group_reports,
            "rigWeightsActionsPreserved": True, "rigCoreBeforeHash": before_core,
            "rigCoreAfterHash": before_after_core,
            "globalAlignment": {"applied": False, "rotationGuessed": False},
            "groupReturnAlignment": {group: report["alignment"] for group, report in group_reports.items()}}


def main():
    import bpy
    import traceback
    args = sys.argv[sys.argv.index("--") + 1:]
    if len(args) != 1:
        raise ValueError("Provide one operation config JSON after --.")
    cfg = json.loads(Path(args[0]).read_text(encoding="utf-8-sig"))
    report = Path(cfg["report"]).resolve()
    if report.exists():
        raise ValueError("Report path already exists; choose a new operation directory.")
    directory = Path(cfg["outputDirectory"]).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    inputs = cfg.get("inputs", [])
    if not inputs or len(inputs) > (MAX_GROUPS if cfg.get("mode") == "assemble-returns" else 2):
        raise ValueError("Provide bounded explicitly hashed input models.")
    for source in inputs:
        source["path"] = str(Path(source["path"]).resolve())
        if not source.get("hash") or sha(source["path"]) != source["hash"]:
            raise ValueError("Managed input hash mismatch.")
        if directory == Path(source["path"]).parent:
            raise ValueError("Outputs need a separate operation directory.")
    if cfg.get("materialSource"):
        cfg["materialSource"] = str(Path(cfg["materialSource"]).resolve())
        if not cfg.get("materialSourceHash") or sha(cfg["materialSource"]) != cfg["materialSourceHash"]:
            raise ValueError("Managed Workbench material-source hash mismatch.")
        if directory == Path(cfg["materialSource"]).parent:
            raise ValueError("Outputs need a separate material-source operation directory.")
    elif cfg.get("materialSourceHash"):
        raise ValueError("A Workbench material-source hash requires its managed file.")
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    mode = cfg.get("mode")
    print("ATELIER_PROGRESS|15|Inspecting explicit managed inputs", flush=True)
    try:
        if mode in ("inventory", "inspect-components", "prepare-groups", "repartition-groups"):
            previous_surfaces = previous_group_surfaces(bpy, cfg) if mode == "repartition-groups" else None
            rows, objects = inventory(bpy, inputs)
            if mode == "inventory":
                model = save_blend(bpy, directory / "inventory.blend")
                result = {"inventory": rows, "outputs": [{"path": model, "hash": sha(model), "role": "component-inventory"}]}
            elif mode == "inspect-components":
                result = inspect_components(bpy, cfg, directory, rows, objects)
            else:
                result = prepare_groups(bpy, cfg, directory, rows, objects)
                if previous_surfaces is not None:
                    for group in result["groups"]:
                        group["baselineSurfaceUnchanged"] = previous_surfaces.get(group["id"]) == group["surfaceSignature"]
                    result["previousBaselineHash"] = cfg["baselineHash"]
        elif mode == "rig-source":
            result = rig_source(bpy, cfg, directory)
        elif mode == "restore-rig-materials":
            result = restore_materials(bpy, cfg, directory)
        elif mode == "assemble-returns":
            result = restore_materials(bpy, cfg, directory, assembly=True)
        else:
            raise ValueError("Unsupported guided surface operation.")
        for source in inputs:
            if sha(source["path"]) != source["hash"]:
                raise ValueError("Source changed during operation.")
        if cfg.get("baseline") and sha(cfg["baseline"]) != cfg.get("baselineHash"):
            raise ValueError("Baseline changed during operation.")
        if cfg.get("materialSource") and sha(cfg["materialSource"]) != cfg.get("materialSourceHash"):
            raise ValueError("Workbench material source changed during operation.")
        result.update({"schemaVersion": 1, "mode": mode, "autoexec": "disabled",
                       "inputHashes": [s["hash"] for s in inputs],
                       "sourceHashes": {s["source"]: s["hash"] for s in inputs},
                       "materialSourceHash": cfg.get("materialSourceHash"),
                       "blenderVersion": bpy.app.version_string, "ok": True})
        write_json(report, result)
        print("ATELIER_PROGRESS|100|Outputs and correspondence report saved", flush=True)
    except Exception as error:
        if report.exists():
            raise
        details = error.facts if isinstance(error, SurfaceDiagnosticError) else {}
        failure = {"schemaVersion": 1, "mode": mode, "autoexec": "disabled", "ok": False,
                   "inputs": [{"path": str(s.get("path", "")), "source": str(s.get("source", "")),
                               "hash": str(s.get("hash", ""))} for s in inputs],
                   "baseline": {"path": str(cfg.get("baseline", "")),
                                "hash": str(cfg.get("baselineHash", ""))} if cfg.get("baseline") else None,
                   "outputs": [], "failure": {"code": getattr(error, "code", "SURFACE_OPERATION_FAILED"),
                                              "message": str(error)[:1000], "operation": mode,
                                              "phase": "restore-materials" if mode in ("assemble-returns", "restore-rig-materials") else mode,
                                              "recovery": getattr(error, "recovery", "Verify the registered inputs and saved baseline; correct only the affected input, then retry the operation."),
                                              **details,
                                              "technicalDetails": traceback.format_exc()[-12000:]}}
        failure["inputHashes"] = [s["hash"] for s in inputs]
        failure["sourceHashes"] = {s["source"]: s["hash"] for s in inputs}
        failure["materialSourceHash"] = cfg.get("materialSourceHash")
        try:
            write_json(report, failure)
        except Exception as report_error:
            print("ATELIER_FAILURE_REPORT_WRITE_ERROR|" + str(report_error), flush=True)
        print("ATELIER_FAILURE|" + json.dumps(failure["failure"], ensure_ascii=False, sort_keys=True), flush=True)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
