---
name: atelier-character-weight-transfer
description: Repair only an explicitly selected weight region with topology and skeleton preservation checks.
---

# Bounded weight transfer

Donor transfer is optional and never the default. Follow this skill's bounded checks when the user explicitly requests it.

1. Capture a managed checkpoint and exact topology, group, rest-matrix and action fingerprints.
2. Prefer explicit per-vertex group edits for a named region. The local repair script requires the expected topology fingerprint as well as the vertex count.
3. Any barycentric transfer must declare source/target mesh, connected/anatomical region, maximum distance, group allowlist and affected vertices. Reject disconnected or out-of-region results; do not transfer across the whole body by default.
4. Run the independent weights validator against the accepted upstream rig. Preserve all unaffected weights and actions, normalize edited vertices, and apply an influence cap only when explicitly chosen.

Request human review of the new immutable candidate. Never change rest pose or replace the source skeleton implicitly.
