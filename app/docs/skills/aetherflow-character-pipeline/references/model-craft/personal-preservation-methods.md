# Preservation procedures

## Texture channels
Compare the same region, camera, and lighting in original PBR, without tangent normal, neutral gray with/without normal, and unlit albedo. A defect remaining without color and normal inputs can be geometry, smoothing, or mesh normals. Map each face through material, image, channel, and corner UVs; nearby surfaces can use different islands. For normals, decode to signed vectors, blend only inside the verified mask, normalize, and encode. Recalibrate roughness for the source; metallic is not a gloss control. Verify unchanged channels and every decoded pixel outside the permitted mask after reopen.

## Atlases and returned meshes
Material renaming, object joining, and atlas creation are distinct. An atlas needs explicit image/channel inventory, declared placements/padding, remapped corner UVs, preserved face/material correspondence, and registered dependencies. A transport mesh can use temporary material/UV layout only as a derivative. Retain original part topology, face/corner maps, materials, and UVs. Do not restore data by counts alone; prove full correspondence first.

## Height and animation
Measure rest height in declared units and axis, excluding props and pose-dependent bounds. Transform the coherent unrigged assembly. Animated armature scale can be keyed in every clip; applying transforms to an animated rig is not routine cleanup. Static-parent restoration requires proven correspondence and must preserve local rest, actions, NLA, bindings, weights, and clip behavior after export/reimport.

## Weights and transfer
On a copy, inspect neutral rest without applying pose as rest. Capture the vertex-by-group matrix, group order, UV/materials, rest matrices, and key/action links. For local transfer use an anatomically constrained same-side surface and barycentric values: `target=b0*w0+b1*w1+b2*w2`, `new=(1-alpha)*old+alpha*target`. Bound alpha and fade it at fixed boundaries. Nearest-surface transfer can cross limbs, folds, or layers. Preserve unedited rows exactly and verify required poses and return.
