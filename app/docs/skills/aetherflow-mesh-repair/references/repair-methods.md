# Local repair selection and verification

| Observation | Inspect first | Appropriate route |
|---|---|---|
| Surface disappears from one side or only a dark line remains | Orientation, duplicate faces, normals, outline, plain shading | Correct a demonstrated display/normal cause; do not add cover faces |
| A connected neutral surface is dented | Sections and geometry with material/normal inputs isolated | Local coordinate edit fading to the fixed boundary |
| Small gap has a healthy surrounding contour | Boundary, adjacent tangent, required deformation | Curved local patch |
| Two boundaries should meet | Same layer/side, landmark order and direction | Ordered bridge; merge only intended coincident seams |
| Crossed/sliver faces or missing volume | Healthy perimeter, source views, sections | Local reconstruction |
| Failure appears only in motion | Rig, weights, corrective keys and face flow | Deformation diagnosis; do not fill a posed gap as a neutral hole |

Open hems, cuffs, mouth/eye openings, cloth edges, hair cards, and separate strands may be intentional. UV/hard-normal splits are not automatically holes. Keep layers and strands separate unless correspondence proves a weld.

## Patch a bounded opening

Select the damaged boundary and preserve the healthy ring. Match tangent and curvature in sections, not just the front silhouette. A simple face can suit a small nearly flat opening; a curved or deforming region needs appropriate flow. If a fill tool is used, inspect span, offset, twists, sliver faces, and triangulation. No fixed face count establishes anatomy.

## Join two loops

Name the two loops and their landmarks, then trace matching anatomical order before bridging. Correspondence must not cross. Different counts may require local subdivisions or density transitions. A bridge adds a strip; a merge collapses paired points. Inspect winding, thickness, pinching, sections, and duplicate faces. Preserve intentionally separate parts.

## Reconstruct missing volume

Rebuild the damaged interior to a healthy perimeter. Infer hidden volume only from accepted views, connection sections, and justified symmetric evidence; do not mirror known asymmetry blindly. Distinguish observed silhouette from inferred surfaces. Match thickness, curvature, and density gradually. Test required motion and interactions with adjacent layers.

## Rebuild dependent data

After creating faces, map UVs and materials, inspect normals and triangulated export, interpolate skin only from a same-side/same-layer surface, and retain or rebuild each needed shape key. Rebind supports in neutral state when necessary. Old indices cannot be reused after topology changes without explicit correspondence. Reopen and reimport the candidate, verify changed/protected regions and export attributes, then leave adoption to the human review gate.

Report source/output hashes, allowed scope, attribute correspondence, matched views/sections, motion entry/intermediate/maximum/return, new intersections by counterpart, reopened save, and export/runtime checks or their unverified status. A smaller total collision count can conceal a new collision with a different layer.
