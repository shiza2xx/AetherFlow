"""Resolve stale model texture references only to verified registered files."""
import hashlib
import os
import pathlib


def registered_dependency_candidates(reference, dependency_map):
    text = str(reference).replace('\\', '/')
    basename = pathlib.PurePosixPath(text.split('?', 1)[0]).name.lower()
    if not basename:
        return []
    normalized = text.lower().lstrip('/')
    rows = []
    for row in dependency_map or []:
        logical = str(row.get('logicalPath', '')).replace('\\', '/').lower().lstrip('/')
        candidate = str(row.get('path', ''))
        if not logical or not candidate:
            continue
        if logical == normalized or normalized.endswith('/' + logical):
            rows.append(row)
    if not rows:
        rows = [row for row in dependency_map or [] if pathlib.PurePosixPath(str(row.get('logicalPath', '')).replace('\\', '/')).name.lower() == basename]
    return rows


def resolve_registered_dependency(reference, dependency_root, dependency_map):
    """Return one uniquely matching staged file; never open the reference itself."""
    rows = registered_dependency_candidates(reference, dependency_map)
    if len(rows) != 1:
        return None
    row = rows[0]
    root = os.path.realpath(dependency_root)
    target = os.path.realpath(str(row['path']))
    if os.path.commonpath([root, target]) != root or not os.path.isfile(target):
        return None
    digest = str(row.get('sha256', ''))
    if len(digest) != 64 or any(char not in '0123456789abcdef' for char in digest.lower()):
        return None
    hasher = hashlib.sha256()
    with open(target, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    if hasher.hexdigest() != digest.lower():
        return None
    return target
