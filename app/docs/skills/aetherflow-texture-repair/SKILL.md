---
name: aetherflow-texture-repair
description: Diagnose and locally repair texture channels with verified UVs, explicit masks and source-preserving versions.
---

# Local texture repair

Material and image diagnosis share this Skill. Choose `materials` or `textures` before editing; read `../aetherflow-character-pipeline/references/model-craft/accessory-materials.md`. Pure material corrections preserve original image bytes, mesh/UV/skin/keys and record actual shader values, graph links and face assignments. Do not repaint to compensate for wrong assignment, color space, compression, outline or unsupported shader behavior. Persistent shape defects use `aetherflow-mesh-repair` with a separate checkpointed scope.

Use at material-return review, step 14 or explicit correction. Read pipeline model-craft/adjustment-methods.md and the surface baseline. Historical handoffs are optional cases, never default selectors.

Read ../aetherflow-character-pipeline/references/model-craft/personal-preservation-methods.md for the diagnostic display matrix, barycentric UV masks, map calibration and protected-pixel checks.

1. Inspect original art, adopted paint and actual model. Compare plain/wire/checker/painted views to isolate geometry, UV, normals, AO and image causes. Resolution cannot fix correspondence.
2. Checkpoint and capture geometry/corner/UV/material hashes, channel color spaces and original pixels.
3. Keep geometry/UV fixed. Select current explicit faces/material/UV region and create a mask; no stale indices after topology changes.
4. Repair only requested albedo/roughness/metallic/normal channel. Decode/blend/normalize/re-encode tangent normals. Do not treat every channel as sRGB.
5. Diagnose AO separately before smoothing detail. Apply correction once from original pixels; limit shared-material effects to the selected region.
6. Compare at matched camera/light/distance. Verify exact unchanged pixels outside mask, fixed geometry/UV and unchanged other channels. Save/reopen with dependencies.
7. Use `repair_pbr_mask.py` only for an explicitly requested numeric channel fill. Generated spatial patches use `composite_masked_patch.py` and are applied to a checkpoint copy with `apply_composited_atlas.py`; diagnosed normal repairs use `repair_normal_mask.py`. Register the staged candidate, masks, reports and dependencies.
8. Human adoption is required. A no-op needs actual recorded audit plus human “No repair needed”; missing images/checks are not success.

## Finite candidate review

Once a candidate is submitted, pin its managed artifact ID and SHA-256. Reopen the exact candidate for each distinct required validation phase; a compositor/applier self-reopen, trusted submit audit and human visual review may each require their own reopen. Reuse completed receipts for the same unchanged source/candidate hashes within a phase. Read the submit audit fields actually returned: `sourceBytesPreserved`, `candidateBytesVerified`, `reopenedVerified`, `protectedObjectsPreserved`, `declaredTargetPropertiesPreserved`, `rigAndActionsPreserved`, `changedObjects`, `geometryChangedObjects`, `requiresNewSurfaceBaseline`, `boundRigObjects`, source/candidate hashes, purpose, target objects, limitations and Blender version. These generic fields do not certify exact texture UV correspondence, mask conservation or visual quality. Collect the missing visual evidence in one pass: as a finite default, use a source-matched whole-model view and a close-up of the repaired target, with source and candidate shown at matched views. Add views for distinct affected regions or specific unresolved visual questions; do not force a fixed screenshot count when scope needs more evidence. Reuse submit-audit preservation checks plus exact-hash compositor/application receipts for UV correspondence, channel binding, mask conservation and protected pixels. If the candidate hash or viewer source changes, or a required check fails, stop and rerun only the affected check against the new pinned candidate. Sequence navigation, readiness, camera change acknowledgement and capture. After opening a version, resolve its actual displayed artifact ID/hash from the acknowledged UI/viewer context; never guess a derivative ID or reuse the prior source preview ID. Do not issue open, camera change and capture concurrently. If adoption changes the active version during review, reread its identity and avoid reopening an obsolete source merely to finish reporting. If `viewer_capture` returns queued/running with a `commandId`, call `viewer_inspect` with both the same displayed artifact ID and that `commandId`. Reuse a late completed capture only when its response includes the matching command ID, source artifact ID/hash, capture artifact ID/hash, MIME and hash-verified `bytesBase64`; otherwise report the receipt fields available and do not enqueue a duplicate blindly. If it is still pending, wait through the current 30-second viewer lease and inspect that command once more; if it remains pending, report its ID/status and stop rather than polling or queuing a duplicate. Return the evidence and pending candidate for human adoption, then stop. Do not repeat completed captures, full scene audits, or status polls for an unchanged candidate; do not convert a pending candidate into an accepted repair.

Guided stage health audits are read-only model checks: texture work preserves geometry, UVs, corner normals, skin and rig controls; weight work preserves geometry, UVs, normals, material/image graphs and rig controls. They validate actual assigned PBR graphs/images or normalized valid-bone weights. They do not claim visual perfection or prove a local mask for an externally edited model. Keep stronger operation-specific mask/local-edit receipts when using the guarded repair scripts, then require human visual adoption. An unchanged model still needs the actual health check before the human no-repair decision completes the step.

## Mesh-guided paint and deferred defects

Texture references use neutral illumination. Distinguish local pigment, a painted/emissive symbol and external colored reflections: preserve true red markings while removing unwanted red light from fabric. A flat emblem must remain surface paint/emission when the guide has no matching accessory mesh. Compare front/back as a pair, retain material zones (skin, stockings, shoe leather), and pass the pinned accepted color reference plus the actual group mesh guides.

Guide overlay/alpha spill/coverage/IoU and brightness drift are diagnostics only. Screen-space silhouette agreement does not prove UV correspondence. Do not silently crop/warp generated paint as a technical fix when the user requested generation-only edits. If generation is refused or a local defect is deferred, retain its exact target/note/source and canonical task for the model repair step; do not invent a new output or mark the issue resolved.

## Local texture issue annotations

When a Model workbench request includes `texture-repair-manifest.json`, treat it as the complete, source-pinned annotation set. Read every target in the manifest, then inspect its `original.path`, `marked.path`, and `mask.path` attachments. The original and marked files have the same dimensions; the explicit mask is white for requested pixels and black for protected pixels. Use only white mask pixels as the requested edit area. Red is a visual locator and is never the repair mask or evidence that the source artwork itself is red.

Before repair, verify `sourceArtifactId`, `sourceHash`, `sourceRevision`, `viewerArtifactId`, `viewerHash`, each `originalImageHash`, target dimensions, binding names, UV set and transform against the current managed source. Stop and ask for a new annotation if any pin is stale, a target is ambiguous, or the current model no longer matches the listed mesh/material binding. Shared image bindings intentionally share one union mask; mention mirrored or overlapping UVs where one image-space edit affects multiple faces.

Annotation creation is read-only and does not create a Blender checkpoint or source copy. When actual repair begins, use the existing workbench repair route and its source checkpoint. Diagnose material assignment, color space, UV mapping, lighting and geometry first. Apply a local correction from the unchanged original, prove every decoded pixel outside the white mask is identical, preserve geometry/UV/rig/other channels, register a new candidate, reopen and validate it, then wait for explicit human adoption. The manifest and red preview are intent evidence only; they are not a repair result or validation receipt.

## Generated spatial albedo repair

For a requested patterned repair, the workbench request must contain the pinned original color art used for character generation, accepted color views, and accepted texture-generation paint references for the affected groups. Confirm each reference is accepted, current-lineage, character-owned or an explicitly reusable original gallery reference, and hash-pinned. Never attach depth maps or unrelated gallery art as color guidance. The red annotation is a locator only; the manifest's white mask and pinned UV binding define the permitted edit area.

Ask the currently available image-generation capability for a spatially detailed patch aligned to the marked region and the supplied color references. Do not substitute a flat fill when image generation is unavailable: report the missing image-generation capability as a resumable prerequisite and retain the prepared request. Image generation is not repair completion. Save the generated patch separately, record its hash and explicit UV alignment rectangle, and run `scripts/composite_masked_patch.py` against the immutable original and exact mask. Its default 8-pixel inner feather is bounded to white mask pixels; it preserves decoded source pixels outside the mask and records its blend method, radius and evidence hashes. The compositor is self-contained Python 3 and uses only the standard library; invoke the copy under the immutable request Skill snapshot, with no repository-relative imports or Pillow/NumPy install. Review the result at source resolution for seams and pattern continuity before application.

Example for an RGB/RGBA albedo atlas and a generated RGB patch (paths and `candidateRect` come from the pinned request, not guesses):

```json
{
  "input": "original-albedo.png",
  "mask": "target-mask.png",
  "candidateTexture": "generated-spatial-patch.png",
  "output": "staged-albedo.png",
  "report": "staged-albedo-report.json",
  "channel": "albedo",
  "featherRadius": 8,
  "candidateRect": [0.2, 0.3, 0.15, 0.1]
}
```

Pass that object as the JSON argument to `composite_masked_patch.py`. Omit `candidateRect` only when the generated patch is aligned to the complete tight mask bounds. A candidate rectangle is normalized atlas UV space `[left, top, width, height]`; confirm orientation using the target binding's image-space convention. The tool rejects ambiguous dimensions, unsupported PNG encodings, empty masks and rectangles outside the atlas. Keep the original and generated patch immutable. When reusing a locator mask on a differently sized texture, supply the source and mask's exact verified UV-binding records; the helper resamples mask coverage with nearest-neighbor in normalized image space only when those records match. Different UV sets, transforms, wrap modes, or unresolved bindings remain a stop condition.

The same user region also triggers diagnosis of the bound normal map. Reuse its verified UV correspondence and derive the corresponding image-space mask at the normal map's own resolution; this is internal mask projection, not a second user drawing step. The albedo and normal records must each retain their own exact managed image ID and hash. Compare their canonical sampling projection—mesh, material and slot, UV set and index, UV digest/signature, UV transform, vertical flip and wrap modes—rather than requiring the two image identities, node names or dimensions to match. Supply both complete extracted binding records as `sourceUvBinding` (the normal image) and `maskUvBinding` (the albedo locator) when resolutions differ. Missing fields or a mismatch in the sampling projection is a stop condition; distinct pinned image identities are expected and do not weaken provenance. Compare the marked normal area to surrounding valid normals and the expected surface. Leave a healthy map byte-for-byte unchanged. For a confirmed defect, use a deterministic tangent-space normal repair candidate (never ordinary image-generation RGB as normal data), decode vectors, blend and renormalize inside that corresponding mask, and encode the result. The normal path uses vector-space compositing, not albedo's linear-light color blend. Preserve exact original decoded pixels outside each channel's verified mask.

Apply only the composed atlases to a disposable checkpointed model copy with `scripts/apply_composited_atlas.py` from this immutable Skill snapshot. The helper pins the checkpoint, original image, mask, composite, and compositor report hashes; it requires the exact Blender image name and material bindings; it preserves packed image storage; and it saves a separate pending `.blend`. It reopens that candidate and verifies the atlas, target nodes, object inventory, geometry, UVs and material assignments. It does not edit the source checkpoint or accept the candidate.

Create `apply-atlas.json` in the correction request workspace. `materialNames` must list every exact material using the pinned image. Use the immutable `source.blend` checkpoint from `model_workbench_begin_correction`; do not point this helper at the managed source or the live scene.

```json
{
  "blendInput": "source.blend",
  "originalImage": "original-albedo.png",
  "mask": "target-mask.png",
  "compositedTexture": "staged-albedo.png",
  "compositeReport": "staged-albedo-report.json",
  "outputBlend": "pending-texture-repair.blend",
  "report": "applied-atlas-report.json",
  "channel": "albedo",
  "imageName": "Atelier_upper_body_basecolor",
  "materialNames": ["Atelier_upper_body"],
  "hashes": {
    "blendInput": "<SHA-256 of source.blend>",
    "originalImage": "<SHA-256 of original-albedo.png>",
    "mask": "<SHA-256 of target-mask.png>",
    "compositedTexture": "<SHA-256 of staged-albedo.png>"
  }
}
```

Invoke the helper from its copied request Skill directory with the configured Blender executable, background mode, factory startup, autoexec disabled, one thread, and a nonzero Python exit code (for example `blender --background --factory-startup --disable-autoexec --threads 1 --python-exit-code 1 --python <copied-skill>/scripts/apply_composited_atlas.py -- <request-workspace>/apply-atlas.json`). Attach both reports and the new `.blend` through the existing managed candidate-import/submit flow. Reopen and validate source hashes, material/image assignments, UV and geometry invariance, masked-region changes and protected-pixel conservation. Human visual review and adoption remain required; never call a prepared prompt, generated patch, compositor report or pending candidate an accepted repair.

## Reference-aware prompt preparation

Before an image-generation request, read `../aetherflow-character-pipeline/references/model-craft/reference-aware-prompts.md`. Build a positive, task-specific description from the observed source roles, target components, clothing coverage and material zones; add only relevant exclusions. Preserve intentional lace, translucent sleeves, glass and other authored transparency. Request opacity only for regions that are actually opaque in the source; never impose a blanket ban on transparent materials or change the approved costume silently. Transparent output background and garment alpha/transmission are separate properties. Reuse the prompt-building method, not another character's costume, colors, dimensions or negative list. The existing generation, validation and human-adoption gates still apply.
