"""Bounded-memory helpers for the trusted Blender texture extractor."""
import array
import hashlib


DECODE_HASH_CHUNK_VALUES = 1024 * 1024


def decoded_pixel_hash(pixels, chunk_values=DECODE_HASH_CHUNK_VALUES):
    """Hash Blender float pixels with the historical native float32 byte layout.

    The previous implementation held both a full float array and its full byte
    copy. Slices cap temporary storage while preserving the exact float32 bytes
    that `array('f').tobytes()` produced.
    """
    digest = hashlib.sha256()
    total = len(pixels)
    for start in range(0, total, chunk_values):
        values = array.array('f', pixels[start:min(start + chunk_values, total)])
        digest.update(memoryview(values).cast('B'))
        del values
    return digest.hexdigest()


def cached_image_target(targets, key, create):
    """Create one extraction target per Blender image, lazily."""
    target = targets.get(key)
    if target is None:
        target = create()
        targets[key] = target
    return target
