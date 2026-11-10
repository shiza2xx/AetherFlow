"""Blender regression: one semantic asset group exports as one mesh object.

Run with:
  blender --background --factory-startup --disable-autoexec --threads 1 \
    --python test_asset_surface_join.py -- <empty-evidence-directory>

The fixture contains two independent pieces per prop, non-identity object
transforms, different materials and UV coordinates. The FBX round trip must
keep one mesh object per prop while retaining disconnected surfaces.
"""
import hashlib
import json
import sys
import tempfile
import traceback
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT))
import asset_surface


def digest(file):
    value = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def make_part(name, location, rotation, scale, material_name, color):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name + '_Mesh'
    obj.scale = scale
    material = bpy.data.materials.new(material_name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    if shader:
        shader.inputs['Base Color'].default_value = (*color, 1.0)
    obj.data.materials.append(material)
    uv = obj.data.uv_layers.new(name='UVMap')
    for face in obj.data.polygons:
        face.material_index = 0
        for loop_index in face.loop_indices:
            uv.data[loop_index].uv = (float((loop_index + face.index) % 3) / 2.0,
                                      float((loop_index + 1) % 2))
    obj.data.uv_layers.active = uv
    return obj


def create_source(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    parts = [
        make_part('PartA1', (0.0, 0.0, 0.0), (0.1, 0.2, 0.0), (1.0, 0.8, 1.2), 'Mat_Warm', (0.8, 0.2, 0.1)),
        make_part('PartA2', (2.2, 0.3, 0.2), (0.0, 0.35, 0.1), (0.7, 1.1, 0.9), 'Mat_Cool', (0.1, 0.3, 0.8)),
        make_part('PartB1', (5.0, -0.1, 0.0), (0.25, 0.0, 0.2), (1.2, 0.6, 1.0), 'Mat_Green', (0.2, 0.7, 0.25)),
        make_part('PartB2', (7.3, 0.5, -0.2), (0.0, 0.1, 0.45), (0.8, 1.0, 0.7), 'Mat_Gold', (0.85, 0.6, 0.1)),
    ]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.export_scene.fbx(filepath=str(file), use_selection=True, object_types={'MESH'},
                             use_mesh_modifiers=False, add_leaf_bones=False, bake_anim=False,
                             path_mode='COPY', embed_textures=True, axis_forward='-Z', axis_up='Y')
    return parts


def create_legacy_multi_object_partition(source_file, legacy_file, names):
    objects = reset_and_import(source_file)
    selected = [obj for obj in objects if obj.name in set(names)]
    assert len(selected) == 2, f'Legacy partition fixture has {len(selected)} source mesh objects.'
    bpy.ops.object.select_all(action='DESELECT')
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.export_scene.fbx(filepath=str(legacy_file), use_selection=True, object_types={'MESH'},
                             use_mesh_modifiers=False, add_leaf_bones=False, bake_anim=False,
                             path_mode='COPY', embed_textures=True)


def reset_and_import(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.import_scene.fbx(filepath=str(file), automatic_bone_orientation=False)
    return [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.data.polygons]


def mesh_islands(mesh):
    parent = list(range(len(mesh.vertices)))

    def find(value):
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    def join(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[b] = a

    used = set()
    for face in mesh.polygons:
        vertices = list(face.vertices)
        used.update(vertices)
        for vertex in vertices[1:]:
            join(vertices[0], vertex)
    return len({find(vertex) for vertex in used})


def bounds(objects):
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    return [[min(point[axis] for point in points), max(point[axis] for point in points)] for axis in range(3)]


def face_signatures(objects):
    rows = []
    for obj in objects:
        uv_layers = sorted(layer.name for layer in obj.data.uv_layers)
        for face in obj.data.polygons:
            corners = []
            for loop_index in face.loop_indices:
                loop = obj.data.loops[loop_index]
                position = obj.matrix_world @ obj.data.vertices[loop.vertex_index].co
                uvs = [obj.data.uv_layers[name].data[loop_index].uv for name in uv_layers]
                # FBX stores transformed coordinates at a coarser precision than Blender's
                # in-memory values; compare to 1e-4 while retaining exact face/material mapping.
                corners.append(tuple(round(float(value), 4) for value in (*position, *(component for uv in uvs for component in uv))))
            rotations = [tuple(corners[index:] + corners[:index]) for index in range(len(corners))]
            material = None
            if face.material_index < len(obj.data.materials):
                slot = obj.data.materials[face.material_index]
                material = tuple(round(float(value), 5) for value in slot.diffuse_color[:3]) if slot else None
            rows.append((material, min(rotations)))
    return sorted(rows, key=repr)


def group_expectations(source_file, assignments):
    objects = reset_and_import(source_file)
    by_name = {obj.name: obj for obj in objects}
    expected = {}
    for group, names in assignments.items():
        selected = [by_name[name] for name in names]
        expected[group] = {
            'faces': face_signatures(selected),
            'bounds': bounds(selected),
            'materials': sorted(tuple(round(float(value), 5) for value in material.diffuse_color[:3]) for obj in selected for material in obj.data.materials if material),
            'uvLayers': sorted({layer.name for obj in selected for layer in obj.data.uv_layers}),
            'islands': sum(mesh_islands(obj.data) for obj in selected),
            'vertices': sum(len(obj.data.vertices) for obj in selected),
            'polygons': sum(len(obj.data.polygons) for obj in selected),
        }
    return expected


def assert_close(actual, expected, tolerance=1e-5):
    assert len(actual) == len(expected)
    for left, right in zip(actual, expected):
        if isinstance(left, list):
            assert_close(left, right, tolerance)
        else:
            assert abs(float(left) - float(right)) <= tolerance, (left, right)


def main(root):
    root.mkdir(parents=True, exist_ok=False)
    input_root = root / 'input'
    scratch = root / 'scratch'
    output_dir = root / 'outputs'
    for directory in (input_root, scratch, output_dir):
        directory.mkdir()
    source_file = input_root / 'multi-piece-prop-sheet.fbx'
    create_source(source_file)
    source_hash = digest(source_file)
    source_manifest = {'inputRoot': str(input_root), 'scratchRoot': str(scratch), 'sourceHash': source_hash, 'dependencies': []}
    expected = group_expectations(source_file, {
        '00000000-0000-4000-8000-000000000001': ['PartA1', 'PartA2'],
        '00000000-0000-4000-8000-000000000002': ['PartB1', 'PartB2'],
    })
    inventory = asset_surface.main({'mode': 'inventory', 'source': str(source_file), 'sourceHash': source_hash,
                                    'sourceManifest': source_manifest, 'outputDirectory': str(root / 'inventory'),
                                    'report': str(root / 'inventory-report.json')})
    components = inventory['components']
    assert len(components) == 4, f'Expected four separated pieces, got {len(components)}.'
    group_by_object = {
        'PartA1': '00000000-0000-4000-8000-000000000001',
        'PartA2': '00000000-0000-4000-8000-000000000001',
        'PartB1': '00000000-0000-4000-8000-000000000002',
        'PartB2': '00000000-0000-4000-8000-000000000002',
    }
    assignments = []
    for component in components:
        assignments.append({'componentId': component['componentId'], 'group': group_by_object[component['object']],
                            'faceIndices': component['faceIndices']})
    partition = asset_surface.main({'mode': 'partition', 'source': str(source_file), 'sourceHash': source_hash,
                                    'sourceManifest': source_manifest, 'outputDirectory': str(output_dir),
                                    'report': str(root / 'partition-report.json'), 'assignments': assignments})
    assert partition['ok'] is True
    fbx_outputs = [entry for entry in partition['outputs'] if entry['format'] == 'fbx']
    assert len(fbx_outputs) == 2, f'Props must stay in separate FBX files, got {len(fbx_outputs)}.'
    round_trip_inventory = []
    for entry in fbx_outputs:
        group = entry['group']
        expected_group = expected[group]
        assert entry.get('meshObjectCount') == 1, f"Asset prop {group} exports {entry.get('meshObjectCount')} mesh objects; one is required."
        imported = reset_and_import(entry['path'])
        assert len(imported) == 1, f"FBX round trip for prop {group} produced {len(imported)} mesh objects."
        obj = imported[0]
        assert mesh_islands(obj.data) == expected_group['islands'], 'Joining must retain disconnected geometry islands.'
        assert len(obj.data.vertices) == expected_group['vertices']
        assert len(obj.data.polygons) == expected_group['polygons']
        materials = sorted(tuple(round(float(value), 5) for value in material.diffuse_color[:3]) for material in obj.data.materials if material)
        assert materials == expected_group['materials'], (materials, expected_group['materials'])
        uv_layers = sorted(layer.name for layer in obj.data.uv_layers)
        assert uv_layers == expected_group['uvLayers'], (uv_layers, expected_group['uvLayers'])
        assert_close(bounds(imported), expected_group['bounds'])
        actual_faces = face_signatures(imported)
        if actual_faces != expected_group['faces']:
            expected_counts, actual_counts = Counter(map(repr, expected_group['faces'])), Counter(map(repr, actual_faces))
            missing = list((expected_counts - actual_counts).elements())[:2]
            extra = list((actual_counts - expected_counts).elements())[:2]
            raise AssertionError(f'FBX round trip changed world geometry, UVs or material boundaries for {group}; missing={missing}, extra={extra}')
        round_trip_inventory.append({'group': group, 'path': entry['path'], 'sha256': entry['hash'],
                                     'meshObjectCount': len(imported), 'vertexCount': len(obj.data.vertices),
                                     'polygonCount': len(obj.data.polygons), 'bounds': bounds(imported),
                                     'disconnectedIslandCount': mesh_islands(obj.data), 'uvLayers': uv_layers,
                                     'materialColors': materials})

    # Older accepted partitions can contain multiple FBX mesh objects. Prepare a
    # safe one-object texture handoff derivative without changing that source.
    legacy_root = root / 'legacy-normalization'
    legacy_inputs = legacy_root / 'input'
    legacy_scratch = legacy_root / 'scratch'
    legacy_outputs = legacy_root / 'outputs'
    for directory in (legacy_inputs, legacy_scratch, legacy_outputs):
        directory.mkdir(parents=True)
    legacy_file = legacy_inputs / 'previously-accepted-prop.fbx'
    legacy_b_file = legacy_inputs / 'previously-accepted-second-prop.fbx'
    create_legacy_multi_object_partition(source_file, legacy_file, ('PartA1', 'PartA2'))
    create_legacy_multi_object_partition(source_file, legacy_b_file, ('PartB1', 'PartB2'))
    legacy_hash = digest(legacy_file)
    legacy_manifest = {'inputRoot': str(legacy_inputs), 'scratchRoot': str(legacy_scratch),
                       'sourceHash': legacy_hash, 'dependencies': []}
    legacy_report = asset_surface.main({'mode': 'texture-export', 'source': str(legacy_file),
                                        'sourceHash': legacy_hash, 'sourceManifest': legacy_manifest,
                                        'outputDirectory': str(legacy_outputs),
                                        'report': str(legacy_root / 'report.json'),
                                        'group': '00000000-0000-4000-8000-000000000001'})
    legacy_fbx = next(row for row in legacy_report['outputs'] if row['format'] == 'fbx')
    assert legacy_fbx['sourceObjectCount'] == 2, legacy_fbx
    assert legacy_fbx['meshObjectCount'] == 1, legacy_fbx
    legacy_imported = reset_and_import(legacy_fbx['path'])
    assert len(legacy_imported) == 1, f'Legacy texture export round trip produced {len(legacy_imported)} mesh objects.'
    expected_legacy = expected['00000000-0000-4000-8000-000000000001']
    assert mesh_islands(legacy_imported[0].data) == expected_legacy['islands']
    assert len(legacy_imported[0].data.vertices) == expected_legacy['vertices']
    assert len(legacy_imported[0].data.polygons) == expected_legacy['polygons']
    assert sorted(tuple(round(float(value), 5) for value in material.diffuse_color[:3])
                  for material in legacy_imported[0].data.materials if material) == expected_legacy['materials']
    assert face_signatures(legacy_imported) == expected_legacy['faces']
    assert digest(legacy_file) == legacy_hash, 'Legacy texture export changed the accepted source fixture.'
    legacy_inventory = {'sourcePath': str(legacy_file), 'sourceHash': legacy_hash,
                        'sourceObjectCount': legacy_fbx['sourceObjectCount'], 'path': legacy_fbx['path'],
                        'sha256': legacy_fbx['hash'], 'meshObjectCount': len(legacy_imported),
                        'vertexCount': len(legacy_imported[0].data.vertices),
                        'polygonCount': len(legacy_imported[0].data.polygons),
                        'bounds': bounds(legacy_imported),
                        'disconnectedIslandCount': mesh_islands(legacy_imported[0].data),
                        'uvLayers': sorted(layer.name for layer in legacy_imported[0].data.uv_layers),
                        'materialColors': sorted(tuple(round(float(value), 5) for value in material.diffuse_color[:3])
                                                 for material in legacy_imported[0].data.materials if material)}
    assert digest(source_file) == source_hash, 'Partition changed the immutable source fixture.'
    verification = {'status': 'passed', 'blenderVersion': bpy.app.version_string,
                    'sourcePath': str(source_file), 'sourceHash': source_hash, 'sourceMeshObjectCount': 4,
                    'groupCount': len(fbx_outputs), 'distinctGroupsRemainSeparate': True,
                    'roundTripInventory': round_trip_inventory, 'roundTrip': True,
                    'legacyTextureExport': legacy_inventory,
                    'legacySecondPropMeshObjects': len(reset_and_import(legacy_b_file)),
                    'legacySourceHashUnchanged': True, 'sourceHashUnchanged': True,
                    'tripoAcceptance': 'not-tested'}
    (root / 'verification.json').write_text(json.dumps(verification, indent=2), encoding='utf8')
    print(json.dumps(verification, indent=2))


if __name__ == '__main__':
    try:
        args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
        parent = Path(args[0]).resolve() if args else Path(tempfile.gettempdir()) / 'asset-surface-join-test'
        main(parent)
    except Exception:
        traceback.print_exc()
        sys.exit(1)
