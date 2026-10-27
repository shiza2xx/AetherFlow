import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_validation import verify_glb_triangle_counts


class ReopenedExportValidationTests(unittest.TestCase):
    def test_accepts_exact_source_polygon_triangulation(self):
        source = {'triangleCount': 18}
        reopened = {'polygonCount': 18, 'triangleCount': 18}
        self.assertIsNone(verify_glb_triangle_counts(source, reopened))

    def test_rejects_extra_and_missing_reopened_faces(self):
        source = {'triangleCount': 18}
        with self.assertRaisesRegex(ValueError, 'exact source triangulation'):
            verify_glb_triangle_counts(source, {'polygonCount': 19, 'triangleCount': 19})
        with self.assertRaisesRegex(ValueError, 'exact source triangulation'):
            verify_glb_triangle_counts(source, {'polygonCount': 18, 'triangleCount': 19})
        with self.assertRaisesRegex(ValueError, 'exact source triangulation'):
            verify_glb_triangle_counts(source, {'polygonCount': 17, 'triangleCount': 17})


if __name__ == '__main__':
    unittest.main()
