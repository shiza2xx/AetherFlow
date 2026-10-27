# Unity report manifest

Example below is a schema example, not a claim that those files/tests exist. Save as UTF-8 JSON. Before/after/MP4 paths may be absolute or relative to the manifest directory when using the CLI helper. Direct MCP tool paths must be absolute. Request1920×1080 PNGs explicitly; do not use tool-default thumbnails.

```json
{
  "name": "Camera obstruction recovery",
  "summary": "The camera now returns smoothly after an obstruction clears. Checked in the gameplay test scene.",
  "unityProjectPath": "C:/Projects/MyGame",
  "category": "Bug fix",
  "checks": ["Compilation: no errors", "Play mode: checked obstruction entry and recovery"],
  "taskIds": [],
  "evidence": {
    "before": "before.png",
    "after": "after.png",
    "beforeVideo": "before.mp4",
    "afterVideo": "after.mp4"
  },
  "missingEvidence": {},
  "idempotencyKey": "unity-camera-obstruction-20261017-01"
}
```

Required: `name` (1–240 characters), `summary` (1–4000), absolute existing `unityProjectPath`, `category`, `idempotencyKey` (8–160). Categories: `General`, `Shader`, `Mechanic`, `Scene`, `Bug fix`, `Performance`, `Other`. `checks` contains factual text, not an approval flag. `projectId` optionally identifies an existing AetherFlow project; otherwise the app's active project is used. `taskIds` must identify existing canonical tasks.

New reports use paired video roles `beforeVideo` and `afterVideo`. If either is supplied (as file or missing reason), BOTH require exactly one real file or nonempty missing-evidence reason, never both. Images `before`/`after` are optional in paired mode; supplied image roles still require exactly one file or reason. Example when the historical baseline was missed: `"evidence":{"afterVideo":"after.mp4"},"missingEvidence":{"beforeVideo":"Before video was not recorded before this work."}`. For nonvisual work use missing reasons for BOTH video roles and no files. Localize all reasons using AetherFlow's language. Optional image reasons may explain test-only/nonvisual work separately.

For work shown from multiple real camera angles, use `videoViews` instead of top-level `video`, `beforeVideo`, or `afterVideo`. Views are ordered, limited to8, and each has a unique lowercase slug `id`, a localized `label`, and both sides expressed as one file or one honest missing reason. Each view must contain at least one actual MP4. Capture the before clip for every intended view before editing, then its matching after clip after verification; do not create time segments or angles that do not exist.

```json
{
  "videoViews": [
    {
      "id": "front",
      "label": "Front",
      "evidence": { "beforeVideo": "front-before.mp4", "afterVideo": "front-after.mp4" },
      "missingEvidence": {}
    },
    {
      "id": "side",
      "label": "Side",
      "evidence": { "afterVideo": "side-after.mp4" },
      "missingEvidence": { "beforeVideo": "No before recording exists for this camera angle." }
    }
  ]
}
```

The app imports each clip sequentially after preflighting the complete report. A view step selects only that view's before/after pair; the shared timeline seeks within the selected recordings. Explicit views replace the single legacy video-step UI for that report. Do not combine top-level video roles with `videoViews`.

Legacy `video` and `gif` requests remain supported with their original validation and idempotency behavior. A single legacy `videoArtifactId` is displayed only as After, with Before missing. It never provides a baseline, and cannot override an explicitly missing canonical After. Do not mix legacy and paired video roles in new manifests.

Images must decode correctly, retaining their original bytes. MP4 must contain H.264/yuv420p, at least2 decoded frames, positive duration up to15seconds, up to30fps,1920px maximum edge and2,073,600canvaspixels. Maximum32MiB per file. Sources are copied into managed storage and assigned to named roles; keep originals until publication succeeds. Metadata and playback must both pass; no multi-second stalls.

An exact retry with the same key returns the same report. Reusing that key with changed content is an error; publish a genuine follow-up with a new key. An offline attempt leaves the original manifest for retry. A completed report does not alter task progress or grant human acceptance.

## Replace evidence without duplicating a report

Read the existing report's current `revision` using `unity_report_list`. Save a separate UTF-8 manifest:

```json
{
  "id": "existing-report-uuid",
  "expectedRevision": 3,
  "role": "afterVideo",
  "viewId": "front",
  "path": "after.mp4",
  "reason": "Replaced a low-resolution near-static clip with a clear recording of the actual result.",
  "idempotencyKey": "existing-report-video-quality-20261017-01"
}
```

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' report replace --manifest "C:\Projects\MyGame\Evidence\my-task\replace.json"`. The helper resolves `path` relative to the manifest. Direct MCP calls require an absolute path. Roles: `beforeVideo`, `afterVideo`, `before`, `after`, legacy `video` and `gif`. Include `viewId` only when replacing one side of a named `videoViews` entry; it must be that view's slug and the role must be `beforeVideo` or `afterVideo`. Reason follows app language. Use actual UUID/revision values. The report keeps its ID, other evidence, tasks and old files/history. A stale revision fails; refresh it before replacing the next role. Exact retry uses the same manifest/key. Verify returned IDs and actual existing-report media, not only isolated QA.
