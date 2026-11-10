# Windows MP4 recording

Use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' video`. It runs the maintained bundled `scripts/video.mjs` with the bundled application runtime and FFmpeg/ffprobe. No installer, model calls or second Codex session.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' video doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' video windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' video capture --hwnd 123456 --crop 0,110,1920,828 --seconds 5 --fps 30 --width 1920 --require-motion true --out "C:\Projects\MyGame\Evidence\my-task\after.mp4"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' video video --input "C:\Projects\MyGame\Evidence\my-task\source.mp4" --seconds 5 --fps 30 --width 1920 --require-motion true --out "C:\Projects\MyGame\Evidence\my-task\after.mp4"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' video inspect --input "C:\Projects\MyGame\Evidence\my-task\after.mp4"
```

Run capture once **before editing** into `before.mp4`, then again after verification into `after.mp4`. Use the same action, view, crop, duration and settings for comparison. The command above demonstrates the after capture; it is not a substitute for the baseline. Never reconstruct the historical before clip from the final scene.

The HWND/crop above are placeholders. Enumerate the actual intended Unity window and derive its client-relative viewport rectangle. Hide/restore Editor overlays when necessary; preserve original view, camera, selection, dirty state and Play mode. Never record unrelated desktop content or resize/upscale a small source to label it HD.

`--width` is an output maximum, not a resize target. The helper uses the smaller of the source width and this maximum, preserves the source aspect ratio, and never enlarges a source. A true1920×1080 window client captured with `--width 1920` remains1920×1080. A1280×720 client stays1280×720. Smaller windows, crops, or sources must be reported at the actual size; do not infer1080p from the monitor resolution. Capture receipts record both the actual output `width`/`height` and the window `captureSource.clientWidth`/`clientHeight` plus any crop. Verify these values with ffprobe before publishing.

Defaults:5seconds,30fps, up to1920px wide without upscaling. Combined caps:15seconds,30fps,1920 maximum edge,2,073,600canvaspixels,128MiB per MP4. H.264 AVC/yuv420p, CRF15 with the ultrafast preset, faststart. CRF15 with the ultrafast preset keeps the fastest encoder preset while applying a moderate quality increase over the previous CRF17 baseline. It preserves the existing frame-rate, pixel-format, duration and thread bounds. One decoder/filter/encoder thread at BelowNormal priority; output-local scratch, bounded heap, one recording/test job at a time. Source and existing output files are preserved.

Inspect the JSON receipt and actual motion. A correct encoded frame rate does not prove smooth capture or playback. Test the managed file in AetherFlow: media time progresses continuously, presented frames advance at a reasonable rate, no multi-second stalls, seek/pause/resume/fullscreen work. Check full-resolution PNG images separately in Fit and100% modes. Screenshots use original PNGs, not video posters or thumbnails.

Publish normal reports with `evidence.beforeVideo` and `evidence.afterVideo`. Check actual side-by-side synchronized playback, individual large views and shared timeline (limited to the shorter clip). To fix a previous report, use the appropriate `beforeVideo` or `afterVideo` role on the same report and preserve old GIF/history. Actual publication is required; a new file in scratch or a passing isolated test does not replace the user's old report.
