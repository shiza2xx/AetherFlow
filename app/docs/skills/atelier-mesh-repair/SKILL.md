---
name: atelier-mesh-repair
description: Diagnose local mesh defects, bridge intended boundaries and reconstruct missing volume on copied character models, with explicit remapping after topology changes.
---

# Local mesh repair

For wrong segmentation/group ownership at stages 7–10, first follow `references/segmentation-groups.md` (K0a whole-component transfer or K0b inspected existing-face split). This pre-rig route uses the accepted segmented source and its normal guided correction/review gate; do not start a generic workbench correction or give up because repartition alone only accepts whole components. Reopen and inspect group-colored partition overviews before paint. Geometry-preservation checks are not semantic classification.


Use for holes, wrong connections, missing volume, dents or neck seams that persist after display/material diagnosis. Prefer before UV/textures/rig; later work needs explicit dependent revalidation. Read common pipeline and `references/repair-methods.md`.

1. Pin source/hash, units/axes, neutral pose, artwork, targets, motions, protected boundaries and intended openings. Begin a checkpointed workbench correction; label inferred hidden geometry.
2. Compare plain, wireframe, orientation, sections and actual material views. `scripts/inspect_mesh_boundaries.py` reports observations, not hole classifications. Separate normal/display artifacts, dents, missing patches, disconnected loops, missing volume and pose-only failures.
3. Choose the smallest correct method: K1 display/normals; K2 curved patch; K3 ordered loop bridge; K4 local reconstruction. Do not fill every boundary, bulk-weld near vertices or remesh the whole character by default. Preserve cuffs, hems, slits, eye/mouth openings and thin cloth/hair edges.
4. Preserve healthy outer boundaries, fading coordinate edits to zero there. Plan curvature/thickness in several sections. A flat cap cannot replace missing volume. Match same-side/same-layer landmarks and loop order before bridging.
5. After vertex/face changes, create/transfer UVs, face materials, normals, colors/masks/AO, same-layer deform weights, every needed shape key and support binding. Old indices are invalid. Preserve existing keys or document a separate reconstruction/retirement plan.
6. Save/reopen, run the trusted `workbench_audit.py` object-level check, and compare protected data, allowed scope, sections, triangulated export and neutral/intermediate/maximum/return poses. Older surface proofs cannot certify changed geometry.
7. Report scope, attribute correspondence, matched before/after, saved/export checks and unresolved items. Boundary counts and a numerical audit do not prove anatomy, all-motion quality or Unity success. Human review adopts the version.

If two local attempts fail, revisit boundary/section/deformation structure. Roll back if correspondence crosses layers or necessary keys/bindings cannot be rebuilt. Head placement precedes neck bridging: Stage10 transform-only fitting does not weld topology.
