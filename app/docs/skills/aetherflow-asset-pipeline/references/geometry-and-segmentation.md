# Geometry, segmentation, and surface ownership

## Manual geometry handoff

Prepare all currently eligible modules and shared prop sheets in one action. Materialize a readable folder from verified managed artifacts, with item names, the single current shared geometry sheet with per-tile color/depth source mapping, required view mapping, and concise manual Tripo instructions. Show the folder path and offer Explorer/cmd. An optional ZIP is secondary; never make the user extract a content-addressed object just to find input images.

Use color input unless the job-wide AI-depth setting is on for geometry. Include the eligible inputs for the full catalog in the same handoff. Tripo generation is a manual external step. Identify which returned model belongs to which master/sheet and process a batch together when possible. Autoassign an import only when that assignment is uniquely verifiable; otherwise show one concise mapping table. Preserve the original bytes even if safe preview conversion fails, and expose a retry action with the actual Blender diagnostic.

Return external Tripo models as FBX, GLB, or OBJ. Editable Blender models produced by the job's assembly and correction operations remain managed working versions. Keep OBJ material libraries and image maps registered with their model. Use embedded resources for GLB; export a `.gltf` result as GLB before returning it here. Missing or ambiguous texture dependencies need an explicit reimport or mapping action, not a successful-looking import with materials silently removed. Use the same checked import path for initial validation, candidate previews, and later editing.

Textured walls and roofs may return already complete. Validate and reuse that result without forcing it through a second texturing stage.

## Shared prop segmentation

Explain the manual operation: segment the returned shared Tripo model into parts, export that segmentation, and return it to the same job. Preserve the source model and segmented model as separate records. Codex must classify and group parts; the normal user is not expected to label a thousand segments.

Register the common returned model as a shared separation input belonging to the job and its exact reviewed prop sheet. Do not submit the entire common model as one prop's finished geometry. The user reviews this common input before partitioning; accepting it enables separation and does not finish any individual prop. A segmented return from Tripo is valid for this path. Inspect the available components and surfaces rather than claiming an automatic semantic segmentation capability that has not run.

Use the application's explicit shared-source selector for inventory, inspection and partition. Verify the sheet's member image hashes and the returned model's hash remain current. After grouping, submit each independent output to its actual master's geometry slot, read the slots back and request normal human review. Retain the original common input, sheet mapping and partition provenance. If the sheet changes, explain which shared input needs replacement without revoking unrelated accepted items.

The shared-input tool sequence is:

1. Read `asset_job_shared_sheets` and choose the actual accepted sheet. If several sheets could match a returned file, resolve that ambiguity before submission.
2. Use `asset_job_shared_import` for the common FBX, GLB or OBJ, then `asset_job_shared_submit` with its registered artifact, the exact sheet artifact and the current workflow revision. These tools do not approve the input.
3. Read `asset_job_get` to verify the pending entry in `sharedSources`, show its checked preview and request human review. Wait for acceptance as a separation input.
4. Run surface `inventory` with that entry's `sharedSourceId`; use `asset_job_components_list` and surface `inspect` to establish the actual groups. Use the latest workflow revision at every mutation. Do not also send `itemId` as an alternative source.
5. Run the checked partition using the verified face assignments and real target master IDs. Read the resulting individual geometry candidates back. Ask for their review before guides, texturing or assembly consume them as current models.

Inspect a paginated inventory, stable component IDs, bounds, original names, material slots, topology, and visual evidence before assignment. Use spatial and visual context together. A material name alone is insufficient. Assign every surface exactly once, with no duplicates, omissions, or silent disposal.

Create arbitrary named item groups based on the actual objects, not a fixed five-group character schema. Keep intentional attached pieces together, and keep nearby unrelated geometry separate. A worn or hanging accessory is not automatically skin/body material; classify by the mesh and original design.

## Boundaries inside a component

When an item boundary passes through one connected component, do not move the entire component or stop at saying component-only operations are insufficient. Use the controlled face-selection/splitting operation with explicit source IDs and a checkpoint. Preserve face provenance, coordinates, transforms, materials, UVs if present, and attributes.

Verify the partition against the source: union equals source faces, intersection is empty, unchanged regions match, and no unrelated surface moved. Inspect the new boundary and report whether open borders are intentional. Do not invent missing surfaces or weld/cap them without a separately scoped correction.

## Group review and independent outputs

Save new item models and preview them separately and in context. Require human review before superseding accepted groups. Keep unrelated accepted models/references usable. Only outputs whose source geometry changed become stale or require compatibility review.

Produce projection guides from the real accepted grouped mesh when texturing references need alignment. **UV is not required to render these guides or create color texturing references.** Do not block this stage on a UV unwrap that the later external texturing operation will create.

If shared generation destroys or loses one prop, offer a targeted individual regeneration path for that item. Keep the shared route and all good props intact.

## Manual Tripo texturing of separated shared props

Use the texture handoff (`asset_job_handoff_prepare` with `kind: "texture"`, or the Assets stage action) only for shared-prop models that were partitioned from the current accepted shared model and accepted in their own item slots. The handoff exports every eligible accepted partitioned prop with its original current front color reference and any other current accepted color views into a separate named folder under `work/assets/<job-id>/handoffs/texture/<operation-id>/`. Use each folder and `handoff.json` entry (`itemId`, role, artifact ID, hash, relative path, and partition lineage) to keep the model and references paired. The accepted shared source, geometry sheet, and partition provenance remain registered in the job. Items awaiting a current partitioned model or an accepted front color reference stay on the shared-prop waiting list.

Each accepted prop is exported as one FBX mesh object, following the Characters pipeline's native per-group join. The join keeps disconnected islands, transforms, UV coordinates, normals, and material assignments under source checks; it never combines different prop item IDs. Older accepted partition outputs with multiple mesh objects get a cached derived FBX for the handoff. The accepted geometry record and its history remain unchanged. This structural FBX verification does not claim Tripo acceptance.

Individual module models already include their Tripo textures. Keep their accepted models and texture dependencies for downstream processing; do not add modules to this handoff, waiting list, completion count, or ask for a material-slot reimport. Foliage uses its local cards.

Shared-prop texturing remains a manual Tripo step. Return each textured file through that shared prop's slider so the normal checked import path submits it to its matching `material` slot with its current geometry and color lineage. Do not assign files by list order or import the common shared model as one item's final material. Existing accepted shared-prop materials remain complete and may be inspected or re-exported. Prepare a new handoff after resolving missing, stale, or unreviewed shared geometry/color inputs.
