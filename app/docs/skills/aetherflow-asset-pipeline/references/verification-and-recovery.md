# Verification, versions, and recovery

## Before an operation

Read the current job/item/stage, selected candidate, accepted source version, and workspace. Verify registered dependencies exist and their hashes match. Reject cross-job, traversal, symlink escape, corrupt input, or ownership ambiguity with a precise diagnostic. Do not rewrite the original or silently import another workspace's data.

Check available memory and disk before a heavy operation. Use bounded workloads, texture proxies, cancellable work and actionable resource diagnostics; do not block harmless operations on an arbitrary global free-memory threshold. Run one Blender/test job at a time.

## Operation results and reviews

Record the actual operation, inputs, tool version, outputs, validation, and checkpoint. Process exit zero alone is insufficient. Read the structured report and verify its output files before registration.

Submit usable outputs as candidates even if quality needs review. Structural safety failures are distinct from visual-quality warnings. Human acceptance determines the current version. Never make acceptance writable through a generic MCP update payload.

After submission, verify the exact target slot and navigate to it. Report pending, accepted, rejected, or stale accurately. If navigation was not acknowledged, do not claim the UI opened. Keep older versions available for rollback.

## Editable source preparation

An accepted FBX, GLB, or OBJ return remains a valid production source. Do not ask the user to partition it merely to obtain a Blender file, or substitute an unrelated Blender scene. Use the application's checked editable-source preparation when a correction requires Blender.

Keep the original artifact, original hash, and registered dependencies authoritative. A normalized Blender baseline has its own hash and verified import report; it is an editable representation of those inputs, not permission to replace the accepted model silently. Create the correction from that baseline, preserve its checkpoint, and verify that neither the original nor the baseline changed before submitting the edited result. The corrected model is a pending new version until human review.

If a previously selected textured model becomes incompatible with accepted newer geometry, select the fresh geometry and explain which material needs compatibility review. Do not keep displaying the older full model as though it contained the accepted geometry correction.

## Dependency rules

Track source versions per item and operation, not one global dirty bit for the whole job. A correction to one prop must not revoke another prop's accepted images. Updating the master refreshes all linked instances; a unique instance owns its separate master/version lineage. Keep geometry, materials, placement, and derived assembly dependencies distinguishable.

If geometry changes, compare topology/UV/material compatibility before deciding which texture data needs review. Preserve accepted compatible data. Do not reaccept unrelated candidates behind the user's back, or force the user to approve an unchanged head/prop again merely because another group changed.

## Persistence and recovery

Persist selected item/stage/artifact, external-wait status, pending operation/candidates, and review state. On restart, reconstruct from records instead of repeating generation or overwriting outputs. Rebind a verified job session; resume it when available. A missing session must provide a clear new-session recovery action.

Backup/restore must include `work/assets/<jobId>` and its references, items, scenes, exports, and internal records, as well as registered artifact dependencies. Validate owner IDs and restored links. A game-project association is not a second conflicting storage owner.

Missing files: retain records, name the missing dependency, allow locate/reimport or regeneration. Corrupt results: preserve valid source/candidates, quarantine the failing operation result, and expose a retry. Repeated import: deduplicate by identity/hash where safe and do not duplicate accepted versions or masters. Cancelled/failed work must not appear completed.

## Required final checks

1. Every required master has a current accepted model and its required material dependencies, or is clearly waiting for manual work/review.
2. Segmentation is an exactly-once partition, including controlled face-level splits where necessary.
3. Shared sheets retain original item mappings; texturing uses individual originals.
4. All instance transforms and master-version links match the final scene.
5. Foliage alpha, reverse faces, atlas padding, UVs, and channel/picking behavior are checked.
6. Exports use current accepted versions and readable job-scoped folders.
7. Main stages and internal steps reflect actual state without losing pending candidates.
8. No user data, original input, unrelated accepted item, or existing character workflow has been destructively changed.
