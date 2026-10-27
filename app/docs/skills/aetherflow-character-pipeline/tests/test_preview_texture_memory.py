import array
import hashlib
import pathlib
import sys
import unittest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from texture_source_memory import cached_image_pixel_hash, decoded_pixel_hash, decoded_image_pixel_hash, validate_texture_dimensions


class SliceTrackingPixels:
    def __init__(self, values):
        self.values = array.array('f', values)
        self.slice_sizes = []

    def __len__(self):
        return len(self.values)

    def __getitem__(self, key):
        result = self.values[key]
        if isinstance(key, slice):
            self.slice_sizes.append(len(result))
        return result


class ImageFixture:
    def __init__(self, name, width, height, pixels):
        self.name = name
        self.size = (width, height)
        self.pixels = pixels


class ForeachPixelsFixture:
    def __init__(self, values):
        self.values = array.array('f', values)
        self.calls = 0
        self.buffer_length = 0

    def __len__(self):
        return len(self.values)

    def foreach_get(self, destination):
        self.calls += 1
        self.buffer_length = len(destination)
        destination[:] = self.values


class PreviewTextureMemoryTests(unittest.TestCase):
    def test_chunked_hash_matches_historical_float32_digest_at_chunk_edges(self):
        values = [0.25, -1.0, 3.1415927, 1e-20] * 17
        pixels = SliceTrackingPixels(values)
        legacy = hashlib.sha256(array.array('f', pixels.values).tobytes()).hexdigest()
        for chunk_size in (1, 7, 64, 65, 1024):
            self.assertEqual(decoded_pixel_hash(pixels, 1, 17, 'tiny', chunk_size), legacy)

    def test_preview_proof_accepts_eight_k_resolution_metadata_and_streams_large_buffers(self):
        self.assertEqual(validate_texture_dimensions(8192, 8192, 'edge'), (8192, 8192))
        self.assertEqual(validate_texture_dimensions(4352, 4352, 'clothing-atlas'), (4352, 4352))
        values = array.array('f', [0.125, 0.25, 0.5, 1.0]) * (2 * 1024 * 1024)
        pixels = SliceTrackingPixels(values)
        digest = decoded_pixel_hash(pixels, 1024, 2048, 'bounded', 1024 * 1024)
        self.assertEqual(len(digest), 64)
        self.assertEqual(max(pixels.slice_sizes), 1024 * 1024)
        with self.assertRaisesRegex(ValueError, '8192-edge / 67108864-pixel'):
            validate_texture_dimensions(8193, 1, 'too-large')
        with self.assertRaisesRegex(ValueError, 'pixel buffer length'):
            decoded_pixel_hash(pixels, 1, 1, 'mismatched')

    def test_shared_material_image_pixel_hash_is_computed_once(self):
        pixels = SliceTrackingPixels([0.25, 0.5, 0.75, 1.0] * 4)
        image = ImageFixture('Shared material image', 2, 2, pixels)
        cache = {}
        first = cached_image_pixel_hash(cache, image)
        second = cached_image_pixel_hash(cache, image)
        self.assertEqual(first, second)
        self.assertEqual(first, hashlib.sha256(array.array('f', pixels.values).tobytes()).hexdigest())
        self.assertEqual(len(pixels.slice_sizes), 1)

    def test_blender_foreach_get_hash_matches_historical_digest_without_image_copy(self):
        values = [0.25, -1.0, 3.1415927, 1e-20] * 17
        pixels = ForeachPixelsFixture(values)
        image = ImageFixture('RNA image', 1, 17, pixels)
        legacy = hashlib.sha256(array.array('f', values).tobytes()).hexdigest()
        self.assertEqual(decoded_image_pixel_hash(image), legacy)
        self.assertEqual(pixels.calls, 1)
        self.assertEqual(pixels.buffer_length, len(values))


if __name__ == '__main__':
    unittest.main()
