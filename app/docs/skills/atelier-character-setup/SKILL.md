---
name: atelier-character-setup
description: Inspect and integrate manually returned Tripo character models while preserving the source skeleton, weights, rest pose, and actions.
---

# AetherFlow character setup

Use after a user manually downloads a Tripo result or requests an audit of a returned character rig. This is the active AetherFlow workflow for that task.

## Ordered workflow

1. Work on an Atelier-managed copy. Record source hash, dependency closure, Blender version, object/armature names, rest matrices, vertex groups, actions and material assignments before inspection.
2. Keep Tripo website actions manual. Do not automate its UI, use a browser agent, call its API, or claim a downloaded model that the user has not imported.
3. Compare the returned mesh and rig to the registered source. Preserve the returned skeleton, weights, rest pose and actions by default. Do not change rest pose, replace the armature, or use whole-body donor weights.
4. If repair is explicitly requested, scope it to named objects/regions and record correspondence plus immutable checkpoint before any edit. Work in a disposable copy and produce a new candidate.
5. Run `scripts/audit_returned_rig.py` through AetherFlow's trusted Blender runner with `--disable-autoexec`. Treat missing or ambiguous references as failed checks. Save the report, but never let agent-provided report data mark a human gate accepted.
6. Export a verified derivative with settings and lineage. Set glTF `export_all_influences=True`; retain the managed source bytes and report preview limits above eight influences.

## Completion and failure gates

Require source hash integrity, bounded dependency paths, topology/UV/material correspondence where restoration is requested, skeleton/rest/action audit, and weight invariants. Stop before index-based restoration if correspondence is unproven. Human review is required for every candidate. An absent validator remains blocked.

## Reference policy

User art style, silhouette, asymmetry and material identity remain authoritative. `references/RETURNED-RIG.md` documents the return and preservation contract.
