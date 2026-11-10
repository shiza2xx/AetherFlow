import array
import hashlib
import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

class PixelBuffer:
    def __init__(self, value):
        self.value = value
        self.calls = 0

    def foreach_get(self, target):
        self.calls += 1
        target[:] = array.array('f', [self.value]) * len(target)

class Image:
    def __init__(self, name, filepath, size, value, source='FILE'):
        self.name = name
        self.filepath = str(filepath)
        self.size = size
        self.source = source
        self.packed_file = None
        self.pixels = PixelBuffer(value)

    def pack(self):
        self.packed_file = object()

    def scale(self, width, height):
        self.size = (width, height)

class Socket:
    def __init__(self, name):
        self.name = name

class Node:
    def __init__(self, image):
        self.type = 'TEX_IMAGE'
        self.image = image

class Link:
    def __init__(self, image, socket):
        self.from_node = Node(image)
        self.to_socket = socket

class Material:
    def __init__(self, name, channel_images):
        self.name = name
        self.use_nodes = True
        self.shader = types.SimpleNamespace(type='BSDF_PRINCIPLED', inputs={name: Socket(name) for name in ('Base Color', 'Normal', 'Roughness', 'Metallic')})
        self.node_tree = types.SimpleNamespace(nodes=[self.shader], links=[])
        for channel, image in channel_images.items():
            self.node_tree.nodes.append(Node(image))
            self.node_tree.links.append(Link(image, self.shader.inputs[channel]))

class PreviewSupportProofTests(unittest.TestCase):
    def test_only_original_base_color_images_are_hashed_once_and_all_pbr_inputs_survive(self):
        with tempfile.TemporaryDirectory(prefix='asset-preview-proof-') as temp:
            root = Path(temp)
            source = root / 'model.fbx'
            source.write_bytes(b'fixture-source')
            images = {}
            dependencies = []
            for name, value in (('base', .125), ('normal', .25), ('roughness', .375), ('metallic', .5)):
                file = root / f'{name}.jpg'
                file.write_bytes(f'{name}-source-bytes'.encode('ascii'))
                image = Image(name, file, (2048, 2), value)
                images[name] = image
                dependencies.append({'logicalPath': file.name, 'stagedPath': file.name, 'hash': hashlib.sha256(file.read_bytes()).hexdigest()})
            material_a = Material('A material', {'Base Color': images['base'], 'Normal': images['normal'], 'Roughness': images['roughness'], 'Metallic': images['metallic']})
            material_b = Material('B material shares color', {'Base Color': images['base']})
            mesh = types.SimpleNamespace(name='Source mesh', type='MESH', data=types.SimpleNamespace(materials=[material_a, material_b], uv_layers=[]))
            source_objects = [mesh]
            proxy_image = Image('proxy base', root / 'proxy.png', (1024, 1), .625, source='GENERATED')
            proxy_material = Material('Proxy material', {'Base Color': proxy_image})
            proxy_mesh = types.SimpleNamespace(name='Proxy mesh', type='MESH', data=types.SimpleNamespace(materials=[proxy_material], uv_layers=[]))
            output = root / 'preview.glb'
            export_observations = []

            def referenced_images(objects):
                return sorted({node.image for obj in objects for mat in obj.data.materials for node in mat.node_tree.nodes if getattr(node, 'image', None)}, key=lambda image: image.name)

            def safe_import(path, config, scratch):
                self.assertEqual(Path(path), output)
                return [proxy_mesh], [proxy_mesh], []

            def export_scene_gltf(*, filepath, **kwargs):
                export_observations.append({
                    channel: next(link.from_node.image for link in material_a.node_tree.links if link.to_socket == material_a.shader.inputs[channel])
                    for channel in ('Base Color', 'Normal', 'Roughness', 'Metallic')
                })
                Path(filepath).write_bytes(b'checked-glb-proxy')

            bpy = types.ModuleType('bpy')
            bpy.path = types.SimpleNamespace(abspath=lambda value: value)
            bpy.ops = types.SimpleNamespace(
                export_scene=types.SimpleNamespace(gltf=export_scene_gltf),
                wm=types.SimpleNamespace(read_factory_settings=lambda **kwargs: None),
            )
            safe_import_module = types.ModuleType('asset_safe_import')
            safe_import_module.safe_import = safe_import
            safe_import_module.referenced_images = referenced_images
            safe_import_module.digest = lambda file: hashlib.sha256(Path(file).read_bytes()).hexdigest()
            prior_bpy = sys.modules.get('bpy')
            prior_import = sys.modules.get('asset_safe_import')
            sys.modules['bpy'] = bpy
            sys.modules['asset_safe_import'] = safe_import_module
            try:
                spec = importlib.util.spec_from_file_location('asset_preview_support_proof_test', SCRIPT_DIR / 'asset_preview_support.py')
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                source_file_hashes = {file: hashlib.sha256(file.read_bytes()).hexdigest() for file in [source, *(root / entry['logicalPath'] for entry in dependencies)]}
                expected_pixels = array.array('f', [images['base'].pixels.value]) * (2048 * 2 * 4)
                expected_base_proof = hashlib.sha256(memoryview(expected_pixels).cast('B')).hexdigest()
                result = module.build_preview(
                    source_objects,
                    [mesh],
                    {'inputRoot': str(root), 'dependencies': dependencies, 'sourceHash': hashlib.sha256(source.read_bytes()).hexdigest()},
                    source,
                    output,
                    root,
                )
            finally:
                if prior_bpy is None:
                    sys.modules.pop('bpy', None)
                else:
                    sys.modules['bpy'] = prior_bpy
                if prior_import is None:
                    sys.modules.pop('asset_safe_import', None)
                else:
                    sys.modules['asset_safe_import'] = prior_import

            source_materials = result['sourceAudit']['assetSourceMaterials']
            self.assertEqual(len(source_materials), 2)
            for material in source_materials:
                self.assertEqual(material['maps']['baseColor']['decodedPixelHash'], expected_base_proof)
                self.assertEqual((material['maps']['baseColor']['width'], material['maps']['baseColor']['height']), (2048, 2))
            expected_proxy_pixels = array.array('f', [proxy_image.pixels.value]) * (1024 * 1 * 4)
            expected_proxy_proof = hashlib.sha256(memoryview(expected_proxy_pixels).cast('B')).hexdigest()
            proxy_facts = result['sourceAudit']['assetProxyMaterials'][0]['maps']['baseColor']
            self.assertEqual(proxy_facts['decodedPixelHash'], expected_proxy_proof)
            self.assertEqual((proxy_facts['width'], proxy_facts['height']), (1024, 1))
            self.assertEqual(result['sourceAudit']['uv'], [{'object': 'Source mesh', 'layers': []}])
            self.assertEqual(images['base'].pixels.calls, 1, 'one shared base-color image must be decoded once for its proof')
            for channel in ('normal', 'roughness', 'metallic'):
                self.assertEqual(images[channel].pixels.calls, 0, f'{channel} must not compute an unused full-resolution pixel proof')
            self.assertEqual(len(export_observations), 1)
            self.assertIs(export_observations[0]['Base Color'], images['base'])
            for channel in ('Normal', 'Roughness', 'Metallic'):
                expected_image = images[channel.lower()]
                self.assertIs(export_observations[0][channel], expected_image)
                self.assertIs(next(link.from_node.image for link in material_a.node_tree.links if link.to_socket == material_a.shader.inputs[channel]), expected_image)
            self.assertEqual({item['name'] for item in result['textures']}, set(images))
            self.assertTrue(all(item['previewSize'] == [1024, 1] for item in result['textures']))
            self.assertEqual({file: hashlib.sha256(file.read_bytes()).hexdigest() for file in source_file_hashes}, source_file_hashes)

if __name__ == '__main__':
    unittest.main()
