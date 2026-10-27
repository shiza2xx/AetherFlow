---
name: aetherflow-tripo-handoff
description: Prepare and verify manual Tripo website handoffs without automating the website or changing source rig data by default.
---

# Manual Tripo handoff

All Tripo website steps are user-performed in AetherFlow. This skill contains the complete handoff contract.

1. Checkpoint and fingerprint the authoritative source, including geometry, UVs, materials, skeleton, weights, rest pose and actions.
2. Prepare a disposable mesh-only copy only when the saved request explicitly requires it. Keep the full source and dependency closure untouched.
3. The user uploads/downloads through the website. Import the returned model and sidecars into managed storage; never automate login, browser interaction or service APIs.
4. Run topology/material/rig checks against the authoritative upstream baseline. Matching counts alone do not establish correspondence. A topology mismatch requires a new baseline and blocks restoring index-bound data.

Preserve the returned model's valid weights and rig by default. All changes are reviewed by a human.

## Exact upload sets

Before handoff, inspect the persisted selected candidates and actual files. Mesh generation uses the prepared head/body depth sets. Segmentation uses the final adopted head/body meshes converted in an empty scene and verified by reopening the exported GLB. Texture upload uses one specific group model plus exactly two adopted painted texture-reference images, front and back. Never include guides/depth or substitute general reference-body images. Offer an inspected folder export, clear file paths and return slots; keep immutable source and dependency manifests.

At return, inspect every assigned channel and decoded image size. A missing Normal/Roughness/Metallic map is a material diagnostic, not an excuse to label a BaseColor-only archive full PBR. Resolve registered FBX/FBM sidecars in isolated staging and produce a truly self-contained preview without altering original files. Adopt each group before the assembly operation; keep technical checks separate from human visual acceptance.
