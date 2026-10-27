# Character assembly, rig-return, and weight repair: case study

This is a technical record of one successful character pipeline and its limits. Object names, vertex indices, UV regions, masks, coefficients, frame numbers, and measured values below belong to that character only. Recompute and verify them for every new source.

## 1. Keep the operations distinct

- **Join** combines objects into one mesh. It does not create a shared material or atlas, remove intersections, or weld parts by itself.
- **An atlas** combines images and requires a matching UV transform. Geometry can remain unchanged.
- **One UV layer** can still contain overlapping islands; separate materials and images may have made that valid in the source.
- **Auto-rigging** supplies a skeleton and weights, but does not guarantee good deformation. A clip without finger motion does not prove finger bones are absent.

The recorded project kept skin and clothing as two shared PBR materials plus other materials. It used a separate material-free copy for the mesh-only service test and retained an external restore map. One character-wide atlas was not required.

## 2. Two PBR atlases in the historical project

The skin atlas combined `head_textured`, `body.001`, and `hand_textured` as `Skin_Atlas_Shared_v1`. The clothing atlas combined `pants`, `corset`, and the historically misnamed `bra textured` (a sleeved top) as `Clothing_Atlas_Shared_v1`. Metal rings and a star remained part of the corset material.

Before combining, the source shader constants matched, including Normal Map Strength 1.0; differences were in the images. A new character still needs its own compatibility check for transparency, shader type, emission, coat, subsurface, normal strength, and other constant settings. Keep separate materials where necessary.

Each atlas used four 8192×8192 PNG maps: albedo in sRGB, and normal/roughness/metallic in Non-Color. Images were processed sequentially outside the heavy scene; no new drawing or geometry bake was used. The old UV coverage assigned the head to an upper-left region, body/hands to lower regions, trousers to one region, and corset/sleeves to others. Margins were 32 pixels. No islands were rotated or mirrored. Normal vectors were renormalized after resize. These dimensions were measured for the old UV and must not be copied blindly.

The original albedos were 8K, so three full-resolution sheets could not fit into one 8K atlas at original texel density. The atlas preserved layout and details but reduced some resolution; full source images remained intact.

The old UV layer was kept exactly. A new active/render UV layer named `UVMap` contained only uniform positive scale plus pixel offset:

```text
UV_atlas = (s × UV_source + offset_pixels) / atlas_size_pixels
```

No geometry, connectivity, smoothing, or mesh normals changed. Materials were copied, atlas images assigned, and the same explicit UV map was used by the Normal Map node. Original materials remained recoverable. The working character parts stayed separate; only an export copy was joined. The early atlas stage had 9 materials rather than 13; the later returned rig used 10 slots, so material counts are stage-specific.

Fewer materials may reduce material sections, but do not claim one draw call from one material or one joined mesh. Actual draw calls depend on renderers and the imported mesh.

## 3. The mesh-only service test

The successful service result was reported by the user after they uploaded `asset_library/04_exports/tripo_join_uv_mesh_v1/Character_Joined_UV_MeshOnly_v1.fbx`. The offline report itself had `tested_in_tripo=false`; service acceptance is not an offline guarantee for other characters.

The copy contained 13 current character parts, one mesh, one UV layer named `UVMap`, and no materials, images, texture links, vertex colors, bones, or animations. A rapier and stale joined test copies were excluded. The FBX was 2,698,556 bytes (~2.7 MB), with 48,473 vertices, 51,853 polygons, and 94,930 derived triangles; rest height was 1.73 m.

Preparation recorded source world coordinates, mesh elements, active UVs, smoothing, corner normals, material assignments, and images. Independent object/mesh copies were made; only those copies lost materials/media. The active/render UV actually used by each shader was checked before being copied into the common name. Transforms were brought into a common space while preserving world positions/normals. Temporary source-part groups were used to discover post-Join indices. Native Join did not merge by distance, weld, remesh, decimate, or force triangulation. The source modifier/parent/constraint/shape-key stack was audited first rather than automatically applied.

Two sidecar files carried restoration data: `Source_Geometry_UV.npz` held source geometry/UV/normals/smoothing; `Part_Material_Restore_Map.json` mapped joined vertex, polygon, and loop indices to original parts, source material slots, face material indices, and UV names. A source manifest recorded scene, parts, transforms, materials, and images. This map is valid only for that exact export order. It is essential because a material-free FBX cannot identify which source image belongs on each face.

Export used the copy only, without animation or images; `use_mesh_modifiers=false`, `use_triangles=false`, `use_tspace=false`, `-Z` forward / `Y` up. An import-back check compared UVs, corner/polygon order, smoothing, world positions, and normals. Position error was about `2.83e−7 m`; maximum normal difference was about `0.0334°`. FBX inspection found no material, texture, video, deformer, or animation blocks. These settings describe the checked Blender path, not every importer.

## 4. Restore materials on the returned rig

The returned archive `asset_library/Character_Tripo_Animated.zip` contained one FBX, one mesh, 67 bones, and 24 Actions. It was first inspected separately, then imported with image search and automatic bone reorientation disabled and animations enabled.

Before restoration, compare topology/connectivity, vertex/corner/polygon order, every corner UV, rest-pose world shape after scale/offset, and a one-to-one face/material mapping to the exact sent export. The historical return preserved topology, order, and UV exactly; only overall scale/position plus rig/weights differed. Thus materials could be assigned using verified indices instead of projection or rebaking. Equal vertex counts alone do not prove correspondence. If order, remesh, or UVs differ, stop and establish a new transfer method.

The original material slots and each face's material index were restored on the returned mesh, retaining its Armature modifier, weights, and Actions. `Character_Tripo_Textured` ended with 10 source materials and 40 image nodes. Original PBR images and UVs were reused; no reunwrap or bake occurred. Source corner normals/smoothing were restored from the verified map with vectors transformed into the returned mesh space. This changed shading data without moving vertices; do not describe it as leaving imported normals untouched.

Original collections were hidden under `SOURCE_PreTripo_Backup`; the rapier stayed separate. The result was saved as `Character_Tripo_Rig_Restored_v1.blend`, leaving the source untouched.

## 5. Height adjustment

Before rigging, the old character measured 1.015352248 m from boot soles to the top of the hair in world space, excluding the rapier. A uniform factor of 1.7038421917 brought all 13 character parts and weapon to 1.73 m and placed the soles at Z=0. Object transforms changed; local geometry, UVs, and materials did not. A new model must measure its own defined rest-pose endpoints and units, then compute `target_height / measured_rest_height`.

The returned rig measured about 1 m and needed a distinct factor near 1.730000118. Every Tripo clip had Armature scale keys, so scaling the Armature alone could be overwritten by animation. A static Empty, `Character_Tripo_Root_173cm`, became the parent of Armature while the mesh kept its existing hierarchy. The common parent carried scale and offset:

```text
world_restored = scale × world_returned + offset
offset = mean(world_source − scale × world_returned)
```

Vertex correspondence was established before computing the offset. Armature keys and all animation remained unchanged. Rest height and one frame from each of 24 Actions were checked. Do not also scale the child mesh, which doubles the transform. Include the root when exporting; applying transforms to an animated hierarchy is a separate reviewed operation.

## 6. Weight repair: preserve exact state, then edit locally

The source snapshot included a vertex-by-group weight matrix **and group names/order**, bone hierarchy/rest matrices, current Action/frame and animation keys/handles, geometry, UVs, materials, and unsaved user edits. A numeric matrix without group ordering cannot be restored safely.

For a neutral pose, disable the active Action while preserving it, clear pose transforms, and retain the source Armature rest basis. Do not apply the pose as the rest pose or move edit bones. The recorded import was T-pose; another model may have an A-pose. Select each test Action explicitly and check NLA, constraints, and residual pose values before judging a frame.

Audit weights against actual surface regions in rest pose. The case looked for Spine/Chest/UpperChest tails on pelvis, arm influences on face/hair, the opposite leg on the outer thigh, and misplaced Neck influence. A narrow pelvis cleanup removed only confirmed tails and smoothly redistributed their weights along `UpperChest → Chest → Spine → Hips`; it did not zero them and run global Normalize All. Other groups and vertices stayed exact. One stray hair vertex was restored from healthy neighbors in the same connected component. A body region does not have to be fully red in Spine to be correct; judge deformation and foreign influences.

For trousers, corset, and sleeves, candidate body triangles were found with a BVH in rest pose and barycentric weights interpolated:

```text
w_target = b0 × w0 + b1 × w1 + b2 × w2
w_new = (1 − alpha) × w_old + alpha × w_target
```

`alpha` limited the edit spatially and feathered it. A nearest surface may be anatomically wrong near a cutout, opposite leg, fold, or opening; verify side, region, and contact. The trouser center bridge stayed supported by Hips while inner lower panels blended toward UpperLeg. The jaw/head-neck boundary was shaped to the real surface while protecting face vertices from arm/shoulder weights. Smoothing stayed inside connected selected regions; proximity alone did not justify mixing disconnected surfaces.

Metal rings received a uniform local attachment row so vertices moved together. A single bone at weight 1.0 is needed for truly rigid attachment; multiple skinning influences can scale/shear. Fabric and lacing remained deformable. In one case, hair/eyes were attached to Head and a suspended `wings` garment to UpperChest. A later task added four two-bone chains from the prior working rig after verifying the 1,536-vertex mesh matched; 923 attachment vertices stayed fixed to UpperChest. This behaved like a cape, not opening wings. New bones do not animate old clips or add physics automatically.

Weights remained nonnegative and normalized. The saved case used at most six influences on edited vertices; this is not a guarantee for another engine's import settings. Untouched rows, including small values, remained exact. No global small-weight deletion or Preserve Volume toggle substituted for a local fix.

The user-selected tests included climb frames 20–35 (especially 22/25/34), fighting 22, rapier stance 75, and comfortable stance 107, followed by other stances, walk, and run. Review volume, stretching, intersections, and silhouette from multiple sides—not only Weight Paint colors or closest-distance metrics. Contact optimization candidates were rejected when they improved sampled constraints but worsened other poses. Do not apply intermediate `contact_candidate`/`refined_candidate` NPZ files just because a script completed.

Final historical v6 edit changed 119 trouser vertices and 28 skin vertices, fixing the reported frame-107 penetration while preserving the opposing skin field and prior under-seat correction. A small intersection remained in another wide stance. The result was `accepted_weights.npz` plus the saved scene, not an arbitrary candidate-named file.

## 7. Procedure for a new character

1. Checkpoint the current master, source images/materials, actual shader UVs, geometry, normals, transforms, and user edits. Keep weapons separate unless requested.
2. If atlasing is needed, check shader compatibility, map all channels consistently, measure texel density/padding, normalize resized normals, and state any resolution loss. Preserve original UVs.
3. Make an isolated copy for a service/export test. Save the actually used UVs and source membership map before stripping materials. Audit modifiers; never modify the master.
4. Capture source geometry, UVs, corners, material slots, face assignments, and part membership beside that exact export. Import it back and verify order/topology/UV/positions/normals and absence of unwanted media.
5. Inspect the returned file in rest pose and compare against the exact sent export. Restore materials by indices only when correspondence is proven; otherwise derive and validate a new map.
6. Measure height in world space with explicit endpoints. For keyed rig scale, use one static parent for a uniform hierarchy transform; check rest pose and representative frames without duplicating scale.
7. Record group names/order and exact weights before editing. Audit other influences; apply only bounded, surface-appropriate changes. Preserve weights outside edits.
8. Test named Actions/frames and opposing loads. Check volume, stretch, intersections, and remaining limits from multiple views.
9. Compare geometry, UVs, material assignments, bone rest matrices/hierarchy, and animation keys against baseline. Save a new version and ensure rollback verifies topology and group ordering.

## 8. Historical evidence map

The old project organized `asset_library` as `01_sources`, `02_work`, `03_masters`, `04_exports`, and `05_reports`. Each export needs its own restoration map; never reuse another export's map.

- Skin atlas: `02_work/skin_atlas_v1/README.md`, `export_tools/skin_atlas_begin.py`, `skin_atlas_build.ps1`, `SkinAtlas.cs`, `skin_atlas_apply.py`.
- Clothing atlas: `02_work/clothing_atlas_v1/README.md`, `export_tools/clothing_atlas_begin.py`, `clothing_atlas_apply.py`.
- Mesh-only snapshot/export: `export_tools/mesh_only_character_snapshot.py`, `mesh_only_character_export.py`. The latter clears a separate export process and must not run inside the active work scene.
- Exact exported mesh and map: `04_exports/tripo_join_uv_mesh_v1/README.md`, `export_verification.json`, `Part_Material_Restore_Map.json`, and `Source_Geometry_UV.npz`.
- Return feasibility: `05_reports/tripo_return_audit_v1/restoration_feasibility.json`.
- Rig/material restoration: `02_work/tripo_rig_restored_v1/prepare_import.py`, `restore_character.py`, `restoration_report.json`.
- Pre-rig height: `02_work/height_173cm_no_rig_v1/README.md`.
- Weight cleanup and later decisions: `02_work/tripo_weights_cleanup_v1/README.md`, `plan_cleanup.py`, `tripo_weights_fix_v2` through `v6` READMEs/scripts, and `02_work/tripo_cape_rig_v1/README.md`.

For the related texture procedure, see `aetherflow-texture-repair/references/texture-repair-case-study.md`.
