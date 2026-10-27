# Persisted route

1 source; 2 color views with 2.5 AI depth maps; 3 human review; 4 manual mesh generation; 5 chosen returns + segmentation GLB; 6 manual Tripo segmentation; 7 segment return; 8 groups+guides; 9 painted texture references + manual UV/retexture; 10 returned surfaces+assembly+explicit head-to-body fit; 11 mesh-only derivative of the confirmed fitted model+baseline; 12 manual rig; 13 rig return/correspondence/material restore; 14 texture repair; 15 weights; 16 checked Unity-facing files.

The user performs Tripo work. Human Continue advances. Slot submission uses fresh revision/lease; a consumed lease cannot be reused. Only UI human accepts.
Correction requests record target, input hashes, protected properties, region and checks. Resume bound character session, read current persisted state, produce new candidate. Adopting changed inputs invalidates derived work without deleting its stored bytes.

Numerical audit, visual acceptance, saved-file integrity and Unity verification are separate. No old vertex IDs, weights, millimeters or feather counts become defaults. A local improvement is not a whole-character/engine pass.


## Recoverable review contract

Display the active candidate even when stale or rejected, with its revision and reason. Changed color hashes invalidate only dependent depth and downstream evidence; unrelated views remain adopted. A restored historical candidate is pending human review, not automatically accepted. Correction requests carry targetSlotId/candidateId/artifactId/hash, group/view, note and protected inputs. File/decode/QC/surface checks are separate from human adoption.

Manual handoffs must have inspected files and usable paths before departure. Texture bundles contain exactly group model plus accepted texture-reference front/back; no extra guides/depth. Step10 is returns → technical checks → human return adoption → assembly → mapping evidence → human assembly adoption → head/hair fitting as one group → saved candidate preservation check → front/side/back neck inspection → human placement confirmation. Existing incomplete production state remains incomplete after an app update.

The Stage10 fitting workspace must open the accepted assembly even before `fitted-assembly` has an artifact. Manual position/rotation/uniform scale controls are visible beside the model and update only the temporary preview. Save runs the trusted Blender fitting helper once to create a pending managed version. Inspect displays that saved version; confirmation is bound to its identity. Never rerun `assemble-returns` on an accepted textured assembly to obtain a fitting preview. Interactive fitting may limit decoded preview textures to1024px; immutable sources, saved files and export texture quality remain authoritative and unchanged.

Head placement is an explicit substep of Stage10, retaining existing stage keys and numbering. Texture assembly maps each group back to its baseline and can therefore preserve an originally overlapped head/body pair. Head-fit translation/rotation/uniform scale are applied to all head-source parts around the same head-centre pivot, never independently to hair. Body-source parts stay fixed; accessory source must come from the declared manifest. A no-change fit is allowed only as a checked saved candidate followed by human inspection, not an automatic pass. Only the exact confirmed fitted version feeds Stage11. Source replacement, a new fit candidate or correction requires a new confirmation. Geometry checks do not judge neck shape or weld seams; topology edits need a separate correction and baseline. Historical Stage11+ data is retained, but new rig-source jobs cannot use an unconfirmed overlapping assembly.

## Delivering files to the user

`guided_handoff_prepare` prepares every required head/body or texture-group folder and returns actual delivery directories. Prefer these ordinary folders for manual Tripo work. `guided_handoff_inspect` reports `path`/`directory` only for an existing delivery; `canonicalPath` is the internal immutable archive and must not be presented as the user's exported file location. `guided_handoff_export_directory` recreates the character-owned folder idempotently. Never send users to a bare content hash under objects. ZIPs remain internal recovery snapshots. The desktop UI offers Open folder and Open in CMD. A single imported head/body is automatically selected, and accepting a model selects that exact version; do not require a second Select action. Stage 6 requires manual segmentation of both GLBs in Tripo Studio with separate parts preserved, followed by separate head/body returns in stage 7.

## Stage 8 responsibility

Component inventory and grouping belong to Codex. Inspect the accepted segmented head/body and source color artwork, run guided_surface_run inventory, classify every component using actual geometry/source, then run prepare-groups with complete exactly-once assignments. The human receives a short group summary and reviews the result; never send them a thousand-row mapping task. Keep advanced manual controls as an optional inspection fallback.

## Stage 9: projection photographs before UV creation

Stage 9 produces mesh-matched front/back photographs for Tripo texturing. These are not UV atlases, baked textures or edits to an existing material map. A group without UVs is a valid input. Do not demand a UV layer, create UVs, modify topology or run texture-repair/PBR binding audits to generate or submit these images. Smart UV and texturing happen later in the user's manual Tripo handoff. UV requirements at material return/repair remain in force there.

Read the actual group front/back projection guides, accepted color views and original color artwork. Use the guides for image-space silhouette, component placement, scale and baseline; use color artwork for palette, pattern and painting style. Do not use depth maps as paint references. Make separate transparent front/back PNGs. Inspect contour differences in projection image coordinates, not UV coordinates. Correct substantive mismatches by regenerating from the mesh guide and original/accepted color references, never by repeatedly editing failed outputs.

Register every decodable requested draft with asset_register(parentId=characterId) and send it to the exact texture-reference group/view slot using guided_output_submit. An accepted slot requires guided_correction_submit with its original identity and a note. Read submission.selected, artifactId and the resulting slot: registration alone is not submission, and a history-only record is not the current preview. Known contour deviations must be disclosed as draft warnings; they do not justify hiding a technically readable candidate from human review. A failed decode or ownership check is a real technical blocker: report it instead of claiming submission. Keep candidates pending, never self-approve, and do not put unaccepted drafts in a Tripo handoff.

Submitting drafts is visibility, not completion. Continue resolving every requested image until it is ready or a genuine tool/provider/quota blocker prevents progress; no arbitrary retry count. Keep unresolved work resumable, preserve versions and state exactly which results are still drafts. Human acceptance remains required.

## Agent-defined groups

Read `agent-defined-groups.md` for component inspection, arbitrary named logical groups, complete assignments and trusted repartition recovery at stages 8–10. Group names/types are not a fixed accessory list. Keep one logical object per group, including its related components, and generate its own mesh guides and front/back paint references. Base exclusions on the actual selected mesh; never delete a present belt/detail from the image to conceal a grouping mistake.
