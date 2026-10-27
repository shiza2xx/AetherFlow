# Local character texture repair: case study and reusable method

This record summarizes a prior character repair. Its measurements, UV locations, masks, and values describe that model only. Use the procedure as a diagnostic reference; derive every region and parameter from the current source and request.

## Diagnosis: separate texture defects from geometry

Compare the same region under the same camera and lighting: full PBR, PBR without the normal map, neutral gray with and without the normal map, and albedo without lighting. Neutralize roughness or metallic separately when needed. This identifies which map contributes to each defect.

- A dent that disappears when the normal map is disabled is likely in that map.
- A spot that remains without the normal map but disappears on neutral gray is likely albedo.
- A defect that changes when roughness or metallic is neutralized belongs to that channel.
- A shape that remains on gray without a normal map may be geometry, smoothing, or mesh normals. Textures cannot repair silhouette or real intersections.

In the recorded case, color and old metallic remained beneath removed corset rings; a small indentation beside the mouth disappeared without the normal map and required a 414-pixel normal-only edit. Hair normal-map experiments were inconclusive and were reverted. These are examples, not target locations or values for another character.

## Surface masks in existing UVs

Read vertex coordinates and face-corner UVs without moving vertices or unwrapping again. Rasterize UV triangles and use barycentric weights to map a surface point into the atlas. Build masks from surface position, connected component, normal direction, or distance to the confirmed defect. Bound each mask tightly and feather its edge.

Nearby surfaces can occupy distinct UV islands. The prior eyelid/corset repair distinguished skin from lashes, lacing, a corset star, and other real details; it found 80 additional UV triangles for skin behind upper lashes. Protect those surfaces explicitly. Check overlapping or mirrored UVs and seam padding so a local edit does not affect an unrelated surface.

## Normal maps

Past repairs targeted false chest dents, a back stripe, side/underarm/under-seat artifacts, false trouser ridges, cutout marks, and localized face transitions. These are historical examples only.

For a confirmed tangent-space defect, decode `n = 2 × RGB − 1`, blend toward a neutral or valid neighboring normal in the same tangent frame, normalize, then encode again:

```text
n_new = normalize((1 − m) × n + m × n_target)
```

Use `n_target = (0, 0, 1)` only when neutralizing added relief is appropriate. Do not average encoded RGB values, blend vectors from different tangent frames without transforming them, weaken an entire map, or flip the green channel globally without proving a convention error. Preserve original decoded pixels exactly outside the mask and inspect seams under grazing light.

Earlier candidate maps had a global color offset and exaggerated relief. They were calibrated, suppressed, and normalized before use. Some historical zones used only 4% of candidate deviation on the body and 8% on trousers; those are not defaults. A neutral encoded color near `(128,128,255)` cancels added normal relief but does not flatten the mesh.

## Roughness and metallic

Preserve each source map's spatial detail while changing only the confirmed range. In the prior fabric maps, the cloth was calibrated around a 0.46 center and 0.41–0.51 range; metal roughness was about 0.22–0.31. Base Color and Metallic stayed unchanged in that pass. Those values describe two specific maps, not a universal material recipe.

For one face-skin case, a masked limited adjustment used `clamp(0.38 + 0.62 × R, 0.45, 0.65)` and produced an approximate processed-region mean of 0.517. Lips and brow/lash islands were protected. Hair roughness received a capped `+92/255`; its recorded median shifted from about 0.173 to 0.533 while preserving source variation and the anime-style albedo band. Recalculate from the active maps instead of copying these values.

Metallic is independent from brightness and gloss. The case set hair metallic to zero and removed false metallic near damaged skin/fabric boundaries while preserving actual gold, rings, and the star. Lowering roughness does not remove a painted albedo highlight.

## Albedo repair

Use neighboring source pixels or small generated patches only for confirmed defects. The prior trouser/corset work inserted selected parts of generated fabric candidates into original 8K atlases. Face candidates were limited to mouth, nose, and eye regions; the mouth center and natural boundary were preserved, and the first overly soft nose candidate was rejected. For body contamination near clothing, a script selected nearby skin samples by color and surface distance, protecting fabric color, seams, and interior detail. An earlier average-red replacement destroyed cloth detail and was discarded.

Keep the original atlas as the base and apply a verified local mask. A lower-resolution candidate remains lower resolution after insertion into an 8K file. Do not replace the whole map, blur detailed fabric, or add lighting/highlights to albedo.

## Save, inspect, and preserve

Write new images and materials as versioned files; never overwrite originals. Keep rollback copies. Set albedo to sRGB and Normal/Roughness/Metallic to Non-Color, use the intended UV map, and connect normals through a Normal Map node.

The recorded project abandoned full-scene 8K emission baking after repeated memory exhaustion. It used sequential external image processing (for example NumPy/Pillow/SciPy, C# / System.Drawing, or a small compositor), including 32-row batches for one eye transfer. Prefer bounded local processing for large maps over a heavy scene bake.

For direct composites, compare decoded pixels outside masks. Audit geometry, UVs, element ordering, smoothing, mesh normals, and transforms independently. Compare multiple views under identical lighting. One face review was limited to 1K texture display in Blender; keep preview limits consistent so a display setting is not mistaken for a repair.

## Checklist for a new repair

1. Save a checkpoint of the scene/material state and record geometry, UVs, transforms, material nodes, and original image paths.
2. Inspect packed channels, UV selection, normal strength, bump, roughness/metallic factors, texture limits, filtering, and UV density.
3. Diagnose each visible defect with controlled map/material toggles before editing.
4. Map a tight surface-aware mask through existing UVs; protect neighboring and overlapping islands.
5. Repair normals in vector space, roughness and metallic independently, and albedo only with local source-preserving edits.
6. Save new lossless images with readable versions. Keep generated images as candidates until technically checked.
7. Verify unchanged pixels outside masks and review color-only, neutral-gray/normal, and full-PBR views at matching settings.
8. Report what changed, which maps/regions were checked, remaining geometry issues, and the rollback location.
