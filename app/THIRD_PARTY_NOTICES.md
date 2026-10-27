# Third-party visual reference notices

The interface includes hand-authored visual adaptations of the public examples below. No source package, photo or brand asset is redistributed.

## Bencho Eye Tracker

Reference: [Bencho Eye Tracker](https://bencho.dev/?c=eye-tracker&theme=dark) by Lorenzo Cabra. Atelier recreates the soft rounded dark cube and slanted white capsule eyes with local CSS. It contains no Bencho logo, goat mark, photographs, or copied source code.

MIT License

Copyright (c) 2026 Lorenzo Cabra

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

Not covered by this licence: the Bencho name and the goat mark, and the
photographs shown on bencho.dev (none are included here). Third-party
material keeps its own licence; see THIRD_PARTY.md.

## React Bits Specular Button

Reference: [React Bits Specular Button](https://reactbits.dev/components/specular-button) by David Haz. Atelier uses a hand-authored glass-edge treatment and pointer-directed highlight, not the upstream component source or package.

MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**

The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**

What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**

## No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## FFmpeg and ffprobe (separate command-line programs)

The Windows installer includes unmodified FFmpeg/ffprobe 9.0.2 essentials builds from Gyan, distributed as separate executable programs under GPL version 3 or later. They are not linked into AetherFlow. Their copyright and license are preserved in `resources/tools/ffmpeg/LICENSE.txt`, with the distributor's build information in `README.txt` and the exact archive/file checksums in `toolchain.json`.

- Distributor and build/library information: https://www.gyan.dev/ffmpeg/builds/
- Original checksum-pinned distribution: https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.7z
- FFmpeg source matching this release build: https://github.com/FFmpeg/FFmpeg/tree/946fcce07b
- FFmpeg source release: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz
- License: https://www.gnu.org/licenses/gpl-3.0.html

The installer preparation script downloads the exact archive and verifies SHA-256 before extracting the two utilities and notices. FFmpeg remains independently replaceable; it is not exposed as a separately sold AetherFlow component.


## Lida — Skill guidance

Some AetherFlow Skills use and adapt workflow guidance from **3DCharaMakeSkills-Lida** by **Lida**: https://github.com/Lida-V/3DCharaMakeSkills-Lida

The guidance was adapted into English-language Skills, combined with the user's original handoffs, and integrated with AetherFlow's staged workflow, MCP tools and review requirements. This attribution is for the adapted Skill materials; it does not attribute the AetherFlow application implementation or the entire character production pipeline to Lida.

Original license, source notices and the author's English translation are preserved in [docs/licenses/lida](docs/licenses/lida/NOTICE.md). Original AetherFlow code remains separately licensed under MIT; third-party materials retain their own terms.
