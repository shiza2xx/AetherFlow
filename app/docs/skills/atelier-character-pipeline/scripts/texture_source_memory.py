"""Bounded-memory texture proof hashing for managed Blender previews."""
import array
import hashlib


DECODE_HASH_CHUNK_VALUES = 1024 * 1024
MAX_PROOF_TEXTURE_DIMENSION = 8192
MAX_PROOF_TEXTURE_PIXELS = MAX_PROOF_TEXTURE_DIMENSION * MAX_PROOF_TEXTURE_DIMENSION


def validate_texture_dimensions(width, height, image_name='image'):
    if (not isinstance(width, int) or isinstance(width, bool) or
            not isinstance(height, int) or isinstance(height, bool) or
            width < 1 or height < 1 or
            width > MAX_PROOF_TEXTURE_DIMENSION or
            height > MAX_PROOF_TEXTURE_DIMENSION or
            width * height > MAX_PROOF_TEXTURE_PIXELS):
        raise ValueError('Texture proof dimensions exceed the reviewed 8192-edge / 67108864-pixel limit: ' + str(image_name))
    return width, height


def decoded_pixel_hash(pixels, width, height, image_name='image', chunk_values=DECODE_HASH_CHUNK_VALUES):
    """Hash Blender's native float32 pixel bytes without a full-image copy.

    Chunk boundaries do not change the byte stream produced by the historical
    ``array('f', pixels).tobytes()`` implementation.
    """
    validate_texture_dimensions(width, height, image_name)
    if not isinstance(chunk_values, int) or isinstance(chunk_values, bool) or chunk_values < 1:
        raise ValueError('Texture proof hash chunk size must be a positive integer.')
    expected = width * height * 4
    if len(pixels) != expected:
        raise ValueError('Texture proof pixel buffer length does not match its dimensions: ' + str(image_name))
    digest = hashlib.sha256()
    for start in range(0, expected, chunk_values):
        values = array.array('f', pixels[start:min(start + chunk_values, expected)])
        digest.update(memoryview(values).cast('B'))
        del values
    return digest.hexdigest()


def decoded_image_pixel_hash(image, image_name=None):
    """Hash an RNA image pixel collection using one bounded native float buffer.

    Blender's per-index RNA access is prohibitively slow for multi-million-pixel
    images. ``foreach_get`` fills one dimension-checked float32 buffer directly;
    the memoryview feeds hashlib without creating a second full-image bytes copy.
    Lightweight sequence fixtures still use the chunked fallback above.
    """
    name = str(image_name if image_name is not None else image.name)
    width, height = int(image.size[0]), int(image.size[1])
    validate_texture_dimensions(width, height, name)
    pixels = image.pixels
    expected = width * height * 4
    if len(pixels) != expected:
        raise ValueError('Texture proof pixel buffer length does not match its dimensions: ' + name)
    if not callable(getattr(pixels, 'foreach_get', None)):
        return decoded_pixel_hash(pixels, width, height, name)
    values = array.array('f', [0.0]) * expected
    pixels.foreach_get(values)
    digest = hashlib.sha256()
    digest.update(memoryview(values).cast('B'))
    result = digest.hexdigest()
    del values
    return result


def cached_image_pixel_hash(cache, image):
    """Hash one Blender image once across material channels in a conversion."""
    key = str(image.name)
    if key not in cache:
        cache[key] = decoded_image_pixel_hash(image, key)
    return cache[key]
