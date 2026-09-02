export type CandidateId = "mapbox-gl-1-13" | "maplibre-gl-5" | "maplibre-gl-6";

export interface CandidateMeta {
  id: CandidateId;
  /** Display name; carries the major version so verdict headlines can tell the two MapLibre builds apart. */
  name: string;
  version: string;
  /** Directory under node_modules whose dist/ the server exposes at /vendor/<id>/. */
  pkg: string;
  kind: "umd" | "esm";
  js: string;
  css: string;
  /** Global a UMD build defines. */
  global?: string;
  /** Every dist file the browser downloads for this candidate, worker included; the bundle-size metric sums them. */
  files: string[];
  color: string;
  homepage: string;
  license: string;
  webgl: string;
}

export const CANDIDATES: Record<CandidateId, CandidateMeta> = {
  "mapbox-gl-1-13": {
    id: "mapbox-gl-1-13",
    name: "Mapbox GL JS 1.13",
    version: "1.13.3",
    pkg: "mapbox-gl",
    kind: "umd",
    js: "mapbox-gl.js",
    css: "mapbox-gl.css",
    global: "mapboxgl",
    files: ["mapbox-gl.js"],
    color: "#4264FB",
    homepage: "https://github.com/mapbox/mapbox-gl-js/tree/v1.13.3",
    license: "BSD-3-Clause",
    webgl: "WebGL 1",
  },
  "maplibre-gl-5": {
    id: "maplibre-gl-5",
    name: "MapLibre GL JS 5",
    version: "5.24.0",
    pkg: "maplibre-gl-5",
    kind: "umd",
    js: "maplibre-gl.js",
    css: "maplibre-gl.css",
    global: "maplibregl",
    files: ["maplibre-gl.js"],
    color: "#295DAA",
    homepage: "https://maplibre.org/maplibre-gl-js/docs/",
    license: "BSD-3-Clause",
    webgl: "WebGL 2 with WebGL 1 fallback",
  },
  "maplibre-gl-6": {
    id: "maplibre-gl-6",
    name: "MapLibre GL JS 6",
    version: "6.7.0",
    pkg: "maplibre-gl-6",
    kind: "esm",
    js: "maplibre-gl.mjs",
    css: "maplibre-gl.css",
    files: ["maplibre-gl.mjs", "maplibre-gl-shared.mjs", "maplibre-gl-worker.mjs"],
    color: "#3FB1CE",
    homepage: "https://maplibre.org/maplibre-gl-js/docs/",
    license: "BSD-3-Clause",
    webgl: "WebGL 2",
  },
};

/** Candidates in the order the site lists them. */
export const CANDIDATE_ORDER: CandidateId[] = ["mapbox-gl-1-13", "maplibre-gl-5", "maplibre-gl-6"];

/** The candidate the parity gate compares the others against: the fork point. */
export const REFERENCE: CandidateId = "mapbox-gl-1-13";

export interface Protocol {
  warmups: number;
  passes: number;
  coldViews: number;
  warmSteps: number;
  memorySamples: number;
  idleTimeoutMs: number;
}

export function protocol(smoke: boolean): Protocol {
  return smoke
    ? { warmups: 0, passes: 1, coldViews: 12, warmSteps: 60, memorySamples: 1, idleTimeoutMs: 60_000 }
    : { warmups: 2, passes: 15, coldViews: 60, warmSteps: 600, memorySamples: 15, idleTimeoutMs: 60_000 };
}

export const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 } as const;

/** Map constructor options every candidate gets. maxTileCacheSize is raised so the warm traversal is warm; the rest are the shared defaults, spelled out. */
export const MAP_OPTIONS = {
  maxTileCacheSize: 10_000,
  fadeDuration: 300,
  attributionControl: false,
  interactive: false,
  trackResize: false,
} as const;

/**
 * Parity gate tolerances. A source layer's distinct rendered-feature count may differ from the reference by 10% or
 * 5 features, whichever is larger. Source layers drawn only by symbol layers get 25%, because label collision is a
 * renderer decision (MapLibre 6 overscales four zoom levels past a source's maxzoom specifically to place labels
 * differently); a blank canvas still trips it. Frozen after calibration on the first smoke run, 2026-09-02.
 */
export const GATE = { relativeTolerance: 0.1, absoluteTolerance: 5, symbolRelativeTolerance: 0.25, pixelThreshold: 0.1 } as const;

/** OpenMapTiles source layers that OSM Bright draws only with symbol layers. */
export const SYMBOL_ONLY_SOURCE_LAYERS = new Set(["poi", "place", "transportation_name", "water_name", "housenumber", "mountain_peak", "aerodrome_label"]);
