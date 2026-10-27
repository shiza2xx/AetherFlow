# Mesh-matched texture references

New painted front/back images are distinct from initial multiviews/depth maps.

|Group|Contents|
|---|---|
|head|face/ears/head skin, excluding hair|
|hair|all hair, independently of motion subgroups|
|upper_body|neck/torso/arms/hands and clothing|
|lower_body|waist outfit, skirt/trousers, legs and shoes together|
|custom group key|one agent-defined logical object, including its related components; only if present|
|accessories (legacy)|existing combined legacy group; do not use as a default bucket for new unrelated objects|

No empty/imaginary groups. Keep fasteners with their actual logical object and material layer; inspect the source instead of assigning by size. Never uncover hidden legs/anatomy to simplify a lower-body image. Connected boundaries requiring cuts must be exposed, not guessed.
Mesh guide determines exact geometry/components/garment boundaries; adopted painted views determine color, pattern, finish and quality; original art supplements uncertain design. Do not simplify adopted paint to the source's less detailed treatment.

Prompt skeleton (translate into current app language):

Create one standalone {front/back} illustration of ONLY {actual mesh group}. Image 1 is the actual mesh guide and defines boundaries and geometry. Images 2 onward are adopted painted references defining color, patterns, finish and illustration quality. Preserve exact component set, garment cut, original relative positions and disconnected pieces. Remove wires, viewport UI and clay shading. Straight-on orthographic view centered in a square transparent PNG, full silhouette and margin. Match paired scale and vertical baseline. Preserve painted highlights/local color; omit cast floor shadows and external colored light. No missing body parts, new accessories or seams. {Observed details.}

Lower body: keep the actual lower outfit, legs and footwear; preserve coverage and occlusion. Classify exposed abdomen/navel/side skin by torso continuity, not by waist height; never attach it to a belt or legs by position alone.
Check separate square PNG front/back, 512–8192 pixels, matched dimensions/scale/baseline, actual alpha/full margin and color continuity across groups. Copies, crops, UV sheets and upscales do not count.
After human adoption issue group mesh+images for manual Smart UV then 4K retexture, no remesh. Restore returned UV/materials only after proving correspondence; preserve original components/motion groups.

## Stage 9: projection photographs before UV creation

Stage 9 produces mesh-matched front/back photographs for Tripo texturing. These are not UV atlases, baked textures or edits to an existing material map. A group without UVs is a valid input. Do not demand a UV layer, create UVs, modify topology or run texture-repair/PBR binding audits to generate or submit these images. Smart UV and texturing happen later in the user's manual Tripo handoff. UV requirements at material return/repair remain in force there.

Read the actual group front/back projection guides, accepted color views and original color artwork. Use the guides for image-space silhouette, component placement, scale and baseline; use color artwork for palette, pattern and painting style. Do not use depth maps as paint references. Make separate transparent front/back PNGs. Inspect contour differences in projection image coordinates, not UV coordinates. Correct substantive mismatches by regenerating from the mesh guide and original/accepted color references, never by repeatedly editing failed outputs.

Register every decodable requested draft with asset_register(parentId=characterId) and send it to the exact texture-reference group/view slot using guided_output_submit. An accepted slot requires guided_correction_submit with its original identity and a note. Read submission.selected, artifactId and the resulting slot: registration alone is not submission, and a history-only record is not the current preview. Known contour deviations must be disclosed as draft warnings; they do not justify hiding a technically readable candidate from human review. A failed decode or ownership check is a real technical blocker: report it instead of claiming submission. Keep candidates pending, never self-approve, and do not put unaccepted drafts in a Tripo handoff.

Submitting drafts is visibility, not completion. Continue resolving every requested image until it is ready or a genuine tool/provider/quota blocker prevents progress; no arbitrary retry count. Keep unresolved work resumable, preserve versions and state exactly which results are still drafts. Human acceptance remains required.

For prompt preparation, read `../../atelier-character-pipeline/references/model-craft/reference-aware-prompts.md`. Adapt the component inventory and material clauses to this actual group. Preserve source-authored lace, glass and other transparency; do not use a universal opaque-clothing negative prompt. Stage 9 still uses projection geometry rather than a UV prerequisite.

## Agent-defined groups

Read `../../atelier-character-pipeline/references/agent-defined-groups.md` for component inspection, arbitrary named logical groups, complete assignments and trusted repartition recovery at stages 8–10. Group names/types are not a fixed accessory list. Keep one logical object per group, including its related components, and generate its own mesh guides and front/back paint references. Base exclusions on the actual selected mesh; never delete a present belt/detail from the image to conceal a grouping mistake.


Before finalizing groups or painted group projections, read `../../atelier-mesh-repair/references/segmentation-groups.md`: inspect actual group-colored partition overviews and uncertain small pieces; verify hair/skin/cloth boundaries, all jewelry and authored material zones. For a wrongly attached connected surface, use the inspected face-selection repair route before regrouping rather than stopping at the whole-component tool limit. Preserve existing human image approvals after partition changes; inspect current guides and regenerate only actual image mismatches. Two-thirds silhouette coverage of an opaque group is an unfinished draft, not a ready handoff.
