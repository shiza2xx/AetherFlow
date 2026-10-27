import array
import hashlib
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from texture_source_memory import cached_image_target, decoded_pixel_hash


class BoundedPixels:
    def __init__(self, values):
        self.values = values
        self.max_slice = 0
    def __len__(self):
        return len(self.values)
    def __getitem__(self, key):
        if isinstance(key, slice):
            self.max_slice = max(self.max_slice, key.stop - key.start)
        return self.values[key]


class TextureSourceMemoryTests(unittest.TestCase):
    def test_chunked_pixel_hash_matches_legacy_float32_digest_and_bounds_slices(self):
        values = [0.0, 1.0, -0.5, 0.123456789, 0.75, 1.0 / 3.0, 65504.0] * 3
        pixels = BoundedPixels(values)
        legacy = hashlib.sha256(array.array('f', values).tobytes()).hexdigest()
        self.assertEqual(decoded_pixel_hash(pixels, chunk_values=8), legacy)
        self.assertLessEqual(pixels.max_slice, 8)

    def test_shared_image_cache_calls_expensive_factory_once(self):
        targets, calls = {}, []
        def make_target():
            calls.append('extract')
            return {'decodedPixelHash': decoded_pixel_hash([0.25, 0.5, 0.75], chunk_values=2)}
        first = cached_image_target(targets, 'image-pointer-1', make_target)
        second = cached_image_target(targets, 'image-pointer-1', make_target)
        self.assertIs(first, second)
        self.assertEqual(len(calls), 1)
        self.assertEqual(first['decodedPixelHash'], hashlib.sha256(array.array('f', [0.25, 0.5, 0.75]).tobytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
