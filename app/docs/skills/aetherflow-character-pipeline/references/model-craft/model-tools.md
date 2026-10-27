# Mesh observation helper

`mesh_quality_tools.py` provides `audit`, `snapshot`, `compare`, and `normalize-copy` for explicitly named meshes. Audit reports base topology, UV, relative-key, and optional deform-weight observations. Snapshots hash the named fields; comparison checks those fields exactly. Normalization creates disposable candidate objects and does not save the source automatically.

Run Blender in background/factory mode with auto-execution disabled and one thread. Reports include indices and unverified properties. Boundary edges, repeated UVs, and empty keys can be intentional. Numeric output does not grade appearance. The helper does not establish evaluated shape, rest/pose matrices, constraints, materials/images, animation, export, or engine behavior; use the workflow’s independent checks for those claims.
