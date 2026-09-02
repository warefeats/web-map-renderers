# Style compatibility: OSM Bright vs. mapbox-gl 1.13.3, maplibre-gl 5.24.0, maplibre-gl 6.7.0

`osm-bright.json` is openmaptiles/osm-bright-gl-style at commit `563b249f7ae71528b1f1e327cb9c019d0dda4c50` with only its three external URLs and one `mapbox://` metadata entry rewritten (see `../rewrite-style.ts`). This document lists everything the style asks a renderer to support and flags anything that entered the style specification after mapbox-gl-js 1.13, the oldest renderer in the benchmark.

## Verdict

Nothing is flagged. Every layer type, layer-level key, layout property, paint property, enumeration value, filter operator, property-function form and token-string form in the style belongs to the Mapbox GL style specification v8 as it first shipped: the `sdk-support` table bundled in mapbox-gl 1.13.3 lists js `0.10.0` (the first v8 release, 2015) for all 26 layout and 16 paint properties the style uses, and the enum values in use (`symbol-placement` point/line, `text-anchor` left/top, `icon-rotation-alignment` and `text-rotation-alignment` map/viewport, `line-cap` butt/round, `line-join` bevel/round, `text-transform` uppercase, `visibility` visible) are all from the original v8 enum sets. The style contains no expressions at all, so none of the operators added in later spec versions (`distance`, `image`, `format`, `within`, `index-of`, `slice`, ...) can be present. There is no `sky`, `fill-extrusion`, `hillshade`, `heatmap`, `circle` or `raster` layer, no `slot`/`imports`/`fragment`, no `projection`, `terrain`, `light`, `sky` or `transition` root key, and no MapLibre-only property (`text-variable-anchor-offset`, `global-state`, `color-relief`, ...). The three renderers render the same style semantics; the benchmark measures their engines, not their spec coverage.

## How this was checked

The claims above are mechanical, not from memory. `../validate-style.ts` runs the rewritten style through each renderer's own validator and reports zero errors from all three: mapbox-gl 1.13.3's bundled `dist/style-spec` (`validate`), and `@maplibre/maplibre-gl-style-spec` 24.10.0 (resolved from maplibre-gl 5.24.0's dependency tree) and 26.4.1 (from maplibre-gl 6.7.0's) via `validateStyleMin`. The 1.13.3 validator is a real gate: fed a `sky` layer it answers `expected one of [fill, line, symbol, circle, heatmap, fill-extrusion, raster, hillshade, background]`, fed a `distance` filter it answers `Unknown expression "distance"`, and it rejects unknown layout/paint properties. It does not reject unknown root keys, which is why the style's non-spec root `id: "bright"` passes everywhere (all three ignore it). `../analyze-style.ts` produces the inventory below; every property in it was cross-checked against the 1.13.3 spec's `sdk-support.basic functionality.js` entry.

## Deprecated-but-supported syntax the style relies on

The style predates expressions and uses the three v8 forms that the spec deprecated when expressions arrived (Mapbox GL style spec v13.0.0, shipped in mapbox-gl-js 0.41.0, 2017). All three renderers still accept them; this is the one place where the engines differ in mechanism rather than in result.

- Legacy filters: 124 of the 126 filters use the legacy grammar (`==`, `!=`, `<`, `<=`, `>=`, `in`, `!in`, `has`, `!has`, `all`, `any`, with `$type` for the geometry type). The remaining two, `["all"]` and `["all", ["has", "iata"]]`, are "neutral": both grammars parse them identically. mapbox-gl 1.13.3 converts legacy filters with `convertFilter` (`isExpressionFilter` decides per filter); maplibre style-spec 24.10.0 and 26.4.1 do the same in `feature_filter/convert.ts`. style-spec 26.4.1 (maplibre-gl 6) added a validator *warning* for filters that mix legacy syntax into an expression tree (`validate_filter.ts`); this style has no mixed filter, so none fires.
- Property functions: 117 zoom functions of the form `{"base": n, "stops": [[zoom, value], ...]}` with no `type` (so exponential, the v8 default) and no `property` (none is data-driven); 100 carry an explicit `base` (1, 1.2, 1.3, 1.4 or 1.5) and 17 default to 1. They drive `line-width` (77), `text-size` (14), `line-opacity` (12), `fill-opacity` (4), `symbol-placement` (3, a stepped enum function), `fill-color`, `fill-translate`, `icon-size` (2 each) and `fill-antialias` (1, a stepped boolean function). mapbox-gl 1.13.3 evaluates them through `createFunction`; both maplibre style-specs keep `function/index.ts` and wrap them in `StylePropertyFunction`. style-spec 26.4.1 additionally catches a throw *during evaluation* of a legacy function, logs one deduplicated `console.warn` and falls back to the spec default; nothing in this style throws (every stop value is well-typed), so that path is never taken.
- Token strings: `text-field` uses `{name:latin}`, `{name:latin} {name:nonlatin}`, `{name:latin}\n{name:nonlatin}` and `{ref}`; `icon-image` uses `{class}_11`, `{network}_{ref_length}` and `road_{ref_length}`. All three renderers resolve them per feature (`resolveTokens`); `../rewrite-style.ts` does not convert them to `format`/`concat` expressions because that would change the text the renderers lay out.

## Sprite and glyph coverage

Every constant icon the style names (`airport_11`, `oneway`, `star_11` for `icon-image`; `wave` for `fill-pattern`) exists in `sprite.json` (103 icons, the gh-pages build made from the same commit). The three token-driven `icon-image` values resolve per feature to `<class>_11`, `<network>_<ref_length>` and `road_<ref_length>`; a missing icon is a silent per-feature miss in all three renderers, not an error. The style requests exactly three fontstacks (`Noto Sans Regular`, `Noto Sans Bold`, `Noto Sans Italic`), each a single font, and `fetch.sh` verifies that `cache/glyphs/` holds all 256 ranges for each.

## Inventory

Generated by `bun run corpus/analyze-style.ts`; regenerate and replace this section after any change to `osm-bright.json`.

Style: `Bright`, version 8, 129 layers, 1 source (`openmaptiles`).

### Layer types

| type | layers |
| --- | --- |
| `background` | 1 |
| `fill` | 22 |
| `line` | 78 |
| `symbol` | 28 |

### Layer-level keys

| key | layers |
| --- | --- |
| `filter` | 126 |
| `id` | 129 |
| `layout` | 111 |
| `maxzoom` | 2 |
| `metadata` | 96 |
| `minzoom` | 33 |
| `paint` | 129 |
| `source` | 128 |
| `source-layer` | 128 |
| `type` | 129 |

### Layout properties

| property | layer types | layers | value forms |
| --- | --- | --- | --- |
| `icon-allow-overlap` | symbol | 1 | constant |
| `icon-ignore-placement` | symbol | 1 | constant |
| `icon-image` | symbol | 11 | constant, token string |
| `icon-optional` | symbol | 1 | constant |
| `icon-padding` | symbol | 2 | constant |
| `icon-rotate` | symbol | 2 | constant |
| `icon-rotation-alignment` | symbol | 5 | constant |
| `icon-size` | symbol | 7 | constant, zoom function |
| `line-cap` | line | 39 | constant |
| `line-join` | line | 56 | constant |
| `symbol-placement` | symbol | 12 | constant, zoom function |
| `symbol-spacing` | symbol | 9 | constant |
| `text-allow-overlap` | symbol | 1 | constant |
| `text-anchor` | symbol | 6 | constant |
| `text-field` | symbol | 26 | token string |
| `text-font` | symbol | 26 | font array |
| `text-ignore-placement` | symbol | 1 | constant |
| `text-letter-spacing` | symbol | 6 | constant |
| `text-max-width` | symbol | 20 | constant |
| `text-offset` | symbol | 6 | constant |
| `text-optional` | symbol | 2 | constant |
| `text-padding` | symbol | 5 | constant |
| `text-rotation-alignment` | symbol | 10 | constant |
| `text-size` | symbol | 26 | constant, zoom function |
| `text-transform` | symbol | 7 | constant |
| `visibility` | fill, line, symbol | 67 | constant |

### Paint properties

| property | layer types | layers | value forms |
| --- | --- | --- | --- |
| `background-color` | background | 1 | constant |
| `fill-antialias` | fill | 4 | constant, zoom function |
| `fill-color` | fill | 21 | constant, zoom function |
| `fill-opacity` | fill | 11 | constant, zoom function |
| `fill-outline-color` | fill | 3 | constant |
| `fill-pattern` | fill | 1 | constant |
| `fill-translate` | fill | 3 | constant, zoom function |
| `icon-opacity` | symbol | 2 | constant |
| `line-color` | line | 78 | constant |
| `line-dasharray` | line | 26 | constant |
| `line-opacity` | line | 28 | constant, zoom function |
| `line-width` | line | 78 | constant, zoom function |
| `text-color` | symbol | 25 | constant |
| `text-halo-blur` | symbol | 12 | constant |
| `text-halo-color` | symbol | 21 | constant |
| `text-halo-width` | symbol | 23 | constant |

### Filters

126 of 129 layers carry a `filter`: 124 legacy-syntax, 0 expression, 2 neutral (parsed identically by both grammars).
- `water-pattern`: `["all"]` (neutral)
- `airport-label-major`: `["all",["has","iata"]]` (neutral)

| operator | occurrences |
| --- | --- |
| `!=` | 36 |
| `!has` | 6 |
| `!in` | 25 |
| `<` | 1 |
| `<=` | 5 |
| `==` | 176 |
| `>=` | 5 |
| `all` | 106 |
| `any` | 3 |
| `has` | 9 |
| `in` | 47 |

Filter keys referenced: `$type`, `admin_level`, `brunnel`, `capital`, `class`, `disputed`, `iata`, `intermittent`, `iso_a2`, `level`, `maritime`, `name`, `network`, `oneway`, `ramp`, `rank`, `ref_length`, `service`, `subclass`.

### Expression operators inside property values

None. No layout or paint value is an expression array; the only string-led arrays are `text-font` font lists.

### Property functions (legacy `stops` objects)

117 property functions. Keys used: `base` (100), `stops` (117). `type` values: (absent, defaults to exponential) (117). `property` key present (data-driven): 0.

| property | functions |
| --- | --- |
| `fill-antialias` | 1 |
| `fill-color` | 2 |
| `fill-opacity` | 4 |
| `fill-translate` | 2 |
| `icon-size` | 2 |
| `line-opacity` | 12 |
| `line-width` | 77 |
| `symbol-placement` | 3 |
| `text-size` | 14 |

### Token strings

| value |
| --- |
| `"road_{ref_length}"` |
| `"{class}_11"` |
| `"{name:latin}"` |
| `"{name:latin}\n{name:nonlatin}"` |
| `"{name:latin} {name:nonlatin}"` |
| `"{network}_{ref_length}"` |
| `"{ref}"` |

### Sprite icons referenced

| property | value | sprite.json |
| --- | --- | --- |
| `fill-pattern` | `wave` | in sprite.json |
| `icon-image` | `airport_11` | in sprite.json |
| `icon-image` | `oneway` | in sprite.json |
| `icon-image` | `road_{ref_length}` | token, resolved per feature |
| `icon-image` | `star_11` | in sprite.json |
| `icon-image` | `{class}_11` | token, resolved per feature |
| `icon-image` | `{network}_{ref_length}` | token, resolved per feature |

sprite.json defines 103 icons.

### Fontstacks

| fontstack (as requested in `{fontstack}`) |
| --- |
| `Noto Sans Bold` |
| `Noto Sans Italic` |
| `Noto Sans Regular` |

