# Texturing, PBR, and alpha-card vegetation

## Individual texturing

For a whole-job manual Tripo texturing handoff, include only shared-prop models that were partitioned from the current accepted shared model, accepted in their own item slots, and have a current accepted original front color reference. Export each eligible prop with its matching separate accepted color views and keep an item-to-file mapping. Current or unreviewed partitions and color references remain on the shared-prop waiting list.

Individual module models already include their Tripo textures and remain usable with their accepted model dependencies. Do not include modules in shared-prop texturing handoffs or counters, and do not request a material-slot reimport for them. If a module needs an explicit material correction, handle that request through the existing targeted repair workflow without changing the generic model repair path.

If needed for an eligible shared prop, render front/back projection guides from its accepted mesh and generate aligned color references while checking actual decorations, coverage, silhouette, and scale. UV is not a prerequisite for these images. Never paint an existing mesh ornament into skin or remove it with an unrelated negative prompt. Preserve already reviewed results and register all usable new candidates for separate human review.

Prepare all eligible item folders together, clearly pairing each mesh and image set. User performs Tripo texturing/PBR creation and returns results. Validate returned UVs, textures, materials, geometry compatibility, missing dependencies, and correspondence to the intended item. Store diagnostics as actionable warnings or real blocking errors, not a blanket failure for every imperfect draft.

Preserve ready textured module results. New material corrections need not regenerate geometry. Use the original color references that defined the item, not depth maps, to repair colors. Inspect related normal/PBR channels in the same UV defect region. Blend repaired fragments across a controlled feathered boundary; retain pixels outside the repair region and verify normal vectors separately from ordinary color pixels.

## Woody geometry and crown sources

For trees, use a volumetric trunk and large branches. Remove leaf masses from the woody geometry generation input without changing the underlying branch layout. Retain crown attachment information. Leaves and thin twigs are generated as clump textures, not as a closed solid tree canopy.

One clump has four accepted transparent views: front, back, side, top. Preserve full-resolution originals. Do not substitute one image into every required view and claim a completed set.

## Deterministic atlas and card cluster

Build one 2048 by 2048 atlas per clump. Pack all four views with stable mapping and sufficient padding. Extend edge RGB into transparent texels while preserving alpha so mip filtering does not create pale or dark fringes. Record source hashes and atlas rectangles.

Build three intersecting planes in a consistent local coordinate frame. Front/back views occupy opposite faces of the primary plane; side/top views occupy the remaining planes with appropriate UV orientation. Use directed polygons and UV assignments so different front/back images do not require a custom Unity shader. Check that viewing from the reverse side does not reveal a hole or an unintended mirrored image.

Use alpha clipping, glTF `MASK`, and initial cutoff 0.5. Do not turn the entire rectangular texture background opaque. Ensure channel previews, object picking, and defect markup respect transparent regions as well as normal shaded display.

## Crown placement

Place instances of the shared clump geometry around branch attachment points, with deliberate orientation and bounded scale variation. Reuse meshes and materials. Match the reference's static crown shape; avoid duplicating reference wind deformation. Keep trunk and foliage separately selectable and inspectable. The viewer must offer all/trunk/foliage views and element selection.

Inspect front, back, side, top, oblique views and the crown interior for flatness, gaps, repeated patterns, opaque rectangles, fringes, reversed faces, and excessive overdraw. Do not claim performance without measuring it. Wind animation and LOD creation are outside this update.

## Unity handoff

Export the editable source, independent meshes, and texture files. GLB should preserve `MASK`; FBX alone does not automatically configure the user's Unity render pipeline. Include concise material instructions: assign the atlas to base color/alpha, enable Alpha Clipping, start at cutoff 0.5, and choose face rendering appropriate to the exported directed planes. Do not edit the Unity project automatically.
