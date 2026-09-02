# Mapbox GL JS 1.13 vs MapLibre GL JS 5 vs MapLibre GL JS 6 — browser map renderers

The runner behind [warefeats.com/benchmarks/maplibre-gl-js-vs-mapbox-gl-js/](https://warefeats.com/benchmarks/maplibre-gl-js-vs-mapbox-gl-js/). Three pinned renderer builds are fed the same self-hosted Berlin vector tiles, the same style, sprites and glyphs from a loopback server, in the same pinned Chromium on the same GPU, and this runner measures the startup timeline (bundle import, style load, first tile, load, first idle, plus 5,000 GeoJSON polygons), frame time over one camera path cold and warm, and renderer plus GPU process memory. Part of the [warefeats](https://warefeats.com) benchmark suite.

Disclosure: the author contributes to MapLibre projects, including MapLibre GL JS and Martin. Every number here comes from the runner in this repository, and the protocol is written so that anyone can rerun it.

## Why the Mapbox candidate is 1.13.3

Mapbox GL JS v2 and later are licensed only to holders of a Mapbox account under the Mapbox Terms of Service, which incorporate the Mapbox Product Terms. Section 1.5(iv) of the Product Terms dated 2026-07-21 reads: "use the Service Offerings to develop, test, validate, benchmark against, or improve any application, dataset, service, or API that is a substitute for, is substantially similar to, or competes with, any Mapbox product/service" is prohibited, and sections 3.40, 3.63 and 3.64 define the GL JS library itself as a Service Offering. Running a current mapbox-gl beside maplibre-gl is inside that language, and every map instantiation would also count a billable map load and send telemetry. mapbox-gl 1.13.3 is the last BSD-3-Clause release and the code MapLibre GL JS forked in December 2020, so it is the Mapbox artifact this benchmark measures. The page is framed accordingly: the fork measured against its origin, not a comparison with the current Mapbox product. See `docs/adr/0001-mapbox-candidate-is-1-13-3.md`.

## Candidates

| Candidate | Version | Build served | WebGL | Licence |
|---|---|---|---|---|
| Mapbox GL JS 1.13 | 1.13.3 | `dist/mapbox-gl.js` (UMD, worker embedded) | WebGL 1 | BSD-3-Clause |
| MapLibre GL JS 5 | 5.24.0 | `dist/maplibre-gl.js` (UMD, worker embedded) | WebGL 2, WebGL 1 fallback | BSD-3-Clause |
| MapLibre GL JS 6 | 6.7.0 | `dist/maplibre-gl.mjs` + `maplibre-gl-shared.mjs` + `maplibre-gl-worker.mjs` (ESM) | WebGL 2 | BSD-3-Clause |

The exact files come from the npm tarballs pinned in `package.json` and `bun.lock` (`maplibre-gl-5` and `maplibre-gl-6` are npm aliases for the two maplibre-gl versions) and are served from `node_modules` by the harness. Nothing is patched.

## What is measured

Startup timeline. From map construction, the events every build fires: `style.load`, the first `data` event carrying a tile, `load`, and the first `idle` after load; bundle import is timed separately from script tag insertion to evaluation. Then a pre-parsed FeatureCollection of 5,000 Berlin building footprints is added as a fill layer to the settled map and timed to the next idle.

Frame time. One deterministic camera path over Berlin (z11 over Mitte, zoom to z16 while rotating to 90° and pitching to 60°, pan 2 km east, zoom out to z12) traversed twice. Cold pan: 60 views, each advanced only when the map reports idle, so fetch, parse, layout and paint are inside every view; reported as ms per view. Warm paint: 600 steps advanced on every `render` event with every tile resident, after one unmeasured traversal of the same steps; vsync and the frame-rate limit are off; reported as ms per frame, with the tile requests the measured traversal caused recorded beside it. `docs/adr/0002-frame-time-is-unthrottled.md` says why.

Memory. Renderer and GPU process memory (private bytes on Windows) over a blank-page baseline, after first idle and after the cold pan, one fresh browser process per sample; the JS heap including workers is reported beside it.

Parity gate. At six fixed viewpoints every candidate's rendered features are counted per source layer with `queryRenderedFeatures` and compared with the 1.13.3 reference; a count outside 10% or 5 features invalidates the run. Screenshots at the same viewpoints are pixel-diffed and reported as information, not as a gate.

Network block. Chromium runs with a host-resolver rule that maps every host except 127.0.0.1 to nothing, and the harness records any request that is not to its own origin. One such request invalidates the run. This is how the zero-network claim is enforced rather than asserted.

## Fairness

| Held constant | Value |
|---|---|
| Tiles | One MBTiles cut by planetiler 0.10.2 from the Geofabrik Berlin extract of 2026-01-01, served gzip as z/x/y by the harness |
| Style | OSM Bright at a pinned commit, only its URLs rewritten to the loopback origin; sprites and Noto Sans glyphs served locally |
| Viewport | 1280×800 at device scale factor 1 |
| Map options | `maxTileCacheSize: 10000` so the warm traversal is warm; `fadeDuration: 300`; attribution control off; not interactive; the rest default |
| Browser | Playwright's pinned Chromium headless shell, one build, one flag set, GPU asserted before sampling |
| Protocol | 2 warmups, 15 measured passes, candidates interleaved and rotated each pass, fresh browser context every pass |

1.13.3 renders through WebGL 1 because that is what the artifact does. It is recorded, not compensated for.

## Corpus

`corpus/README.md` has the pins, checksums, licences and build scripts: `just corpus-fetch` downloads and verifies the inputs, `just corpus-tiles` cuts the MBTiles with planetiler in Docker, `just corpus-fixture` extracts the GeoJSON buildings. Large files live in the gitignored `corpus/cache/`; only their checksums are committed.

## Rig

The published run comes from a Windows 11 mini PC with an AMD Ryzen 7 6800H and its integrated Radeon graphics, driven over ssh. Measured on that box: from a non-interactive session only Playwright's headless shell with `--use-angle=d3d11 --use-gl=angle --ignore-gpu-blocklist` gets the GPU with hardware compositing; headless without the flags is SwiftShader, and headed gets readback compositing at best. The GPU assert at the start of every run refuses anything that is not Direct3D 11 on the real adapter. `just probe` prints what the browser got; `just rig-probe` does the same on the rig.

## Running

`bun install`, then `just probe` to see the renderer, `just smoke` for one short pass of every candidate with the parity table printed, `just bench` for the full protocol. Results land in the gitignored `results.json`, screenshots under `results/screenshots/`. On the rig: `just rig-push` and `just rig-push-corpus` once, then `just rig-probe`, `just rig-smoke`, `just rig-bench`, `just rig-pull`.

## Publishing

`just import` turns `results.json` into `runs/<date>-<rig>.json` and registers it in `benchmark.json`; the verdict and limitations in `benchmark.json` are written by hand from the run. The site pins this repository by commit in its registry and renders whatever the run file says.
