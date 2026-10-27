"""Format-specific checks for source-preserving Blender export evidence."""


def verify_glb_triangle_counts(source, reopened):
    expected = source['triangleCount']
    if reopened['polygonCount'] != expected or reopened['triangleCount'] != expected:
        raise ValueError('Reopened glTF triangle count differs from the exact source triangulation.')
