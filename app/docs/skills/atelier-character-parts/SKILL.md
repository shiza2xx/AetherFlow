---
name: atelier-character-parts
description: Prepare painted head-with-hair/body views, reviewed segmentation and mesh-matched texture-reference images.
---

# Character image references

Use for color views, image review, segmentation handoff and texture-reference step 9. Read references/image-contract.md; at step 9 also read references/texture-reference-images.md. Open source images before generating.

1. Preserve source style, identity, proportions, outfit, materials and asymmetry. Do not turn painted art into CGI/clay. Label reconstructed hidden details.
2. Make head front/back/left/right including ALL hair and head ornaments, excluding neck/shoulders. Long hair remains entirely with head.
3. Make body front/back/left/right including neck, clothes, limbs and footwear in consistent T-pose.
4. Each direction is a separate image. Left/right are character-relative. State visible side and screen-facing direction; never mirror asymmetry.
5. Keep landmarks/expression/scale coherent. Retain painted color references; depth generation is a separate process. Do not generate separate bald head, wig, clothing or base-body sets.
6. Save exact input hashes and register each result to its typed part/view slot. Human reviews color AND depth images.
7. Export selected model copies for manual Tripo segmentation. Returned segments form a new baseline; old vertex indices are not correspondence proof.
8. For texture references inspect actual group guide first, adopted color views second, original art for remaining design evidence. Preserve exact components, garment cut and relative placement.
9. Generate front/back square transparent PNGs, matching scale/baseline/full margin. Remove wires/UI/clay, do not invent hidden anatomy or seams.
10. Validate roles using scripts/validate_reference_manifest.py or .mjs. Decoding, labels and dimensions are technical checks; appearance/coherence need human review. Submit pending results; no self-approval.

## Repair a failed view

Keep rejected candidates in history, but never use a failed color view as the source for its replacement. Inspect the specific defect, rewrite the view prompt to correct it, then make a fresh attempt from the original color artwork. One accepted canonical color view may be added as an identity and orientation anchor. Never use a depth map for color or material identity. Recheck pose, view direction, silhouette, palette, full framing and asymmetry before submitting. Maintain a view/check matrix and continue every unresolved requested view with an improved prompt/conditioning strategy; no arbitrary retry count. Stop only for a genuine provider/tool/quota blocker or unsafe ambiguity, preserve pending drafts and state the exact resumable next action.

## Stage 9: projection photographs before UV creation

Stage 9 produces mesh-matched front/back photographs for Tripo texturing. These are not UV atlases, baked textures or edits to an existing material map. A group without UVs is a valid input. Do not demand a UV layer, create UVs, modify topology or run texture-repair/PBR binding audits to generate or submit these images. Smart UV and texturing happen later in the user's manual Tripo handoff. UV requirements at material return/repair remain in force there.

Read the actual group front/back projection guides, accepted color views and original color artwork. Use the guides for image-space silhouette, component placement, scale and baseline; use color artwork for palette, pattern and painting style. Do not use depth maps as paint references. Make separate transparent front/back PNGs. Inspect contour differences in projection image coordinates, not UV coordinates. Correct substantive mismatches by regenerating from the mesh guide and original/accepted color references, never by repeatedly editing failed outputs.

Register every decodable requested draft with asset_register(parentId=characterId) and send it to the exact texture-reference group/view slot using guided_output_submit. An accepted slot requires guided_correction_submit with its original identity and a note. Read submission.selected, artifactId and the resulting slot: registration alone is not submission, and a history-only record is not the current preview. Known contour deviations must be disclosed as draft warnings; they do not justify hiding a technically readable candidate from human review. A failed decode or ownership check is a real technical blocker: report it instead of claiming submission. Keep candidates pending, never self-approve, and do not put unaccepted drafts in a Tripo handoff.

Submitting drafts is visibility, not completion. Continue resolving every requested image until it is ready or a genuine tool/provider/quota blocker prevents progress; no arbitrary retry count. Keep unresolved work resumable, preserve versions and state exactly which results are still drafts. Human acceptance remains required.

## Reference-aware prompt preparation

Before an image-generation request, read `../atelier-character-pipeline/references/model-craft/reference-aware-prompts.md`. Build a positive, task-specific description from the observed source roles, target components, clothing coverage and material zones; add only relevant exclusions. Preserve intentional lace, translucent sleeves, glass and other authored transparency. Request opacity only for regions that are actually opaque in the source; never impose a blanket ban on transparent materials or change the approved costume silently. Transparent output background and garment alpha/transmission are separate properties. Reuse the prompt-building method, not another character's costume, colors, dimensions or negative list. The existing generation, validation and human-adoption gates still apply.

## Agent-defined groups

Read `../atelier-character-pipeline/references/agent-defined-groups.md` for component inspection, arbitrary named logical groups, complete assignments and trusted repartition recovery at stages 8–10. Group names/types are not a fixed accessory list. Keep one logical object per group, including its related components, and generate its own mesh guides and front/back paint references. Base exclusions on the actual selected mesh; never delete a present belt/detail from the image to conceal a grouping mistake.


Before finalizing groups or painted group projections, read `../atelier-mesh-repair/references/segmentation-groups.md`: inspect actual group-colored partition overviews and uncertain small pieces; verify hair/skin/cloth boundaries, all jewelry and authored material zones. For a wrongly attached connected surface, use the inspected face-selection repair route before regrouping rather than stopping at the whole-component tool limit. Preserve existing human image approvals after partition changes; inspect current guides and regenerate only actual image mismatches. Two-thirds silhouette coverage of an opaque group is an unfinished draft, not a ready handoff.
