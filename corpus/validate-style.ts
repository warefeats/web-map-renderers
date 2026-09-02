// validate-style.ts — run style/osm-bright.json through the style-spec validator that ships with each renderer
// under test, so the compatibility claims in style/COMPATIBILITY.md rest on the renderers' own validators.
//
//   mapbox-gl 1.13.3      -> its bundled dist/style-spec (validate)
//   maplibre-gl 5.24.0    -> @maplibre/maplibre-gl-style-spec resolved from maplibre-gl-5's own dependency tree
//   maplibre-gl 6.7.0     -> @maplibre/maplibre-gl-style-spec resolved from maplibre-gl-6's own dependency tree
//
// Run from the repo root after `bun install`: bun run corpus/validate-style.ts [origin]
// The {origin} placeholder is substituted (default http://127.0.0.1:8787) so URL-shaped checks see a real origin.
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const repoRoot = join(here, "..");
const origin = Bun.argv[2] ?? "http://127.0.0.1:8787";
const raw = await Bun.file(join(here, "style", "osm-bright.json")).text();
const style = JSON.parse(raw.replaceAll("{origin}", origin));

type Err = { message: string; line?: number };
const report = (name: string, version: string, errors: Err[]) => {
  console.log(`${name} ${version}: ${errors.length === 0 ? "no errors" : `${errors.length} error(s)`}`);
  for (const e of errors) console.log(`  - ${e.message}`);
};

// mapbox-gl 1.13.3 style-spec (CommonJS bundle)
{
  const mbPkg = await Bun.file(join(repoRoot, "node_modules", "mapbox-gl", "package.json")).json();
  const spec = require(join(repoRoot, "node_modules", "mapbox-gl", "dist", "style-spec", "index.js"));
  report("mapbox-gl", mbPkg.version, spec.validate(style));
}

// maplibre style-spec as resolved from each maplibre-gl alias
for (const alias of ["maplibre-gl-5", "maplibre-gl-6"]) {
  const entry = Bun.resolveSync(alias, repoRoot);
  const pkgDir = entry.slice(0, entry.lastIndexOf("/dist/"));
  const glPkg = await Bun.file(join(pkgDir, "package.json")).json();
  const specEntry = Bun.resolveSync("@maplibre/maplibre-gl-style-spec", pkgDir);
  const specDir = specEntry.slice(0, specEntry.lastIndexOf("/dist/"));
  const specPkg = await Bun.file(join(specDir, "package.json")).json();
  const spec = await import(specEntry);
  const validate = spec.validateStyleMin ?? spec.validate;
  report(`maplibre-gl ${glPkg.version} (style-spec`, `${specPkg.version})`, validate(style));
}
