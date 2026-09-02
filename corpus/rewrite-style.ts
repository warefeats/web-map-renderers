// rewrite-style.ts — derive style/osm-bright.json from the pinned upstream OSM Bright style.
//
// Input : cache/upstream-style/style.json (openmaptiles/osm-bright-gl-style @ 563b249f7ae71528b1f1e327cb9c019d0dda4c50)
// Output: style/osm-bright.json
//
// The rewrite is textual, not a JSON re-serialisation, so every byte outside the touched lines is preserved
// (the upstream file uses hand formatting that JSON.stringify would not reproduce). Exactly these edits are made:
//   1. sources.openmaptiles: the MapTiler TileJSON `url` becomes an explicit `tiles` template on the placeholder origin.
//   2. sprite and glyphs: point at the placeholder origin.
//   3. metadata["openmaptiles:mapbox:source:url"] (a mapbox:// URL) is removed.
// Every needle must match exactly once; the result is parsed and deep-compared against the upstream object with the
// same three edits applied structurally, so a drift in upstream formatting fails loudly instead of silently.
// If cache/glyphs/ exists, every fontstack the style requests is also checked for a glyph directory.

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const input = join(here, "cache", "upstream-style", "style.json");
const output = join(here, "style", "osm-bright.json");
const glyphRoot = join(here, "cache", "glyphs");

const edits: Array<[string, string]> = [
  [
    `    "openmaptiles": {
      "type": "vector",
      "url": "https://api.maptiler.com/tiles/v3-openmaptiles/tiles.json?key={key}"
    }`,
    `    "openmaptiles": {
      "type": "vector",
      "tiles": ["{origin}/tiles/{z}/{x}/{y}.pbf"],
      "minzoom": 0,
      "maxzoom": 14
    }`,
  ],
  [
    `  "sprite": "https://openmaptiles.github.io/osm-bright-gl-style/sprite",`,
    `  "sprite": "{origin}/sprite/sprite",`,
  ],
  [
    `  "glyphs": "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key={key}",`,
    `  "glyphs": "{origin}/glyphs/{fontstack}/{range}.pbf",`,
  ],
  [`    "openmaptiles:mapbox:source:url": "mapbox://openmaptiles.4qljc88t",\n`, ""],
];

const upstreamText = await Bun.file(input).text();
let text = upstreamText;
for (const [needle, replacement] of edits) {
  const count = text.split(needle).length - 1;
  if (count !== 1) throw new Error(`expected exactly one match, found ${count}:\n${needle}`);
  text = text.replace(needle, replacement);
}
// Upstream ends without a trailing newline; that byte-for-byte ending is preserved on purpose.

// Structural check: same edits applied to the parsed upstream must equal the parsed output.
const expected = JSON.parse(upstreamText);
delete expected.metadata["openmaptiles:mapbox:source:url"];
expected.sources.openmaptiles = { type: "vector", tiles: ["{origin}/tiles/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14 };
expected.sprite = "{origin}/sprite/sprite";
expected.glyphs = "{origin}/glyphs/{fontstack}/{range}.pbf";
const actual = JSON.parse(text);
if (!Bun.deepEquals(actual, expected, true)) throw new Error("rewritten style is not structurally equal to upstream + edits");

for (const forbidden of ["{key}", "mapbox://", "api.maptiler.com", "http://", "https://"]) {
  if (text.includes(forbidden)) throw new Error(`rewritten style still contains ${forbidden}`);
}

await Bun.write(output, text);
console.log(`wrote ${output} (${text.length} bytes, ${actual.layers.length} layers)`);

// Fontstacks: MapLibre/Mapbox request {fontstack} as the comma-joined text-font array.
const stacks = new Set<string>();
const walk = (node: unknown): void => {
  if (Array.isArray(node)) node.forEach(walk);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "text-font") {
        if (Array.isArray(v) && v.every((s) => typeof s === "string")) stacks.add((v as string[]).join(","));
        else throw new Error(`text-font is not a plain string array: ${JSON.stringify(v)}`);
      } else walk(v);
    }
  }
};
walk(actual.layers);
console.log(`fontstacks requested by the style: ${[...stacks].map((s) => JSON.stringify(s)).join(", ")}`);
if (existsSync(glyphRoot)) {
  let missing = 0;
  for (const stack of stacks) {
    const ok = existsSync(join(glyphRoot, stack, "0-255.pbf"));
    console.log(`  ${ok ? "ok     " : "MISSING"} cache/glyphs/${stack}/`);
    if (!ok) missing++;
  }
  if (missing) throw new Error(`${missing} fontstack(s) have no glyph directory under cache/glyphs/`);
} else {
  console.log("cache/glyphs/ not present; glyph directory check skipped (run fetch.sh)");
}
