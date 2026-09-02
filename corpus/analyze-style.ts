// analyze-style.ts — inventory of everything style/osm-bright.json asks a renderer to support, as Markdown.
//
// Lists layer types, layer-level keys, every layout and paint property with the value forms it takes (constant,
// zoom function, token string), every filter operator with a legacy-vs-expression classification, any expression
// operators found inside property values, property-function details, token strings, sprite icons referenced against
// style/sprite.json, and the fontstacks. style/COMPATIBILITY.md embeds this output; regenerate with
//   bun run corpus/analyze-style.ts
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const style = await Bun.file(join(here, "style", "osm-bright.json")).json();
const sprite = await Bun.file(join(here, "style", "sprite.json")).json();
const layers: Array<Record<string, any>> = style.layers;

const count = <T>(xs: Iterable<T>) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
};
const isFunction = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && "stops" in (v as object);
const isTokenString = (v: unknown) => typeof v === "string" && /\{[^}]+\}/.test(v);
const isExpression = (v: unknown) => Array.isArray(v) && v.length > 0 && typeof v[0] === "string";
const form = (k: string, v: unknown) => {
  if (isFunction(v)) return "zoom function";
  if (k === "text-font") return "font array";
  if (isExpression(v)) return "expression";
  if (isTokenString(v)) return "token string";
  return "constant";
};

// Classification used by the MapLibre style-spec (and, without the "neutral" bucket, by mapbox-gl 1.13):
// legacy filters and expression filters share operator names, so each filter is inspected structurally.
// "neutral" means both grammars parse it identically (a bare ["has", key] or an ["all", ...] of such).
type FilterKind = "legacy" | "neutral" | "expression";
const classifyFilter = (f: unknown): FilterKind => {
  if (typeof f === "boolean") return "expression";
  if (!Array.isArray(f) || f.length < 1) return "legacy";
  switch (f[0]) {
    case "has":
      return f.length < 2 || f[1] === "$id" || f[1] === "$type" ? "legacy" : f.length === 2 ? "neutral" : "expression";
    case "in":
      return f.length >= 3 && (typeof f[1] !== "string" || Array.isArray(f[2])) ? "expression" : "legacy";
    case "!in":
    case "!has":
      return "legacy";
    case "==":
    case "!=":
    case ">":
    case ">=":
    case "<":
    case "<=":
      return f.length !== 3 || Array.isArray(f[1]) || Array.isArray(f[2]) ? "expression" : "legacy";
    case "any":
    case "all": {
      let legacy = false;
      for (const sub of f.slice(1)) {
        const kind = classifyFilter(sub);
        if (kind === "expression") return "expression";
        if (kind === "legacy") legacy = true;
      }
      return legacy ? "legacy" : "neutral";
    }
    default:
      return "expression";
  }
};
const filterOps = (f: unknown, acc: string[] = []) => {
  if (Array.isArray(f) && typeof f[0] === "string") {
    acc.push(f[0]);
    if (f[0] === "all" || f[0] === "any" || f[0] === "none") f.slice(1).forEach((s) => filterOps(s, acc));
  }
  return acc;
};

const md: string[] = [];
const out = (s = "") => md.push(s);
const table = (header: string[], rows: string[][]) => {
  out(`| ${header.join(" | ")} |`);
  out(`| ${header.map(() => "---").join(" | ")} |`);
  for (const r of rows) out(`| ${r.join(" | ")} |`);
  out();
};

out(`Style: \`${style.name}\`, version ${style.version}, ${layers.length} layers, ${Object.keys(style.sources).length} source (\`${Object.keys(style.sources).join("`, `")}\`).`);
out();

out("### Layer types");
out();
table(["type", "layers"], count(layers.map((l) => l.type)).map(([t, n]) => [`\`${t}\``, String(n)]));

out("### Layer-level keys");
out();
table(["key", "layers"], count(layers.flatMap((l) => Object.keys(l))).map(([k, n]) => [`\`${k}\``, String(n)]));

for (const section of ["layout", "paint"] as const) {
  out(`### ${section.charAt(0).toUpperCase()}${section.slice(1)} properties`);
  out();
  const rows = new Map<string, { types: Set<string>; layers: number; forms: Set<string> }>();
  for (const l of layers) {
    for (const [k, v] of Object.entries(l[section] ?? {})) {
      const r = rows.get(k) ?? { types: new Set(), layers: 0, forms: new Set() };
      r.types.add(l.type);
      r.layers++;
      r.forms.add(form(k, v));
      rows.set(k, r);
    }
  }
  table(
    ["property", "layer types", "layers", "value forms"],
    [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => [`\`${k}\``, [...r.types].sort().join(", "), String(r.layers), [...r.forms].sort().join(", ")]),
  );
}

out("### Filters");
out();
const filtered = layers.filter((l) => l.filter !== undefined);
const kinds = count(filtered.map((l) => classifyFilter(l.filter)));
const kindCount = (k: FilterKind) => kinds.find(([kind]) => kind === k)?.[1] ?? 0;
out(`${filtered.length} of ${layers.length} layers carry a \`filter\`: ${kindCount("legacy")} legacy-syntax, ${kindCount("expression")} expression, ${kindCount("neutral")} neutral (parsed identically by both grammars).`);
for (const l of filtered) {
  const kind = classifyFilter(l.filter);
  if (kind !== "legacy") out(`- \`${l.id}\`: \`${JSON.stringify(l.filter)}\` (${kind})`);
}
out();
table(["operator", "occurrences"], count(filtered.flatMap((l) => filterOps(l.filter))).map(([op, n]) => [`\`${op}\``, String(n)]));
const typeKeys = new Set<string>();
const walkFilterKeys = (f: unknown) => {
  if (!Array.isArray(f)) return;
  if (["all", "any", "none"].includes(f[0])) f.slice(1).forEach(walkFilterKeys);
  else if (typeof f[1] === "string") typeKeys.add(f[1]);
};
filtered.forEach((l) => walkFilterKeys(l.filter));
out(`Filter keys referenced: ${[...typeKeys].sort().map((k) => `\`${k}\``).join(", ")}.`);
out();

out("### Expression operators inside property values");
out();
const exprOps: string[] = [];
const walkExpr = (v: unknown) => {
  if (isExpression(v)) {
    exprOps.push((v as unknown[])[0] as string);
    (v as unknown[]).slice(1).forEach(walkExpr);
  } else if (Array.isArray(v)) v.forEach(walkExpr);
  else if (v && typeof v === "object") Object.values(v as object).forEach(walkExpr);
};
for (const l of layers) {
  for (const [k, v] of Object.entries({ ...(l.layout ?? {}), ...(l.paint ?? {}) })) {
    if (k === "text-font") continue;
    walkExpr(v);
  }
}
if (exprOps.length === 0) out("None. No layout or paint value is an expression array; the only string-led arrays are `text-font` font lists.");
else table(["operator", "occurrences"], count(exprOps).map(([op, n]) => [`\`${op}\``, String(n)]));
out();

out("### Property functions (legacy `stops` objects)");
out();
const fns: Array<{ prop: string; fn: Record<string, unknown> }> = [];
for (const l of layers) {
  for (const [k, v] of Object.entries({ ...(l.layout ?? {}), ...(l.paint ?? {}) })) if (isFunction(v)) fns.push({ prop: k, fn: v as Record<string, unknown> });
}
out(`${fns.length} property functions. Keys used: ${count(fns.flatMap((f) => Object.keys(f.fn))).map(([k, n]) => `\`${k}\` (${n})`).join(", ")}. \`type\` values: ${count(fns.map((f) => String(f.fn.type ?? "(absent, defaults to exponential)"))).map(([k, n]) => `${k} (${n})`).join(", ")}. \`property\` key present (data-driven): ${fns.filter((f) => "property" in f.fn).length}.`);
out();
table(["property", "functions"], count(fns.map((f) => f.prop)).map(([k, n]) => [`\`${k}\``, String(n)]));

out("### Token strings");
out();
const tokens = new Set<string>();
for (const l of layers) for (const v of Object.values(l.layout ?? {})) if (isTokenString(v)) tokens.add(v as string);
table(["value"], [...tokens].sort().map((t) => [`\`${JSON.stringify(t)}\``]));

out("### Sprite icons referenced");
out();
const iconRefs = new Map<string, Set<string>>();
for (const l of layers) {
  for (const [k, v] of Object.entries({ ...(l.layout ?? {}), ...(l.paint ?? {}) })) {
    if (k !== "icon-image" && k !== "fill-pattern") continue;
    const s = iconRefs.get(k) ?? new Set();
    s.add(typeof v === "string" ? v : JSON.stringify(v));
    iconRefs.set(k, s);
  }
}
const rows: string[][] = [];
for (const [k, vals] of iconRefs) {
  for (const v of [...vals].sort()) {
    const status = isTokenString(v) ? "token, resolved per feature" : v in sprite ? "in sprite.json" : "MISSING from sprite.json";
    rows.push([`\`${k}\``, `\`${v}\``, status]);
  }
}
table(["property", "value", "sprite.json"], rows);
out(`sprite.json defines ${Object.keys(sprite).length} icons.`);
out();

out("### Fontstacks");
out();
const stacks = new Set<string>();
for (const l of layers) if (Array.isArray(l.layout?.["text-font"])) stacks.add(l.layout["text-font"].join(","));
table(["fontstack (as requested in `{fontstack}`)"], [...stacks].sort().map((s) => [`\`${s}\``]));

process.stdout.write(md.join("\n"));
