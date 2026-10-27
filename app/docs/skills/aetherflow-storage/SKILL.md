---
name: aetherflow-storage
description: Use when locating, preparing, or returning files in an AetherFlow workspace.
---

# AetherFlow workspace files

Use the active workspace returned by AetherFlow tools. Keep each project's files inside its own workspace. Use the stable character or project ID as the storage owner; a selected UI card does not establish ownership.

For character work, keep the Codex working directory at `work/characters/<character-id>`. Put source reference copies under `references/`, depth maps under `depth/`, models under `models/<stage>/`, textures under `textures/<stage>/`, production results under `stages/<stage>/`, and delivery exports under `exports/`. Use readable sanitized filenames with a stable ID suffix or version. Preserve existing files when a name collides.

Keep request snapshots, reports, diagnostics, and machine-generated JSON in the app's internal run area `.aetherflow/runs/<operation-id>`. Do not create loose UUID operation folders beside `characters/` or `projects/`. If the owner cannot be established from a managed character or project, retain the material in project triage and ask the user through the app's normal review flow. Never guess ownership from the current selection or a filename.

Managed objects in `objects/<sha256>` are immutable. Make real copies for editable tool inputs; never use writable hard links. Register outputs through the typed asset and workflow tools so versions, dependencies, checkpoints, and review decisions remain linked. Keep rejected, failed, interrupted, and unregistered files available for history or recovery.

Use the authenticated `storage_layout_status` and `storage_audit` MCP tools to inspect canonical paths and workspace file metadata. The audit does not authorize cleanup. Do not move or delete legacy files until the app reports a reviewed migration plan and confirms the workspace is idle.
