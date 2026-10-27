import importlib.util
import os
import struct
import tempfile
import unittest
import zlib

SCRIPT = os.path.join(os.path.dirname(__file__), 'composite_masked_patch.py')
spec = importlib.util.spec_from_file_location('composite_masked_patch', SCRIPT)
compositor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compositor)


def png(path, width, height, channels, color, pixels):
    compositor.write_png(path, width, height, channels, color, bytearray(pixels))


def paeth_png(path, width, height, channels, color, pixels):
    stride = width * channels
    raw = bytearray()
    previous = bytearray(stride)
    for y in range(height):
        row = bytearray(pixels[y * stride:(y + 1) * stride])
        filtered = bytearray(stride)
        for x, value in enumerate(row):
            a = row[x - channels] if x >= channels else 0
            b = previous[x]
            c = previous[x - channels] if x >= channels else 0
            filtered[x] = (value - compositor._paeth(a, b, c)) & 255
        raw.append(4)
        raw.extend(filtered)
        previous = row
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    header = struct.pack('>IIBBBBB', width, height, 8, color, 0, 0, 0)
    with open(path, 'wb') as stream:
        stream.write(compositor.PNG + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class CompositeMaskedPatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.source = os.path.join(self.root, 'source.png')
        self.mask = os.path.join(self.root, 'mask.png')
        self.candidate = os.path.join(self.root, 'candidate.png')
        self.output = os.path.join(self.root, 'output.png')
        self.report = os.path.join(self.root, 'report.json')

    def tearDown(self):
        self.temp.cleanup()

    def write_common(self, source_pixels, candidate_pixels, channels=3, color=2):
        w = h = 9
        png(self.source, w, h, channels, color, source_pixels)
        mask = bytearray(w * h)
        for y in range(2, 7):
            for x in range(2, 7):
                mask[y * w + x] = 255
        png(self.mask, w, h, 1, 0, mask)
        png(self.candidate, 3, 3, 3, 2, candidate_pixels)

    def config(self, channel='albedo', feather=2):
        return {'input': self.source, 'mask': self.mask, 'candidateTexture': self.candidate,
                'output': self.output, 'report': self.report, 'channel': channel,
                'featherRadius': feather}

    @staticmethod
    def binding(**overrides):
        row = {'meshName': 'Atelier_body', 'materialName': 'MaterialBody', 'materialSlot': 0,
               'uvSet': 'UVMap', 'uvIndex': 0, 'uvDigest': 'mesh-loop-uv-digest',
               'displayUvSignature': 'display-signature', 'uvMatrix': [1, 0, 0, 0, 1, 0, 0, 0, 1],
               'flipY': True, 'wrapS': 'repeat', 'wrapT': 'repeat',
               'imageArtifactId': 'managed-image-source', 'imageHash': 'a' * 64,
               'imageNodeName': 'Albedo Image', 'width': 9, 'height': 9}
        row.update(overrides)
        return row

    def test_spatial_albedo_feathers_inside_mask_and_preserves_outside(self):
        source = bytes([40, 80, 120] * 81)
        candidate = bytearray()
        for y in range(3):
            for x in range(3):
                candidate.extend((240 if x == 0 else 30, 20 if y == 0 else 220, 40 + x * 80))
        self.write_common(source, candidate)
        report = compositor.composite(self.config())
        before, after = compositor.read_png(self.source), compositor.read_png(self.output)
        self.assertTrue(report['protectedPixelsPreserved'])
        self.assertEqual(report['featherRadiusPixels'], 2)
        self.assertEqual(report['blendMethod'], 'linear-light-sRGB')
        self.assertGreater(report['candidateSpatialColorSamples'], 1)
        for y in range(9):
            for x in range(9):
                i = (y * 9 + x) * 3
                if not (2 <= x <= 6 and 2 <= y <= 6):
                    self.assertEqual(after['pixels'][i:i+3], before['pixels'][i:i+3])
        edge = (2 * 9 + 4) * 3
        core = (4 * 9 + 4) * 3
        self.assertNotEqual(after['pixels'][edge:edge+3], bytes((40,80,120)))
        self.assertNotEqual(after['pixels'][edge:edge+3], after['pixels'][core:core+3])

    def test_normal_patch_blends_vectors_and_keeps_protected_pixels(self):
        source = bytes([128, 128, 255] * 81)
        candidate = bytes([255, 128, 128] * 9)
        self.write_common(source, candidate)
        report = compositor.composite(self.config('normal', 2))
        before, after = compositor.read_png(self.source), compositor.read_png(self.output)
        self.assertTrue(report['protectedPixelsPreserved'])
        self.assertEqual(report['blendMethod'], 'tangent-space-vector-normalize')
        for pixel in range(81):
            i = pixel * 3
            if not (2 <= pixel % 9 <= 6 and 2 <= pixel // 9 <= 6):
                self.assertEqual(after['pixels'][i:i+3], before['pixels'][i:i+3])
        core = (4 * 9 + 4) * 3
        vector = [after['pixels'][core + i] / 127.5 - 1 for i in range(3)]
        self.assertAlmostEqual(sum(value * value for value in vector) ** .5, 1, delta=.015)

    def test_resampled_verified_mask_keeps_normal_vectors_unit_length_and_exterior_exact(self):
        png(self.source, 9, 9, 3, 2, bytes([128, 128, 255] * 81))
        small_mask = bytearray(25)
        for y in range(1, 4):
            for x in range(1, 4):
                small_mask[y * 5 + x] = 255
        png(self.mask, 5, 5, 1, 0, small_mask)
        png(self.candidate, 3, 3, 3, 2, bytes([230, 150, 160] * 9))
        config = self.config('normal', 1)
        config['sourceUvBinding'] = self.binding(
            imageArtifactId='normal-image', imageHash='b' * 64,
            imageNodeName='Normal Image', width=9, height=9)
        config['maskUvBinding'] = self.binding(
            imageArtifactId='albedo-image', imageHash='c' * 64,
            imageNodeName='Albedo Image', width=5, height=5)
        report = compositor.composite(config)
        before, after = compositor.read_png(self.source), compositor.read_png(self.output)
        self.assertTrue(report['maskResampledNearest'])
        self.assertEqual(report['blendMethod'], 'tangent-space-vector-normalize')
        for pixel in range(81):
            i = pixel * 3
            x, y = pixel % 9, pixel // 9
            mx, my = min(4, int((x + 0.5) * 5 / 9)), min(4, int((y + 0.5) * 5 / 9))
            if small_mask[my * 5 + mx] == 0:
                self.assertEqual(after['pixels'][i:i+3], before['pixels'][i:i+3])
            if before['pixels'][i:i+3] == after['pixels'][i:i+3]:
                continue
            vector = [after['pixels'][i + component] / 127.5 - 1 for component in range(3)]
            self.assertAlmostEqual(sum(value * value for value in vector) ** .5, 1, delta=.015)
        self.assertGreater(report['maskedPixels'], 0)

    def test_oversized_feather_and_channel_are_rejected(self):
        self.write_common(bytes([1, 2, 3] * 81), bytes([4, 5, 6] * 9))
        with self.assertRaisesRegex(ValueError, 'feather'):
            compositor.composite(self.config(feather=65))
        with self.assertRaisesRegex(ValueError, 'channel'):
            compositor.composite(self.config('depth'))

    def test_different_resolution_uses_nearest_uv_mask_only_with_matching_binding(self):
        source = bytes([40, 80, 120] * 81)
        candidate = bytes([240, 20, 40] * 9)
        self.write_common(source, candidate)
        low_mask = bytearray(5 * 5)
        for y in range(1, 4):
            for x in range(1, 4):
                low_mask[y * 5 + x] = 255
        os.remove(self.mask)
        png(self.mask, 5, 5, 1, 0, low_mask)
        config = self.config(feather=0)
        config['sourceUvBinding'] = self.binding(imageArtifactId='normal-image', imageHash='b' * 64,
                                                 imageNodeName='Normal Image', width=4, height=4)
        config['maskUvBinding'] = self.binding(imageArtifactId='albedo-image', imageHash='c' * 64,
                                               imageNodeName='Albedo Image', width=5, height=5)
        report = compositor.composite(config)
        self.assertTrue(report['maskResampledNearest'])
        self.assertEqual(report['maskSourceDimensions'], [5, 5])
        self.assertEqual(report['verifiedUvBindingPins']['source'][0]['imageHash'], 'b' * 64)
        self.assertEqual(report['verifiedUvBindingPins']['mask'][0]['imageHash'], 'c' * 64)
        before, after = compositor.read_png(self.source), compositor.read_png(self.output)
        self.assertEqual(after['pixels'][(0 * 9) * 3:(0 * 9 + 1) * 3], before['pixels'][:3])
        with self.assertRaisesRegex(ValueError, 'matching verified UV sampling semantics'):
            os.remove(self.output)
            os.remove(self.report)
            config['maskUvBinding'] = self.binding(uvSet='OtherUV', imageArtifactId='albedo-image', imageHash='c' * 64)
            compositor.composite(config)

    def test_extracted_mapping_must_match_transform_set_signature_and_wrap(self):
        self.write_common(bytes([40, 80, 120] * 81), bytes([240, 20, 40] * 9))
        low_mask = bytearray(5 * 5)
        low_mask[12] = 255
        os.remove(self.mask)
        png(self.mask, 5, 5, 1, 0, low_mask)
        config = self.config(feather=0)
        config['sourceUvBinding'] = self.binding(imageArtifactId='normal-image', imageHash='b' * 64)
        for change in ({'uvMatrix': [0, 1, 0, 1, 0, 0, 0, 0, 1]},
                       {'uvSet': 'OtherUV'}, {'uvDigest': 'different-uv'},
                       {'wrapS': 'clamp'}, {'flipY': False}):
            config['maskUvBinding'] = self.binding(imageArtifactId='albedo-image', imageHash='c' * 64, **change)
            with self.assertRaisesRegex(ValueError, 'matching verified UV sampling semantics'):
                compositor.composite(config)
            for path in (self.output, self.report):
                if os.path.exists(path):
                    os.remove(path)

    def test_filter_four_png_decodes_paeth_zero_distance_tie(self):
        expected = bytes([10, 0, 10, 0, 0, 10, 0, 10])
        paeth_png(self.source, 4, 2, 1, 0, expected)
        self.assertEqual(compositor.read_png(self.source)['pixels'], expected)

    def test_same_size_full_atlas_patch_preserves_pixel_correspondence(self):
        width = height = 4
        source = bytes(value for i in range(width * height) for value in (20 + i * 7, 50 + i * 3, 90 + i * 5))
        png(self.source, width, height, 3, 2, source)
        mask = bytearray(width * height)
        mask[5] = 255
        png(self.mask, width, height, 1, 0, mask)
        png(self.candidate, width, height, 3, 2, source)
        config = self.config(feather=0)
        config['candidateRect'] = [0, 0, 1, 1]
        report = compositor.composite(config)
        result = compositor.read_png(self.output)['pixels']
        self.assertEqual(result, source)
        self.assertTrue(report['protectedPixelsPreserved'])

    def test_mask_alpha_and_rgb_semantics_are_explicit(self):
        rgba = bytes([0, 0, 0, 0, 0, 0, 0, 128, 255, 255, 255, 128, 80, 120, 160, 128])
        png(self.mask, 4, 1, 4, 6, rgba)
        decoded = compositor.read_png(self.mask)
        gray_alpha = (80 * 299 + 120 * 587 + 160 * 114 + 500) // 1000
        self.assertEqual([compositor._mask_value(decoded, i) for i in range(4)], [0, 0, 128, (gray_alpha * 128 + 127) // 255])
        rgb = bytes([0, 0, 0, 255, 255, 255])
        os.remove(self.mask)
        png(self.mask, 2, 1, 3, 2, rgb)
        decoded = compositor.read_png(self.mask)
        self.assertEqual([compositor._mask_value(decoded, i) for i in range(2)], [0, 255])

    def test_candidate_must_cover_mask_and_be_color_image(self):
        self.write_common(bytes([1, 2, 3] * 81), bytes([4, 5, 6] * 9))
        config = self.config(feather=0)
        config['candidateRect'] = [0.25, 0.25, 0.25, 0.25]
        with self.assertRaisesRegex(ValueError, 'complete requested mask'):
            compositor.composite(config)
        config['candidateRect'] = ['left', 0, 1, 1]
        with self.assertRaisesRegex(ValueError, 'four numeric'):
            compositor.composite(config)
        os.remove(self.candidate)
        png(self.candidate, 3, 3, 1, 0, bytes([255] * 9))
        with self.assertRaisesRegex(ValueError, 'must be RGB or RGBA'):
            compositor.composite(self.config(feather=0))

    def test_inputs_cannot_be_replaced_and_decoding_is_dimension_bounded(self):
        self.write_common(bytes([1, 2, 3] * 81), bytes([4, 5, 6] * 9))
        with self.assertRaisesRegex(ValueError, 'separate paths'):
            config = self.config(feather=0)
            config['output'] = self.source
            compositor.composite(config)
        compositor.composite(self.config(feather=0))
        with self.assertRaisesRegex(ValueError, 'already exist'):
            compositor.composite(self.config(feather=0))
        bomb = os.path.join(self.root, 'bounded.png')
        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
        header = struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)
        with open(bomb, 'wb') as stream:
            stream.write(compositor.PNG + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(b'\x00' + b'x' * (1024 * 1024))) + chunk(b'IEND', b''))
        with self.assertRaisesRegex(ValueError, 'decoded byte count'):
            compositor.read_png(bomb)


if __name__ == '__main__':
    unittest.main()
