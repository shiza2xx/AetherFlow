---
name: aetherflow-character-material-brushup
description: Inspect and locally improve PBR materials while preserving source maps and unrelated regions.
---

# Material brush-up

This adapted skill is self-contained. Do not apply character-specific color assumptions from other projects.

1. Fingerprint current mesh UVs, material assignments and channel bytes. Keep albedo (sRGB) distinct from normal, roughness and metallic data.
2. Define the selected surface mask from current UV/material membership. Never reuse sample atlas coordinates.
3. Work on a copy and emit a new candidate with parameters, input hashes and tool version. Preserve pixels outside the mask exactly; decode, blend and normalize tangent-space vectors for normal maps.
4. Run the managed PBR decoder/UV validator and request human review. Preserve separate shader behavior where materials differ.

An unproven UV match or absent channel validator blocks repair completion.
