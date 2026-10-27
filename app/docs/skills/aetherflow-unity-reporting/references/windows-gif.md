# Windows GIF utility

Legacy compatibility only. New Unity reports use [H.264 MP4 recording](windows-video.md) and full-resolution PNGs. Do not use this GIF route as the primary result or infer smooth playback from its frame count.

Entry point: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' gif`. It invokes the application runtime and the maintained bundled `scripts/gif.mjs`, using the bundled FFmpeg/ffprobe tools. It requires no installer or subscription API. Run commands from CMD or through a shell exec tool; a second Codex CLI session is not involved.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' gif doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' gif windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' gif capture --hwnd 123456 --seconds 5 --fps 20 --width 1280 --require-motion true --out "C:\Projects\MyGame\Evidence\my-task\result.gif"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' gif video --input "C:\Projects\MyGame\Evidence\my-task\capture.mp4" --seconds 5 --fps 20 --width 1280 --require-motion true --out "C:\Projects\MyGame\Evidence\my-task\result.gif"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' gif frames --pattern "C:\Projects\MyGame\Evidence\my-task\frame-%04d.png" --fps 20 --width 1280 --require-motion true --out "C:\Projects\MyGame\Evidence\my-task\result.gif"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '{{HELPER}}' gif inspect --input "C:\Projects\MyGame\Evidence\my-task\result.gif"
```

`123456` is an example handle. Run `windows` and use the intended visible Unity window's current HWND. Do not guess by process name when several Editors are open. Optional `--crop x,y,width,height` selects an integer-pixel rectangle relative to the captured window's client area, before downscaling. It must fit that window. Use the actual Scene/Game viewport, excluding toolbars and other panels; calculate the rectangle from real window geometry. For example `--crop 192,90,1536,864` is valid only when that rectangle is inside the selected window and matches its viewport. GDI capture may need the target visible/unoccluded; inspect the output before publishing.

Defaults: 5 seconds, 20 fps, up to 1280 pixels wide with no upscaling. Caps: 15 seconds, 30 fps, 1920 pixels. Output must be a new absolute `.gif` path; existing files are preserved. Processing uses one encoding/filter thread at low priority and sequential disk-backed passes to avoid buffering the full clip in RAM. Each file is limited to 32 MiB. A JSON receipt beside the GIF records actual output metadata and motion diagnostics; keep it for diagnostics.

AetherFlow report playback also limits canvas area to 2,073,600 pixels, longest edge to 1920, frame count to 450, and full-canvas pixel count × frames to 128,000,000. These are combined limits: 1280×720 at 20 fps for 5 seconds fits (92,160,000), while Full HD needs a shorter clip or lower frame rate. Maximum duration, rate and dimensions cannot all be combined. Small delta-frame rectangles do not bypass this budget. The general Gallery import budget stays unchanged.

`animated` describes the container. `visibleMotion` is a heuristic based on small decoded grayscale frames, changed-pixel area and difference magnitude. `--require-motion true` rejects a near-static output before publishing its GIF/receipt. Noise and tiny changes should not pass as substantial motion. This is not semantic recognition: inspect what actually moves, and use a tighter crop for a small relevant animation. A successful encode or a changed frame hash is insufficient. Verify actual playback in AetherFlow as well.

CMD helpers also limit Node's JavaScript heap to 256 MiB. Some window backends can return a black GDI capture despite valid GIF metadata; use actual Unity MCP frame captures with `frames` when this happens. Recording Unity's visible DX11 Editor window and converting Scene-view MCP frames have both been checked on this installation.

For MCP frame sequences, preserve actual frame order and timing. Do not fabricate repeated screenshots to satisfy a GIF requirement. If the intended behavior could not be recorded, publish an explicit missing-GIF reason and the actual still evidence instead.

Capture backend reference: [FFmpeg gdigrab documentation](https://ffmpeg.org/ffmpeg-devices.html#gdigrab). The utility selects `hwnd=` explicitly; its defaults and limits above are local AetherFlow policy.
