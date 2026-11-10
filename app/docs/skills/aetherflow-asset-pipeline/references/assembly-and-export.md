# Assembly and export

## Assemble actual masters

Read the current accepted version of every master immediately before building. Replace planning proxies with actual returned geometry. Apply each instance's stored position, rotation, and scale in a common coordinate frame. Repeated masters share their mesh and materials where possible. Separate variants only when a user/agent intentionally makes an instance unique.

Stage-5 validation blocks composites with no active instances. If an accepted project is blocked by an empty list, restore placements through a full catalog proposal that retains the existing item IDs and accepted outputs; do not ask the user to regenerate images or models. Build the proposed layout from the original reference and the current accepted geometry models. Preserve each occurrence's confidence and evidence in the proposal so inferred or uncertain positions remain visible for review. Placement confidence/evidence changes do not alter geometry dependencies; position, rotation, or scale changes require a new scene build and review.

Check wall seams, roof alignment, opening size, supporting contact, and prop placement. Use one known dimension if available; make inferred scale explicit. Do not hide an incorrect model using severe nonuniform scaling. Preserve meaningful pivots, item names, material assignments, textures, and transform provenance.

### Verify a complete building visually

For a composite building, compare the assembled scene with the registered original artwork, selected crop, and brief. Confirm the visible habitable storey count separately from attic/gables, floor bands, repeated facade rows, ridge/eaves, widths, proportions, and source-visible silhouettes. Check the complete architecture-appropriate exterior around all sides, including rear, roof ends/gables, closures, contacts, gaps, and voids. Hidden sides should follow the reviewed assumptions consistently, with `placementConfidence: inferred` and `placementEvidence`; do not claim the source establishes unseen details.

Before presenting a scene candidate for review, inspect the actual assembled scene through available verified UI/Blender tools from front, side, rear, top, and a source-matching angle. Fix placement defects and inspect again. Metadata validation and visual verification are separate; a successful build does not establish visual fidelity. If the required views cannot be captured, report those checks as unverified instead of claiming success. Human catalog and scene approval gates remain unchanged, and a selected pending scene remains eligible for diagnosis and correction. Apply this building envelope check only to composite buildings: explicit side exclusions and open/cutaway structures take precedence, and prop-sets, trees/foliage, and independent props are not forced into an enclosure. Placement-only corrections preserve accepted images, meshes, materials, item IDs, existing instance IDs, slots, and history; assign new IDs only to added instances.

Place independently generated beams, windows and doors as separate named objects alongside their relevant wall instances; preserve a usable door pivot for subsequent animation. Record the intended future positions of window and door openings; the wall remains uncut, and the user removes the relevant wall geometry and installs each object manually. Do not claim the openings have already been made. Keep repeated instances linked to the same master mesh and material when supported, and verify actual sharing instead of assuming it merely because files have the same name. Explain any export-format or runtime limitation on preserving that linkage.

For a prop set, the main result is independent ready items. A preview arrangement must not force unrelated props into an inseparable exported mesh. A tree is a composite with woody geometry and reusable foliage clusters.

## Corrections and freshness

### Correct the assembled scene

When the user requests a scene correction, keep the task scoped to the whole assembled composite. Use the Stage 5 `Correct assembly` action so the prepared, job-scoped request includes the user's issue verbatim along with the current job/workflow revisions, original reference, selected scene candidate, accepted masters and materials, and saved instance transforms. Inspect the actual scene and model artifacts for the reported placement, alignment, overlap, scale, or visibility issue; do not regenerate the reference images.

The selected current scene may itself be pending human review; that pending scene is still a valid correction target. Inspect it and prepare a placement proposal when needed instead of stopping before diagnosis. Preserve the candidate as pending: never accept or reject the selected scene, an older pending scene, or a new proposal automatically. Human review is required for a new catalog proposal before using its placements to build another scene, and for each resulting scene candidate.

Preserve accepted geometry, image, and material candidates, their IDs and statuses, their slots, artifacts, and history. If placement changes can resolve the issue, submit a full catalog proposal with the current item IDs and new or adjusted instance transforms using `asset_job_catalog_submit`. Stage 5 must expose the proposal for human review; do not send the user back to Composition. A placement-only proposal must not trigger global catalog revalidation or invalidate accepted outputs. If a catalog proposal is already pending, have the user review it before preparing another proposal; this does not block inspecting the selected pending scene or preparing the first correction proposal.

After the user accepts placement changes, reread the job and validate the saved state, then use `asset_job_surface_run` with `mode: "assemble"` to create a new pending scene candidate. The user inspects and accepts or rejects that candidate in Stage 5. Never accept a scene or catalog proposal on the user's behalf. If the requested result requires changing an accepted model, material, or reference and Stage 5 operations cannot perform it, state the exact limitation and stop without a no-op proposal or success claim.

For MCP assembly, read the current job with `asset_job_get` immediately before a state-changing call. Use its `workflow.revision` as `expectedRevision` for `asset_job_surface_run` with `mode: "assemble"` and for `asset_job_export`. `asset_job_validate` is read-only and takes the job ID. Read the job again after assembly or a scene review: assembly produces a pending scene candidate, and only an explicit human acceptance makes the composite exportable. Prop-sets validate and export independent accepted models without an assembly call. On an operation error, retain its error code, operation ID when returned, and causal details; confirm current job state before retrying.

An accepted workbench correction updates the master, all its non-unique instances, subsequent handoffs, assembly, and export inputs. Reject or keep pending candidates without changing current accepted outputs. Track dependency hashes so an old cached assembly or export cannot be presented as current after a master changed.

A transform edit invalidates placement-dependent assembly/export only; placement-only changes preserve accepted geometry, color-image, and material candidate IDs/statuses without global revalidation. A texture edit invalidates material-dependent previews/export but not the mesh-generation inputs. Geometry edits require checking dependent guides/UV/textures; compatible data may be retained with verification instead of globally erasing approvals.

Before export, resolve missing or stale dependencies item by item. Keep the unaffected work usable.

## Deliverables

- Default independent models: FBX with readable, paired texture folders.
- Composite object: editable Blender scene using actual accepted models and arranged instances.
- Optional GLB: portable preview/export with materials and alpha clipping retained.
- Foliage: atlas, source images if requested, and Unity material instructions.
- Derived manifest: item/version/hash mapping, units, instances, transforms, dependencies, warnings, validation results. SQLite remains canonical.

Materialize files in the job's readable exports tree. Name files by item and version. Exports belong to this job, never a shared anonymous workspace exports pile. Expose the real folder to the user. Verify hashes and required files after materialization and before reporting success.

Do not build an installer, publish a release, commit, push, or modify a Unity project as part of asset production. Those are separate user actions.
