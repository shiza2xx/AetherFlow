# Accessory material diagnosis

Pin the source, camera, pose, practical distance, lighting, exposure, color transform, target shader/version, and material/image hashes. Keep an unaffected angle for comparison. Trace target faces to material datablocks, images, channels, color spaces, and UV layers; matching names do not prove shared data.

Classify likely causes before editing. Wrong color or white import suggests assignment, image, color space, compression, or UV. View-dependent shine suggests reflection, roughness, exposure, or supported coat/transmission. Dark metal blobs may be outline width/color or unsupported shader behavior. Surface-locked patterns may be albedo, AO, shadow tint, or masks. Silhouette/connectivity needs geometry work. Test one contribution at a time on a copy and restore it before the next test.

Enumerate shared-material users. A local change needs a proven face reassignment, a duplicated material actually assigned to those faces, or an exact region mask. Check draw-call/material budgets and read settings after reimport. Report unsupported engine features separately. Blender appearance alone is not target-engine proof.
