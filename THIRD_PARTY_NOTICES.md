# Third-party notices

The project source is MIT licensed. Redistributed runtimes and libraries retain their own licenses; the app's MIT license does not replace them.

| Component | Version | License and source |
|---|---|---|
| Node.js Windows x64 | 24.19.0 | MIT and included third-party terms; full notice in `licenses/NODE_LICENSE.txt` and release `runtime/NODE_LICENSE.txt`; https://github.com/nodejs/node/tree/v24.19.0 |
| sharp | 0.35.5 | Apache-2.0; https://github.com/lovell/sharp/tree/v0.35.5 |
| @img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later, as declared by the upstream binary package; included LICENSE and README list individual library terms |
| libvips and its binary dependencies | version recorded in runtime package `versions.json` | Upstream licenses vary by component; https://github.com/libvips/libvips ; binary build scripts/source: https://github.com/lovell/sharp-libvips |
| @img/colour, detect-libc, semver | locked in pnpm-lock.yaml | License and source metadata included in their release package directories |
| yazl | 3.3.1 | MIT; https://github.com/thejoshwolfe/yazl |
| yauzl | 3.4.0 | MIT; https://github.com/thejoshwolfe/yauzl |
| buffer-crc32, pend | locked in pnpm-lock.yaml | MIT; included package notices |

Builds copy complete dependency package directories, preserving their LICENSE, README, package metadata and source links. The Windows sharp package includes shared library DLLs and a detailed table of its bundled dependencies. These libraries are unmodified, remain separate, and can be replaced by ABI-compatible builds; the native launcher and app sources and build process are public.

For exact runtime versions see `BUILD-INFO.json` in the release. No Huaban images or user metadata are distributed with this project. The software license grants no rights in downloaded content, trademarks, or third-party materials.
