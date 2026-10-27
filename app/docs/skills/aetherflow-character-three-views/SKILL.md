---
name: aetherflow-character-three-views
description: Produce separate orthographic character views that preserve the approved source design.
---

# Three-view references

This AetherFlow skill defines the character view handoff. Follow its own user review gates and local workflow.

1. Use only workflow-selected slots. Head+Body needs independent front, left, right and back views for the complete head with its hair and for the clothed body. Separate Parts uses its own typed reference inventory. Do not add full-body balance views unless the active request explicitly contains those slots.
2. Keep framing, pose, lighting and visual style consistent with the source art. Do not mirror away asymmetric details.
3. Submit each image to its matching slot with managed bytes and request review. Never substitute a labeled sheet or a text prompt for missing views.

Use managed decoder validation and the human visual gate. Never use hardcoded dimensions or reuse prior character results as defaults.

When any view is returned for correction, keep the original color artwork as the primary source and rewrite the prompt after diagnosing the defect. You may add at most one clean, current, same-part view other than the target as a visual anchor; it can be pending or accepted, and its truthful review status and hash must be preserved. Never use the target's prior copy or failed, rejected, invalidated, or stale images as generation inputs; retain those only as diagnostics. Maintain a view/check matrix for every requested view. If one fails, change the prompt and conditioning strategy, continue with every unresolved requested view, and preserve usable candidates. Do not repeat an unchanged prompt or stop because of an arbitrary attempt count. Suspend only for a genuine generation blocker such as provider refusal, exhausted quota/limit, unavailable tool, or unsafe ambiguity; leave unresolved work explicitly pending and resumable. A partial set is not complete, and human Accept remains required.

For head views, read `references/head-view-prompt-patterns.md` and apply the template for each selected direction. These generalized front/back patterns follow successful user feedback; profile constraints are not visually validated by that feedback.

## Production consistency

For simplified hair, change hair geometry only. Use broad coherent masses with soft longitudinal painted strokes, subtle tonal variation and restrained broad highlights. Preserve the full source face design, painterly rendering level, skin, eyes/iris/lashes, nose/lips, palette, painted texture, hairstyle silhouette, authored asymmetry, curls, spikes and ornaments; preserve the source expression unless the user explicitly requests a different expression, then apply that requested expression consistently across selected views. Do not flatten the artwork or turn it into vector fill or plastic. Match-reference mode preserves the original hairstyle and rendering. Apply the persisted choice to all requested head color views. Illustrative examples are not character-specific generated previews. Derived depth maps preserve the exact current paired color silhouette and hair; do not re-simplify hair or use depth as a color/style reference. Show actual inputs and active view versions for human review. Brightness/hue statistics can flag drift but cannot approve a design.

## Simplified hair: solid mesh-ready geometry

When simplified hair is selected, reduce geometry substantially, not only surface noise. Build a continuous scalp hair base and broad thick CONNECTED clumps. Close small through-gaps between micro-strands; merge thin ribbons and fringe strips into solid masses. No lace-like cutouts, hollow loops, isolated floating strands or paper-thin tips. Preserve the overall outer silhouette, hairstyle identity, length, parting and palette, but allow small strand gaps to close. Maintain sufficient thickness and coherent overlaps across front, back and both profiles. Keep fine painted strokes and soft broad highlights inside the solid forms; these are color texture, never carved gaps. Protect the original face identity, expression, rendering style, skin and eye detail. The reference-faithful mode does not inherit these geometric simplifications. Depth must follow the corrected color geometry; it cannot repair holes still present in color views. Inspect every view for visible through-holes and disconnected ribbons before submission, and regenerate unresolved views from the original artwork plus at most one clean current color anchor.

## Resting hair volume, not wind volume

Before generating head color views, distinguish actual hair density/shape from wind, motion, perspective and rim-light effects in the original artwork. Reconstruct the natural gravity-resting hairstyle in still air. Do not turn the outer envelope of flying strands into extra solid hair mass, increase thickness to fill airborne gaps, or invent a larger rounded helmet. Preserve real length, density, parting, intentional curls/spikes, ornaments, painting style and facial detail. Cross-check front/back/profiles for the same plausible resting volume. This applies to both simplified and reference-faithful modes: faithful preserves authored hairstyle design, not incidental wind deformation. If the intended resting form is genuinely ambiguous, inspect other original references and isolate the uncertain feature rather than inventing bulk. Derived depth maps still follow the exact current paired color silhouette and must not reinterpret hair.

## Reference-aware prompt preparation

Before an image-generation request, read `../aetherflow-character-pipeline/references/model-craft/reference-aware-prompts.md`. Build a positive, task-specific description from the observed source roles, target components, clothing coverage and material zones; add only relevant exclusions. Preserve intentional lace, translucent sleeves, glass and other authored transparency. Request opacity only for regions that are actually opaque in the source; never impose a blanket ban on transparent materials or change the approved costume silently. Transparent output background and garment alpha/transmission are separate properties. Reuse the prompt-building method, not another character's costume, colors, dimensions or negative list. The existing generation, validation and human-adoption gates still apply.
