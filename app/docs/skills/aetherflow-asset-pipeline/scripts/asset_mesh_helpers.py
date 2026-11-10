"""Source-preserving mesh helpers adapted from AetherFlow guided surface tools."""
from pathlib import Path

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
