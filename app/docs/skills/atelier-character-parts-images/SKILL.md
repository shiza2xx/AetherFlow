---
name: atelier-character-parts-images
description: Create individual source-faithful character and garment reference images for Atelier's typed slots.
---

# Character parts images

Use this skill for reference-image work. Its Atelier gates and local workflow are self-contained.

1. Read approved source art and create one image per requested view/part. Preserve silhouette, asymmetry and material construction. Follow the workflow's typed inventory; garments require front and back, accessories front only unless requested side views are explicit.
2. Do not assume example names, sizes, color palettes, background or figure dimensions. Record uncertain source facts as questions.
3. Register image bytes and their actual role in the managed slot. Keep each result separate; no composite sheet.
4. Check image decoding and slot completeness, then request human review. A prompt or saved request is not a completed image.

The human decides visual correctness. Use the request's available native image-generation capability. Do not automate Tripo or a browser, install an external image-provider client, or substitute an unconfigured service.

## Stage 9: projection photographs before UV creation

Stage 9 produces mesh-matched front/back photographs for Tripo texturing. These are not UV atlases, baked textures or edits to an existing material map. A group without UVs is a valid input. Do not demand a UV layer, create UVs, modify topology or run texture-repair/PBR binding audits to generate or submit these images. Smart UV and texturing happen later in the user's manual Tripo handoff. UV requirements at material return/repair remain in force there.

Read the actual group front/back projection guides, accepted color views and original color artwork. Use the guides for image-space silhouette, component placement, scale and baseline; use color artwork for palette, pattern and painting style. Do not use depth maps as paint references. Make separate transparent front/back PNGs. Inspect contour differences in projection image coordinates, not UV coordinates. Correct substantive mismatches by regenerating from the mesh guide and original/accepted color references, never by repeatedly editing failed outputs.

Register every decodable requested draft with asset_register(parentId=characterId) and send it to the exact texture-reference group/view slot using guided_output_submit. An accepted slot requires guided_correction_submit with its original identity and a note. Read submission.selected, artifactId and the resulting slot: registration alone is not submission, and a history-only record is not the current preview. Known contour deviations must be disclosed as draft warnings; they do not justify hiding a technically readable candidate from human review. A failed decode or ownership check is a real technical blocker: report it instead of claiming submission. Keep candidates pending, never self-approve, and do not put unaccepted drafts in a Tripo handoff.

Submitting drafts is visibility, not completion. Continue resolving every requested image until it is ready or a genuine tool/provider/quota blocker prevents progress; no arbitrary retry count. Keep unresolved work resumable, preserve versions and state exactly which results are still drafts. Human acceptance remains required.

## Reference-aware prompt preparation

Before an image-generation request, read `../atelier-character-pipeline/references/model-craft/reference-aware-prompts.md`. Build a positive, task-specific description from the observed source roles, target components, clothing coverage and material zones; add only relevant exclusions. Preserve intentional lace, translucent sleeves, glass and other authored transparency. Request opacity only for regions that are actually opaque in the source; never impose a blanket ban on transparent materials or change the approved costume silently. Transparent output background and garment alpha/transmission are separate properties. Reuse the prompt-building method, not another character's costume, colors, dimensions or negative list. The existing generation, validation and human-adoption gates still apply.
