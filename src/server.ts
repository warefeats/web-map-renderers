import { Database, type Statement } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { CANDIDATES, type CandidateId } from "./matrix";

export interface Counters {
  tiles: number;
  tilesMissing: number;
  tileBytes: number;
  glyphs: number;
  sprite: number;
  vendor: number;
  fixtures: number;
  other: number;
  notFound: number;
}

export interface BenchServer {
  origin: string;
  port: number;
  counters: Counters;
  resetCounters(): void;
  stop(): void;
}

export interface ServerOptions {
  root: string;
  port?: number;
  mbtiles?: string;
}

/** Headers on every response: cross-origin isolation for 5 µs timers, and no caching so a fresh context really is fresh. */
const COMMON_HEADERS: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".png": "image/png",
  ".pbf": "application/x-protobuf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

export function freshCounters(): Counters {
  return { tiles: 0, tilesMissing: 0, tileBytes: 0, glyphs: 0, sprite: 0, vendor: 0, fixtures: 0, other: 0, notFound: 0 };
}

/** The style ships with `{origin}` placeholders; the server fills in its own origin so every URL in it is loopback. */
export function rewriteStyle(styleJson: string, origin: string): string {
  return styleJson.replaceAll("{origin}", origin);
}

/** MBTiles stores rows in TMS order: the y axis is flipped relative to the XYZ scheme the renderers request. */
export function tmsRow(z: number, y: number): number {
  return (1 << z) - 1 - y;
}

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 && CONTENT_TYPES[path.slice(dot)]) || "application/octet-stream";
}

/** Refuses any resolved path that escapes its base directory. */
function safeJoin(base: string, ...parts: string[]): string | null {
  const full = normalize(join(base, ...parts));
  const root = normalize(base).replace(/[\\/]+$/, "");
  return full === root || full.startsWith(root + sep) ? full : null;
}

function file(path: string | null, headers: Record<string, string> = {}): Response {
  if (!path || !existsSync(path)) return new Response("not found", { status: 404, headers: COMMON_HEADERS });
  return new Response(Bun.file(path), { headers: { ...COMMON_HEADERS, "Content-Type": contentType(path), ...headers } });
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function startServer(opts: ServerOptions): BenchServer {
  const root = opts.root;
  const pagesDir = join(root, "page");
  const styleDir = join(root, "corpus", "style");
  const glyphsDir = join(root, "corpus", "cache", "glyphs");
  const fixturesDir = join(root, "corpus", "fixtures");
  const mbtilesPath = opts.mbtiles ?? join(root, "corpus", "cache", "berlin.mbtiles");
  const stylePath = join(styleDir, "osm-bright.json");
  const styleText = existsSync(stylePath) ? readFileSync(stylePath, "utf8") : null;

  let db: Database | null = null;
  let tileStmt: Statement<{ tile_data: Uint8Array }, [number, number, number]> | null = null;
  if (existsSync(mbtilesPath)) {
    db = new Database(mbtilesPath, { readonly: true });
    tileStmt = db.query<{ tile_data: Uint8Array }, [number, number, number]>(
      "SELECT tile_data FROM tiles WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3",
    );
  }

  let counters = freshCounters();
  const candidatesJson = JSON.stringify(
    Object.fromEntries(Object.values(CANDIDATES).map((c) => [c.id, { id: c.id, kind: c.kind, js: c.js, css: c.css, global: c.global ?? null }])),
  );

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);
      const origin = url.origin;

      if (path === "/" || path === "/index.html") return file(join(pagesDir, "index.html"));
      if (path === "/bench.js") return file(join(pagesDir, "bench.js"));
      if (path === "/blank.html") return file(join(pagesDir, "blank.html"));
      if (path === "/candidates.json") return new Response(candidatesJson, { headers: { ...COMMON_HEADERS, "Content-Type": CONTENT_TYPES[".json"]! } });

      if (path === "/style.json") {
        if (!styleText) return new Response("style missing: run just corpus-fetch", { status: 503, headers: COMMON_HEADERS });
        return new Response(rewriteStyle(styleText, origin), { headers: { ...COMMON_HEADERS, "Content-Type": CONTENT_TYPES[".json"]! } });
      }

      const tile = path.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      if (tile) {
        counters.tiles++;
        if (!tileStmt) return new Response("tiles missing: run just corpus-tiles", { status: 503, headers: COMMON_HEADERS });
        const z = Number(tile[1]);
        const x = Number(tile[2]);
        const y = Number(tile[3]);
        const row = tileStmt.get(z, x, tmsRow(z, y));
        if (!row) {
          counters.tilesMissing++;
          return new Response(null, { status: 204, headers: COMMON_HEADERS });
        }
        const bytes = row.tile_data;
        counters.tileBytes += bytes.byteLength;
        const headers: Record<string, string> = { ...COMMON_HEADERS, "Content-Type": CONTENT_TYPES[".pbf"]! };
        if (isGzip(bytes)) headers["Content-Encoding"] = "gzip";
        return new Response(bytes as unknown as BodyInit, { headers });
      }

      const glyph = path.match(/^\/glyphs\/([^/]+)\/(\d+-\d+)\.pbf$/);
      if (glyph) {
        counters.glyphs++;
        return file(safeJoin(glyphsDir, glyph[1]!, `${glyph[2]}.pbf`));
      }

      const sprite = path.match(/^\/sprite\/(sprite(?:@2x)?\.(?:json|png))$/);
      if (sprite) {
        counters.sprite++;
        return file(safeJoin(styleDir, sprite[1]!));
      }

      const vendor = path.match(/^\/vendor\/([^/]+)\/([^/]+)$/);
      if (vendor) {
        counters.vendor++;
        const meta = CANDIDATES[vendor[1] as CandidateId];
        if (!meta) return new Response("unknown candidate", { status: 404, headers: COMMON_HEADERS });
        return file(safeJoin(root, "node_modules", meta.pkg, "dist", vendor[2]!));
      }

      const fixture = path.match(/^\/fixtures\/([^/]+)$/);
      if (fixture) {
        counters.fixtures++;
        return file(safeJoin(fixturesDir, fixture[1]!));
      }

      counters.other++;
      counters.notFound++;
      return new Response("not found", { status: 404, headers: COMMON_HEADERS });
    },
  });

  return {
    origin: `http://127.0.0.1:${server.port ?? 0}`,
    port: server.port ?? 0,
    get counters() {
      return counters;
    },
    resetCounters() {
      counters = freshCounters();
    },
    stop() {
      server.stop(true);
      db?.close();
    },
  };
}

if (import.meta.main) {
  const root = join(import.meta.dirname!, "..");
  const portArg = process.argv.find((a) => a.startsWith("--port="))?.split("=")[1];
  const srv = startServer({ root, port: portArg ? Number(portArg) : 8787 });
  console.log(`serving ${root} at ${srv.origin}`);
  console.log(`try ${srv.origin}/?candidate=maplibre-gl-6 and call bench.loadLib / bench.start from the console`);
}
