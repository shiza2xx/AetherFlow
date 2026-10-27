# Reference-aware image prompt construction

Use for character color references, stage 9 projection paint references and image-assisted texture repairs. This is a method for describing the intended result from observed evidence, not a fixed costume prompt or a promise that a provider will accept an image. Translate the final generator request into the application's selected language.

## Inspect before prescribing

Open the original color art, the current accepted color views and the operation's actual geometry guide or repair target. Identify which source controls each property: mesh projection controls stage 9 silhouette and component placement; accepted color art controls design, palette and painting; the verified UV binding and mask control a texture repair's location. Depth maps are not color/material authorities.

Before writing the prompt, identify the requested components, clothing layers, coverage/occlusion, material zones and actual transparency. Distinguish three independent things: a transparent image background, a surface's alpha/transmission, and geometric openings. A transparent PNG background does not require transparent clothes; lace holes do not make every material translucent. Do not infer missing anatomy or an unseen underlayer from an empty or gray mesh guide.

## Construct the prompt from observed properties

1. State the actual production task positively: a neutral costume-design projection reference, or a local material/pattern repair. Specify only the requested group, direction, framing and output format. Do not add anatomy-focused or suggestive presentation that is absent from the source.
2. Name the real source roles. Keep geometry, color/style and repair locality separate; do not ask one reference to define every property. List the actual components that belong to the target and preserve their proportions, relative positions, painting and material boundaries.
3. Describe coverage and opacity per material region. Preserve an opaque garment's coverage and opacity. Preserve intentional lace, mesh sleeves, translucent fabric, glass and their observed alpha/transmission instead of replacing them with opaque material. Use a clause such as 'no transparent garment regions' only when inspection confirms no such regions in the relevant source/target. Never apply that sentence universally. Do not remove authored transparency merely to make a prompt more restrictive, and do not add transparency where the reference has none.
4. Keep the intended garment layers and occlusion. Do not lift or shorten clothing, open covered regions, add underwear exposure, or reconstruct hidden anatomy. An intentional translucent sleeve or glass accessory does not authorize changing other regions. If a needed change would alter approved design or coverage, explain the specific conflict and ask for that design decision rather than silently changing the character.
5. Use neutral camera, pose and illumination appropriate to the actual task. For stage 9 retain the projection guide's orthographic orientation, scale, baseline and full margins. Remove viewport UI, floor shadows and unrelated objects without erasing intended painted detail or material properties.
6. Use a short, targeted exclusion list based on the task and observed errors. Exclude only components outside this group, invented details, unintended revealing changes or non-neutral presentation. A belt may belong to this group or another: check the manifest instead of always banning belts. Do not copy a long negative list from another character, insert fixed colors/dimensions, or equate a female character or skirt with prohibited content.

The useful pattern is source roles -> real component inventory -> preserved design/materials -> coverage and presentation -> specific exclusions. Adapt that structure; do not transplant a successful character's wording as a universal template. Write the desired image first, rather than filling the prompt with prohibited-content terms. There is no special negative-prompt field unless the actual tool exposes one; pass relevant constraints through its supported prompt argument.

## Stage 9 adaptation

Create separate front/back projection photographs of the verified texture group, not a UV atlas. The group may have no UVs. The same source-aware method applies to skirts, trousers, lace garments, glass accessories and other observed designs without imposing one costume or universal opacity. Use the actual front/back group guides for geometry and accepted color art for finish. Never add an accessory that is not in that group's inventory, even if it is visible in the full-body color image.

A transparent background must not erase semi-transparent garment pixels or turn glass into an empty cutout. Preserve the intended material semantics and state any uncertainty in the candidate review. Compare the saved candidate with the matching guide: first check canvas alignment and scale, then contour, component inventory and material boundaries. A contour warning does not hide a readable draft, but a visible pending draft is not a completed or approved reference. Submit to the exact group/view slot and keep human acceptance explicit.

## Texture-repair adaptation

State the concrete defect and permitted local change: for example, reconnect a painted motif, restore fabric detail, remove an unintended artifact, or soften the patch boundary. Use the original color art and accepted character/texture references as design evidence. Preserve clothing coverage, intentional transparency, material identity and all pixels outside the verified repair mask. Do not convert a local pattern correction into a new body image or costume redesign.

Keep the existing repair contract: pinned image hashes, exact UV binding, independent masks, feathering within the allowed region, preserved geometry/UVs and source bytes, separate normal-map diagnosis and vector-correct normal repair. This prompt method does not weaken those checks and does not ask image generation to produce tangent-space normal vectors. If repairing an intended lace or glass region, preserve its alpha/transmission and color without flattening it into opaque paint. If the region is opaque in the accepted source, preserve that opacity instead of introducing transparency.

## Outcome and evidence

Inspect actual output bytes and content. A negative instruction does not prove that the generated image obeys it, and a previously accepted reference does not certify every later output. Record concrete discrepancies, preserve usable pending candidates, and apply the existing human review and provider-error rules. Do not claim that this method guarantees the absence of moderation errors or that one accepted sample proves every possible costume will work.
