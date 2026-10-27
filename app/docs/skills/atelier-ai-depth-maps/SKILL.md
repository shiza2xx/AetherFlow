---
name: atelier-ai-depth-maps
description: Generate spatially coherent grayscale volumetric depth images from selected color views for manual Tripo Multi-view.
---

# AI-generated depth maps

Use inside step 2.5 after selected color views exist. Read references/depth-map-contract.md. Use an image-generating model: not a grayscale filter, clay renderer, edge filter or ordinary depth estimator.

1. Open all four current selected color directions for the target: complete head WITH hair, or clothed body.
2. Visually reconstruct volume as smooth neutral grayscale: nearer visible surfaces lighter, farther surfaces darker, completely black background.
3. Preserve view, pose, silhouette, proportions, openings, multilayer geometry, ornaments and occlusion.
4. Remove material color, painted shadows, glossy highlights and texture noise. Retain actual overlapping depth and structural detail.
5. Generate directions independently; compare four together for coherent landmarks/scale/volume. No four-panel delivery or mirrored substitutes.
6. Step 2.5 may use the exact current verified paired color candidate while it is pending or accepted. Record its exact hash and truthful review status; pending is not human acceptance. Human approval of color/map pairs happens together in step 3; do not add an earlier approval. Register depth-<head|body>-<front|back|left|right> with corresponding color hash and set input hashes. Changed, rejected, invalidated, failed or stale color candidates cannot condition depth. Changed color inputs make derived maps stale.
7. Review decoding, grayscale/background, outline and spatial coherence. Do not claim metric calibration or guarantee downstream improvement.
8. Deliver eight real depth files plus retained eight color files and lineage. Submit for human review; prepare two ordered manual Tripo bundles without operating Tripo.

## Pair review and corrections

Inspect the actual color/depth pair at a useful size, including a close view of the face. Preserve defining mouth openings/teeth/cavity shape and horn silhouette; never replace a monster mouth with a generic anime mouth. Tail attachment, tip connectivity, front/back overlap and left/right volume must agree across color views before deriving depth. Opaque nearer surfaces must not reveal hidden geometry. A transparency/background/grayscale metric is a review warning, not proof that the volume is correct.

When color changes, derive only the affected view from its new exact hash and keep unrelated depth files selected. Submit paired changes atomically when that capability is available. Never erase prepared depth to express staleness, auto-adopt images, substitute a later capture for a lost baseline, or claim a complete accepted set based solely on decode success.

If a depth view fails, diagnose its actual defect and revise the prompt and generation strategy before another fresh generation. Use its exact current paired color view and hash, whose pending or accepted status must remain truthful; original color artwork is secondary identity evidence only. An optional clean current color view may be pending or accepted with truthful review status. Never condition a replacement on failed/stale depth copies or a chain of failed images. Decode and inspect each new PNG, then reassess grayscale/background, silhouette, view direction and visible volume. Continue on every unresolved requested view without repeating an unchanged prompt or stopping at an arbitrary attempt count. A technically valid PNG or matching outline does not pass a semantic lighting/volume failure. Suspend only for a genuine blocker such as provider refusal, exhausted quota/limit, or unavailable tool; keep unresolved work explicitly incomplete and resumable. Preserve usable pairs and leave human review in step 3.

## Mandatory visual conditioning

Before generation, open `references/depth-style-example.png` and the exact paired current color image. Attach BOTH images to the generative model: image 1 is the paired color view and controls identity, geometry, silhouette, pose, crop and direction; image 2 is the four-view example sheet and controls only the smooth grayscale volume representation and black background. Refer to the relevant example quadrant for orientation. Never copy its character, hat, ornaments, neck, proportions or framing. Deliver ONE full-size view per output, never the example sheet or a four-panel image. For body views transfer only the representation, not the head anatomy.

Ask for AI-generated visual depth, not a calibrated Z-buffer, a physically exact sensor field or a lit clay render. Use broad continuous gray volumes and clear layered occlusions as shown in the example; avoid arbitrary fixed brightness ranges for individual body parts. Do not multiply contradictory technical constraints on each retry. Distinguish real nearer volume from painted/specular highlights by comparison with the paired color image.

## Neutral RGB and truthful submission

Generated PNGs may encode visually neutral gray in RGB with tiny channel differences. Do not regenerate solely to force exact R=G=B when AetherFlow's neutral-RGB technical check passes. It accepts mean channel spread up to 2/255, peak up to 16/255, with at most 0.1% of pixels above 4/255; substantial tint or colored regions still fail. These tolerances do not certify volume. Never postprocess, desaturate, recolor or black-fill generator outputs unless explicitly requested by the user.

Inspect `candidate` and `submission` in the submit response, not only the outer `ok`. `submission.selected=false` means history-only: report the exact candidate, validation failure and that it has NOT replaced the current slot. Batch receipts describe the newly submitted candidates, not the prior current files. Existing failed candidates can be inspected in the UI using View candidate without restoring or accepting them. Fetch workflow status to verify exact artifact IDs before saying outputs are in current slots. Claim an opened UI preview only after a renderer acknowledgment identifies that artifact. A user's request to preview failed output is inspection permission, never permission to auto-accept it. Continue unresolved semantic defects; a technical pass alone is not completion.

To open a submitted image for assessment, call `ui_navigate` with screen=`Characters`, mode=`production`, characterId, stepKey=`views` (or `review-images`), and the exact candidate artifactId. Then read `ui_get_context` and verify that artifactId. This opens history inspection without adoption. If navigation times out, report it; never claim the preview opened.
