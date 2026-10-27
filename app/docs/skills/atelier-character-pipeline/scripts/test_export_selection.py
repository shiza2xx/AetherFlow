import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_selection import exportable_objects


class ExportSelectionTests(unittest.TestCase):
    def test_empty_scene_import_keeps_legitimate_source_meshes_with_startup_names(self):
        imported = [
            SimpleNamespace(name='Cube', type='MESH'),
            SimpleNamespace(name='Camera', type='MESH'),
            SimpleNamespace(name='Light', type='MESH'),
            SimpleNamespace(name='Rig', type='ARMATURE'),
            SimpleNamespace(name='Camera', type='CAMERA'),
        ]
        self.assertEqual(
            [(item.name, item.type) for item in exportable_objects(imported, exclude_startup=False)],
            [('Cube', 'MESH'), ('Camera', 'MESH'), ('Light', 'MESH'), ('Rig', 'ARMATURE')],
        )

    def test_blend_startup_name_filter_remains_available(self):
        imported = [
            SimpleNamespace(name='Cube', type='MESH'),
            SimpleNamespace(name='CharacterBody', type='MESH'),
        ]
        self.assertEqual([item.name for item in exportable_objects(imported, exclude_startup=True)], ['CharacterBody'])


if __name__ == '__main__':
    unittest.main()
