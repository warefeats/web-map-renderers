# Corpus

Everything the three renderers are fed, pinned so that a reader can rebuild it. Large files live in the gitignored `cache/`; what is committed is the scripts, the style, the sprites, the GeoJSON fixture and `checksums.txt`.

## Pins

| Input | Pin |
|---|---|
| OSM extract | Geofabrik Berlin, 2026-01-01 (`berlin-260101.osm.pbf`, 95,916,520 bytes), MD5 `6d6de8da2d8192c5bbe7dd00e1004c82`, SHA-256 `9a5dff38…f13c6e94`; the same file the vector-tile-servers benchmark pins |
| Tile builder | planetiler 0.10.2, image `ghcr.io/onthegomap/planetiler:0.10.2`, default OpenMapTiles profile (schema 3.16.0), z0 to z14 |
| planetiler sources | Natural Earth, OSM water polygons, OSM lake centerlines, fetched by planetiler's `--download`; SHA-256 of each in `checksums.txt` |
| Style | OSM Bright, `openmaptiles/osm-bright-gl-style` at commit `563b249f7ae71528b1f1e327cb9c019d0dda4c50` (2026-08-04); sprites from that repository's gh-pages build of the same day |
| Glyphs | `openmaptiles/fonts` release v2.0, `noto-sans.zip`; the style uses Noto Sans Regular, Bold and Italic and every one has a glyph directory |

## Scripts

`fetch.sh` downloads and checksum-verifies every input into `cache/`, refuses to continue on a mismatch, and stages the committed `style/` files. `build-tiles.sh` runs planetiler in Docker over the extract and writes `cache/berlin.mbtiles` plus its log and build time. `rewrite-style.ts` derives `style/osm-bright.json` from the pinned upstream style with only its three external URLs pointed at a `{origin}` placeholder the harness fills in, and `validate-style.ts` runs the result through the style-spec validator that ships with each renderer. `analyze-style.ts` writes `style/COMPATIBILITY.md`, the inventory of everything the style asks a renderer to support, with anything newer than mapbox-gl 1.13 flagged; nothing is. `summarize-tiles.ts` writes `tiles-summary.txt`. `extract-buildings.ts` decodes the z14 tiles around Berlin Mitte and writes `fixtures/buildings-5k.geojson`, the first 5,000 distinct building footprints in tile row-major order.

## Output

942 tiles, 40,882,176 bytes, gzip-compressed MVT blobs; per-zoom counts in `tiles-summary.txt`. The MBTiles checksum in `checksums.txt` is that of this build; planetiler writes its own build metadata into the file and does not promise byte stability, so a rebuild from the same pins is equivalent in content rather than guaranteed identical. A second build from the cached sources on the same machine did reproduce the exact file. The first build took 3 m 50 s on an M2 Max, including source downloads.

## Licences

Map data: OpenStreetMap contributors, ODbL. OSM Bright: BSD-3-Clause (`style/LICENSE.md`). Noto Sans: SIL Open Font License 1.1. planetiler: Apache-2.0. Natural Earth: public domain.

## Known gap in the style

OSM Bright names POI icons `{class}_11` from the OpenMapTiles `poi` layer, and its sprite ships 103 icons, so classes such as `office`, `parking`, `atm`, `hairdresser` and `yoga` have no icon. Every renderer logs an "image could not be loaded" warning for each such class and draws the label without an icon. The gap is upstream, identical for all candidates, and left as is: the corpus is the style as published, not a corrected one. Warning counts per pass are recorded in the run file.
