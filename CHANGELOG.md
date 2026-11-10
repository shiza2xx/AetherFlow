# Changelog

## 1.0.16

### New: Assets workflow

This release introduces the Assets section for the first time. It was not included in 1.0.15.

- Produce modular buildings, composite objects and sets of individual props from a reference image.
- Plan reusable parts and repeated instances, prepare color references and optional AI depth maps, and export images for manual generation in Tripo.
- Import models and ZIP packages, separate segmented shared objects, and return their textured models.
- Assemble accepted parts into a scene, request whole-scene corrections through Codex, review the result and export models and textures.
- Use the new asset-specific MCP commands and production skill.

### Other changes

- Added a choice between Codex and manual external image generation, with prompts and reference attachments.
- Improved model processing, preview caching, import progress and error feedback.
- Updated branding, the default dark theme and interface consistency.
- Improved the quality settings for new Unity report recordings.

Windows x64. The installer includes Blender, FFmpeg and FFprobe. Releases provide a signed update manifest and SHA-256 checksums.
