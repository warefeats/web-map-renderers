// extract-buildings.ts — pull 5,000 building polygons out of cache/berlin.mbtiles into fixtures/buildings-5k.geojson.
//
// Walks z14 tiles starting at the tile containing Berlin Mitte (lon 13.404, lat 52.520) and spiralling outward in
// rings of increasing Chebyshev distance (row-major within a ring), decodes the `building` layer of each tile with
// @mapbox/vector-tile, converts tile coordinates to lon/lat rounded to 6 decimals, drops duplicate geometries, and
// keeps the first 5,000 polygons in that deterministic order. Only `render_height` and `render_min_height` are kept
// as properties. Buildings that straddle tile edges appear once per tile, clipped to that tile's buffer, which is how
// a renderer sees them too.
//
// planetiler merges touching same-height buildings into MultiPolygons at z14, so a single tile feature can carry
// thousands of rings. By default each MultiPolygon is split into its member Polygons (order: tile, feature, polygon
// index) so the fixture holds 5,000 individual footprints; pass --multipolygons to keep one feature per tile feature
// instead, which reproduces the merged blobs (about 32 MB for 5,000 features).
//
// MBTiles stores tile_row in TMS (flipped) y: tms_y = 2^z - 1 - xyz_y. Blobs are gzip (checked via the 1f 8b magic).
// Run: bun run corpus/extract-buildings.ts [--multipolygons] [path/to.mbtiles] [count]
import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

const here = dirname(new URL(import.meta.url).pathname);
const keepMulti = Bun.argv.includes("--multipolygons");
const positional = Bun.argv.slice(2).filter((a) => !a.startsWith("--"));
const mbtiles = positional[0] ?? join(here, "cache", "berlin.mbtiles");
const target = Number(positional[1] ?? 5000);
const output = join(here, "fixtures", "buildings-5k.geojson");
const Z = 14;
const LON = 13.404;
const LAT = 52.52;
const KEEP = ["render_height", "render_min_height"] as const;

const lonToX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const roundCoords = (c: unknown): unknown => (typeof c === "number" ? round6(c) : (c as unknown[]).map(roundCoords));

const db = new Database(mbtiles, { readonly: true });
const getTile = db.query<{ d: Uint8Array }, [number, number, number]>(
  "select tile_data d from tiles where zoom_level = ? and tile_column = ? and tile_row = ?",
);

const x0 = lonToX(LON, Z);
const y0 = latToY(LAT, Z);
const n = 2 ** Z;
const seen = new Set<string>();
const features: string[] = [];
let tilesVisited = 0;
let tilesFound = 0;
let polygonsSeen = 0;
let duplicates = 0;
let splitMultis = 0;
let lastRing = 0;

outer: for (let r = 0; r < 64; r++) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      tilesVisited++;
      const row = getTile.get(Z, x, n - 1 - y);
      if (!row) continue;
      tilesFound++;
      lastRing = r;
      const blob = row.d;
      const raw = blob[0] === 0x1f && blob[1] === 0x8b ? Bun.gunzipSync(blob as Uint8Array<ArrayBuffer>) : blob;
      const layer = new VectorTile(new Pbf(raw)).layers.building;
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        polygonsSeen++;
        const gj = f.toGeoJSON(x, y, Z);
        const coords = roundCoords((gj.geometry as { coordinates: unknown }).coordinates) as unknown[];
        const geometries: Array<{ type: string; coordinates: unknown }> =
          gj.geometry.type === "MultiPolygon" && !keepMulti
            ? coords.map((polygon) => ({ type: "Polygon", coordinates: polygon }))
            : [{ type: gj.geometry.type, coordinates: coords }];
        if (gj.geometry.type === "MultiPolygon" && !keepMulti) splitMultis++;
        const properties: Record<string, unknown> = {};
        for (const k of KEEP) if (f.properties[k] !== undefined) properties[k] = f.properties[k];
        for (const geometry of geometries) {
          const key = JSON.stringify(geometry);
          if (seen.has(key)) {
            duplicates++;
            continue;
          }
          seen.add(key);
          features.push(JSON.stringify({ type: "Feature", properties, geometry }));
          if (features.length >= target) break outer;
        }
      }
    }
  }
}

const text = `{"type":"FeatureCollection","features":[\n${features.join(",\n")}\n]}\n`;
await Bun.write(output, text);
console.log(`start tile z${Z}/${x0}/${y0} (xyz), rings walked: 0..${lastRing}, tiles visited: ${tilesVisited}, tiles present: ${tilesFound}`);
console.log(`tile polygons decoded: ${polygonsSeen}, multipolygons split: ${splitMultis}, duplicate geometries dropped: ${duplicates}, features written: ${features.length}${keepMulti ? " (one feature per tile feature)" : " (one feature per polygon)"}`);
console.log(`wrote ${output} (${Buffer.byteLength(text)} bytes)`);
