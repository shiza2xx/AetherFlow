"""Deterministically composite generated albedo/normal patches inside a verified UV mask.

The script intentionally depends only on the Python standard library so it can run
inside Blender's bundled Python or a normal Python interpreter. PNG support is
bounded to non-interlaced 8-bit RGB/RGBA source and candidate images plus a grayscale
or RGBA mask. The candidate is mapped to the mask's tight bounding box unless an
explicit normalized candidateRect is supplied.
"""
import hashlib
import json
import math
import os
import struct
import sys
import zlib

PNG = b"\x89PNG\r\n\x1a\n"
MAX_INPUT_BYTES = 128 * 1024 * 1024
MAX_PIXELS = 16_777_216


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else (b if pb <= pc else c)


def read_png(filename):
    if os.path.getsize(filename) > MAX_INPUT_BYTES:
        raise ValueError("PNG exceeds the 128 MiB encoded-input bound.")
    with open(filename, "rb") as stream:
        data = stream.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("PNG exceeds the 128 MiB encoded-input bound.")
    if not data.startswith(PNG):
        raise ValueError("Input is not a PNG image.")
    width = height = depth = color = interlace = None
    compressed = bytearray()
    offset = 8
    saw_header = False
    saw_end = False
    while offset + 12 <= len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        tag = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + length]
        if len(chunk) != length or offset + 12 + length > len(data):
            raise ValueError("PNG chunk is truncated.")
        expected_crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        if zlib.crc32(tag + chunk) & 0xffffffff != expected_crc:
            raise ValueError("PNG chunk checksum is invalid.")
        if tag == b"IHDR":
            if saw_header or offset != 8 or length != 13:
                raise ValueError("PNG header is malformed.")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunk)
            saw_header = True
            if compression or filtering or interlace:
                raise ValueError("Interlaced or nonstandard PNG encoding is unsupported.")
        elif tag == b"IDAT":
            compressed.extend(chunk)
        elif tag == b"IEND":
            if length != 0:
                raise ValueError("PNG end chunk is malformed.")
            offset += 12
            saw_end = True
            break
        elif tag == b"tRNS":
            raise ValueError("PNG transparency chunks are unsupported; provide an explicit alpha mask instead.")
        elif tag not in (b"PLTE", b"sRGB", b"gAMA", b"cHRM", b"iCCP", b"pHYs", b"tEXt", b"zTXt", b"iTXt", b"bKGD", b"sBIT") and not (tag[0] & 0x20):
            raise ValueError("PNG contains an unsupported critical chunk.")
        offset += 12 + length
    if not saw_header or not saw_end or offset != len(data) or not width or not height or depth != 8 or color not in (0, 2, 4, 6):
        raise ValueError("PNG must be non-interlaced 8-bit grayscale, RGB, grayscale-alpha or RGBA.")
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color]
    if width * height > MAX_PIXELS:
        raise ValueError("PNG exceeds the 16,777,216-pixel repair bound.")
    stride = width * channels
    expected = (stride + 1) * height
    decompressor = zlib.decompressobj()
    raw = decompressor.decompress(compressed, expected + 1)
    if len(raw) != expected or not decompressor.eof or decompressor.unused_data or decompressor.unconsumed_tail:
        raise ValueError("PNG decoded byte count does not match its dimensions.")
    pixels = bytearray(stride * height)
    previous = bytearray(stride)
    cursor = 0
    for y in range(height):
        filt = raw[cursor]
        cursor += 1
        row = bytearray(raw[cursor:cursor + stride])
        cursor += stride
        for x in range(stride):
            left = row[x - channels] if x >= channels else 0
            up = previous[x]
            upper_left = previous[x - channels] if x >= channels else 0
            if filt == 1:
                row[x] = (row[x] + left) & 255
            elif filt == 2:
                row[x] = (row[x] + up) & 255
            elif filt == 3:
                row[x] = (row[x] + ((left + up) >> 1)) & 255
            elif filt == 4:
                row[x] = (row[x] + _paeth(left, up, upper_left)) & 255
            elif filt != 0:
                raise ValueError("PNG uses an unsupported scanline filter.")
        start = y * stride
        pixels[start:start + stride] = row
        previous = row
    return {"path": filename, "width": width, "height": height, "channels": channels, "color": color, "pixels": pixels, "bytes": data}


def write_png(filename, width, height, channels, color, pixels):
    def chunk(kind, value):
        return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value) & 0xffffffff)
    stride = width * channels
    raw = b"".join(b"\x00" + pixels[y * stride:(y + 1) * stride] for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, color, 0, 0, 0)
    output = PNG + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    with open(filename, "xb") as stream:
        stream.write(output)
    return output


def _mask_value(mask, index):
    channels = mask["channels"]
    pixel = index * channels
    if mask["color"] == 4:
        gray, alpha = mask["pixels"][pixel:pixel + 2]
        return (gray * alpha + 127) // 255
    if mask["color"] == 6:
        red, green, blue, alpha = mask["pixels"][pixel:pixel + 4]
        luminance = (red * 299 + green * 587 + blue * 114 + 500) // 1000
        return (luminance * alpha + 127) // 255
    if mask["color"] == 2:
        red, green, blue = mask["pixels"][pixel:pixel + 3]
        return (red * 299 + green * 587 + blue * 114) // 1000
    return mask["pixels"][pixel]


def _linear(value):
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def _srgb(value):
    value = 12.92 * value if value <= 0.0031308 else 1.055 * (value ** (1.0 / 2.4)) - 0.055
    return max(0, min(255, int(round(value * 255.0))))


def _sample_rgb(image, u, v):
    width, height, channels, pixels = image["width"], image["height"], image["channels"], image["pixels"]
    # Normalized image coordinates refer to pixel edges, so pixel centers map
    # with `u * width - .5`; this makes same-size/full-atlas patches identity.
    x, y = max(0.0, min(width - 1.0, u * width - 0.5)), max(0.0, min(height - 1.0, v * height - 0.5))
    x0, y0 = int(x), int(y)
    x1, y1 = min(width - 1, x0 + 1), min(height - 1, y0 + 1)
    fx, fy = x - x0, y - y0
    def value(px, py, channel):
        return pixels[(py * width + px) * channels + channel]
    result = []
    for channel in range(3):
        c0 = value(x0, y0, channel)
        c1 = value(x1, y0, channel)
        c2 = value(x0, y1, channel)
        c3 = value(x1, y1, channel)
        result.append((c0 * (1 - fx) + c1 * fx) * (1 - fy) + (c2 * (1 - fx) + c3 * fx) * fy)
    if channels not in (2, 4):
        alpha = 1.0
    else:
        alpha = value(x0, y0, channels - 1) / 255.0
    return result, alpha


def _normal(vector):
    decoded = [value / 127.5 - 1.0 for value in vector]
    length = math.sqrt(sum(value * value for value in decoded))
    if length < 1e-8:
        raise ValueError("Normal patch contains an invalid zero-length vector.")
    return [value / length for value in decoded]


def _sample_normal(image, u, v):
    width, height, channels, pixels = image["width"], image["height"], image["channels"], image["pixels"]
    x, y = max(0.0, min(width - 1.0, u * width - 0.5)), max(0.0, min(height - 1.0, v * height - 0.5))
    x0, y0 = int(x), int(y)
    x1, y1 = min(width - 1, x0 + 1), min(height - 1, y0 + 1)
    fx, fy = x - x0, y - y0
    def vector(px, py):
        at = (py * width + px) * channels
        return _normal(pixels[at:at + 3])
    vectors = [vector(x0, y0), vector(x1, y0), vector(x0, y1), vector(x1, y1)]
    blended = [((vectors[0][i] * (1 - fx) + vectors[1][i] * fx) * (1 - fy) +
                (vectors[2][i] * (1 - fx) + vectors[3][i] * fx) * fy) for i in range(3)]
    alpha = 1.0 if channels not in (2, 4) else pixels[(y0 * width + x0) * channels + channels - 1] / 255.0
    return _normal(_encoded_normal(blended)), alpha


def _encoded_normal(vector):
    length = math.sqrt(sum(value * value for value in vector))
    if length < 1e-8:
        raise ValueError("Blended normal became an invalid zero-length vector.")
    return [max(0, min(255, int(round((value / length * 0.5 + 0.5) * 255)))) for value in vector]


_UV_MAPPING_FIELDS = (
    "meshName", "materialName", "materialSlot", "uvSet", "uvIndex",
    "uvDigest", "displayUvSignature", "uvMatrix", "flipY", "wrapS", "wrapT",
)


def _verified_uv_projection(value):
    """Compare sample mapping while preserving the distinct image identity pins."""
    if isinstance(value, dict):
        rows = [value]
    elif isinstance(value, (list, tuple)) and value:
        rows = list(value)
    else:
        raise ValueError("Differently sized masks require complete verified UV-binding records.")
    projected = []
    for row in rows:
        if not isinstance(row, dict) or any(key not in row for key in _UV_MAPPING_FIELDS):
            raise ValueError("UV-binding records are missing canonical mesh/material or projection fields.")
        if (not isinstance(row["meshName"], str) or not row["meshName"] or
                not isinstance(row["materialName"], str) or not row["materialName"] or
                isinstance(row["materialSlot"], bool) or not isinstance(row["materialSlot"], int) or row["materialSlot"] < 0 or
                not isinstance(row["uvSet"], str) or not row["uvSet"] or
                isinstance(row["uvIndex"], bool) or not isinstance(row["uvIndex"], int) or row["uvIndex"] < 0 or
                not isinstance(row["uvDigest"], str) or not row["uvDigest"] or
                not isinstance(row["displayUvSignature"], str) or not row["displayUvSignature"] or
                not isinstance(row["uvMatrix"], (list, tuple)) or len(row["uvMatrix"]) != 9 or
                any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in row["uvMatrix"]) or
                not isinstance(row["flipY"], bool) or row["wrapS"] not in ("repeat", "clamp", "mirror") or
                row["wrapT"] not in ("repeat", "clamp", "mirror")):
            raise ValueError("UV-binding record contains invalid canonical mapping values.")
        for pin in ("imageHash", "imageArtifactId"):
            if not isinstance(row.get(pin), str) or not row[pin]:
                raise ValueError("Each UV binding must retain its distinct managed image identity pin.")
        projected.append({key: list(row[key]) if key == "uvMatrix" else row[key] for key in _UV_MAPPING_FIELDS})
    return sorted(projected, key=lambda row: json.dumps(row, sort_keys=True, separators=(",", ":")))


def composite(config):
    paths = [os.path.abspath(os.fspath(config[key])) for key in ("input", "mask", "candidateTexture", "output", "report")]
    if len({os.path.normcase(path) for path in paths}) != len(paths):
        raise ValueError("Inputs, output and report must use separate paths.")
    if os.path.exists(paths[3]) or os.path.exists(paths[4]):
        raise ValueError("Output and report paths must not already exist.")
    source, mask, candidate = (read_png(config[key]) for key in ("input", "mask", "candidateTexture"))
    width, height = source["width"], source["height"]
    channel = config.get("channel", "albedo")
    if channel not in ("albedo", "normal"):
        raise ValueError("Patch channel must be albedo or normal.")
    if source["color"] not in (2, 6):
        raise ValueError("Albedo source must be RGB or RGBA.")
    if candidate["color"] not in (2, 6):
        raise ValueError("Generated patch must be RGB or RGBA, not grayscale.")
    mask_width, mask_height = mask["width"], mask["height"]
    mask_resampled = (mask_width, mask_height) != (width, height)
    binding_pins = None
    if mask_resampled:
        source_binding = config.get("sourceUvBinding")
        mask_binding = config.get("maskUvBinding")
        source_projection = _verified_uv_projection(source_binding)
        mask_projection = _verified_uv_projection(mask_binding)
        if source_projection != mask_projection:
            raise ValueError("A differently sized mask requires matching verified UV sampling semantics.")
        source_rows = source_binding if isinstance(source_binding, (list, tuple)) else [source_binding]
        mask_rows = mask_binding if isinstance(mask_binding, (list, tuple)) else [mask_binding]
        binding_pins = {
            "source": [{"imageArtifactId": row["imageArtifactId"], "imageHash": row["imageHash"]} for row in source_rows],
            "mask": [{"imageArtifactId": row["imageArtifactId"], "imageHash": row["imageHash"]} for row in mask_rows],
            "mappingFields": list(_UV_MAPPING_FIELDS),
        }
    feather = int(config.get("featherRadius", 8))
    if feather < 0 or feather > 64:
        raise ValueError("Inner feather radius must be between 0 and 64 pixels.")
    mask_values = bytearray(width * height)
    min_x, min_y, max_x, max_y = width, height, -1, -1
    for y in range(height):
        row = y * width
        for x in range(width):
            index = row + x
            if mask_resampled:
                mx = min(mask_width - 1, int((x + 0.5) * mask_width / width))
                my = min(mask_height - 1, int((y + 0.5) * mask_height / height))
                mask_index = my * mask_width + mx
            else:
                mask_index = index
            value = _mask_value(mask, mask_index)
            mask_values[index] = value
            if value:
                min_x, min_y, max_x, max_y = min(min_x, x), min(min_y, y), max(max_x, x), max(max_y, y)
    if max_x < min_x or max_y < min_y:
        raise ValueError("The user mask contains no requested pixels.")
    rect = config.get("candidateRect") or [min_x / width, min_y / height, (max_x - min_x + 1) / width, (max_y - min_y + 1) / height]
    if not isinstance(rect, (list, tuple)) or len(rect) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in rect):
        raise ValueError("Candidate UV alignment rectangle must contain four numeric values.")
    rect = [float(value) for value in rect]
    if any(not math.isfinite(value) for value in rect) or rect[2] <= 0 or rect[3] <= 0 or rect[0] < 0 or rect[1] < 0 or rect[0] + rect[2] > 1 or rect[1] + rect[3] > 1:
        raise ValueError("Candidate UV alignment rectangle is invalid.")
    rect_px = (rect[0] * width, rect[1] * height, rect[2] * width, rect[3] * height)
    left, top, rect_width, rect_height = rect_px
    if (min_x + 0.5 < left or min_y + 0.5 < top or
            max_x + 0.5 > left + rect_width or max_y + 0.5 > top + rect_height):
        raise ValueError("Candidate UV rectangle must cover the complete requested mask; edge stretching is not allowed.")
    # Bounded Manhattan distance transform. Distances are clamped to the feather width.
    limit = max(1, feather)
    distances = bytearray(width * height)
    for index, value in enumerate(mask_values):
        distances[index] = limit if value else 0
    if feather:
        for y in range(height):
            row = y * width
            for x in range(width):
                index = row + x
                if not mask_values[index]:
                    continue
                best = distances[index]
                if x: best = min(best, distances[index - 1] + 1)
                if y: best = min(best, distances[index - width] + 1)
                distances[index] = min(limit, best)
        for y in range(height - 1, -1, -1):
            row = y * width
            for x in range(width - 1, -1, -1):
                index = row + x
                if not mask_values[index]:
                    continue
                best = distances[index]
                if x + 1 < width: best = min(best, distances[index + 1] + 1)
                if y + 1 < height: best = min(best, distances[index + width] + 1)
                distances[index] = min(limit, best)
    output = bytearray(source["pixels"])
    stride, channels = width * source["channels"], source["channels"]
    changed = 0
    pattern_samples = set()
    for y in range(height):
        for x in range(width):
            index = y * width + x
            coverage = mask_values[index] / 255.0
            if coverage <= 0:
                continue
            if rect_width <= 1 or rect_height <= 1:
                continue
            u = max(0.0, min(1.0, (x + 0.5 - left) / rect_width))
            v = max(0.0, min(1.0, (y + 0.5 - top) / rect_height))
            if channel == "normal":
                patch_normal, candidate_alpha = _sample_normal(candidate, u, v)
                patch = _encoded_normal(patch_normal)
            else:
                patch, candidate_alpha = _sample_rgb(candidate, u, v)
            pattern_samples.add(tuple(int(round(value)) for value in patch))
            blend = coverage * candidate_alpha * (1.0 if not feather else min(1.0, distances[index] / float(limit)))
            if blend <= 0:
                continue
            at = index * channels
            if channel == "albedo":
                for component in range(3):
                    output[at + component] = _srgb(_linear(source["pixels"][at + component]) * (1 - blend) + _linear(patch[component]) * blend)
            else:
                original_normal = _normal(source["pixels"][at:at + 3])
                output[at:at + 3] = bytes(_encoded_normal([original_normal[i] * (1 - blend) + patch_normal[i] * blend for i in range(3)]))
            changed += 1
    if not changed:
        raise ValueError("Mask and candidate rectangle do not overlap a repairable region.")
    out_path = config["output"]
    encoded = write_png(out_path, width, height, channels, source["color"], output)
    check = read_png(out_path)
    protected = 0
    for index, value in enumerate(mask_values):
        if value == 0:
            start = index * channels
            if check["pixels"][start:start + channels] != source["pixels"][start:start + channels]:
                raise ValueError("Decoded source pixels outside the user mask changed.")
            protected += 1
    report = {
        "schemaVersion": 1,
        "operation": "generated-spatial-mask-composite",
        "channel": channel,
        "inputSHA256": hashlib.sha256(source["bytes"]).hexdigest(),
        "maskSHA256": hashlib.sha256(mask["bytes"]).hexdigest(),
        "candidateTextureSHA256": hashlib.sha256(candidate["bytes"]).hexdigest(),
        "outputSHA256": hashlib.sha256(encoded).hexdigest(),
        "width": width,
        "height": height,
        "maskSourceDimensions": [mask_width, mask_height],
        "maskResampledNearest": mask_resampled,
        "verifiedUvBindingPins": binding_pins,
        "maskBounds": [min_x, min_y, max_x - min_x + 1, max_y - min_y + 1],
        "candidateRect": list(rect),
        "maskedPixels": changed,
        "protectedPixels": protected,
        "protectedPixelsPreserved": True,
        "blendMethod": "linear-light-sRGB" if channel == "albedo" else "tangent-space-vector-normalize",
        "featherMethod": "bounded-inner-Manhattan-distance",
        "featherRadiusPixels": feather,
        "candidateSpatialColorSamples": len(pattern_samples),
        "geometryChanged": False,
        "uvChanged": False,
    }
    with open(config["report"], "x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    return report


def main():
    config = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    print(json.dumps(composite(config), separators=(",", ":")))


if __name__ == "__main__":
    main()
