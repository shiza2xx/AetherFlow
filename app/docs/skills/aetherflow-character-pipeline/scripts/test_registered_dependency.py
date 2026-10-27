import hashlib
import os
import sys
import tempfile
import unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from registered_dependency import resolve_registered_dependency, registered_dependency_candidates


class RegisteredDependencyTests(unittest.TestCase):
    def test_stale_fbm_absolute_reference_resolves_only_to_registered_unique_basename(self):
        with tempfile.TemporaryDirectory() as root:
            staged = os.path.join(root, 'safe', 'front.png')
            os.makedirs(os.path.dirname(staged))
            with open(staged, 'wb') as stream:
                stream.write(b'registered-image')
            digest = hashlib.sha256(b'registered-image').hexdigest()
            mapping = [{'path': staged, 'sha256': digest, 'logicalPath': 'dependencies/front.png'}]
            self.assertEqual(resolve_registered_dependency(r'C:\old\model.fbm\front.png', root, mapping), staged)
            mapping.append({'path': staged, 'sha256': digest, 'logicalPath': 'other/front.png'})
            self.assertIsNone(resolve_registered_dependency(r'C:\old\model.fbm\front.png', root, mapping))
            self.assertEqual(len(registered_dependency_candidates(r'C:\old\model.fbm\front.png', mapping)), 2)

    def test_existing_stale_absolute_file_never_overrides_registered_staged_bytes(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            staged = os.path.join(root, 'registered', 'front.png')
            stale = os.path.join(outside, 'old', 'model.fbm', 'front.png')
            os.makedirs(os.path.dirname(staged))
            os.makedirs(os.path.dirname(stale))
            with open(staged, 'wb') as stream:
                stream.write(b'registered-pixels')
            with open(stale, 'wb') as stream:
                stream.write(b'different-external-pixels')
            digest = hashlib.sha256(b'registered-pixels').hexdigest()
            mapping = [{'path': staged, 'sha256': digest, 'logicalPath': 'TinyPbr.fbm/front.png'}]
            self.assertTrue(os.path.isfile(stale))
            resolved = resolve_registered_dependency(stale, root, mapping)
            self.assertEqual(resolved, staged)
            with open(resolved, 'rb') as stream:
                self.assertEqual(stream.read(), b'registered-pixels')

    def test_rejects_modified_or_escaped_registered_file(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            staged = os.path.join(root, 'front.png')
            with open(staged, 'wb') as stream:
                stream.write(b'actual')
            row = {'path': staged, 'sha256': hashlib.sha256(b'expected').hexdigest(), 'logicalPath': 'front.png'}
            self.assertIsNone(resolve_registered_dependency('/missing/front.png', root, [row]))
            row['path'] = os.path.join(outside, 'front.png')
            with open(row['path'], 'wb') as stream:
                stream.write(b'expected')
            row['sha256'] = hashlib.sha256(b'expected').hexdigest()
            self.assertIsNone(resolve_registered_dependency('/missing/front.png', root, [row]))


if __name__ == '__main__':
    unittest.main()
