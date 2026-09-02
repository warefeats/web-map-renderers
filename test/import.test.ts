import { describe, expect, test } from "bun:test";
import { buildRun, type RunMetadata } from "../src/import";
import type { PassResult, RawResults } from "../src/run";

function pass(idle: number, warm: number): PassResult {
  return {
    startup: { importMs: 50, styleLoadMs: 100, firstTileMs: 200, loadMs: 400, firstIdleMs: idle },
    geojsonMs: 300,
    geojsonFeatures: 5000,
    coldViewsMs: Array.from({ length: 12 }, (_, i) => 40 + i),
    warmStepsMs: Array.from({ length: 60 }, (_, i) => warm + (i % 3) * 0.1),
    tileRequests: 120,
    tilesMissing: 0,
    tileBytes: 1_000_000,
    glyphRequests: 10,
    pageErrors: [],
    mapErrors: [],
    consoleWarnings: 0,
  };
}

const raw: RawResults = {
  schemaVersion: 1,
  smoke: false,
  generatedAt: "2026-09-03T10:00:00.000Z",
  startedAt: "",
  finishedAt: "",
  durationMs: 0,
  rig: { platform: "win32", machine: "m", chip: "c", cores: "8", memory: "24 GB", os: "Windows 11 Pro 24H2 (build 26100)", arch: "x64", gpu: "AMD Radeon(TM) Graphics, driver 1", display: "1920x1080" },
  browser: { chromium: "151", webgl1: "ANGLE D3D11", webgl2: "ANGLE D3D11", devices: [], features: {}, hardwareConcurrency: 16, playwright: "1.62.1", args: [] },
  harness: { bun: "1.4.0", platform: "win32" },
  protocol: {
    warmups: 1,
    passes: 2,
    coldViews: 12,
    warmSteps: 60,
    memorySamples: 2,
    idleTimeoutMs: 1000,
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    mapOptions: { fadeDuration: 300, attributionControl: false, interactive: false, trackResize: false, maxTileCacheSize: 10000 },
    memoryMapOptions: { fadeDuration: 300, attributionControl: false, interactive: false, trackResize: false },
    gate: { relativeTolerance: 0.1, absoluteTolerance: 5, symbolRelativeTolerance: 0.25, pixelThreshold: 0.1 },
    reference: "mapbox-gl-1-13",
    coldAdvance: "",
    warmAdvance: "",
    memoryMeasure: "private bytes",
  },
  candidates: (["mapbox-gl-1-13", "maplibre-gl-5", "maplibre-gl-6"] as const).map((id) => ({
    id,
    name: id,
    version: "0",
    pkg: "",
    kind: "umd",
    js: "",
    css: "",
    files: [],
    color: "",
    homepage: "",
    license: "",
    webgl: "",
    bytes: { raw: 1, gzip: 1, brotli: 1, files: {} },
    libraryVersion: null,
    workerCount: null,
  })),
  passes: [
    { index: 0, warmup: true, order: [], results: { "mapbox-gl-1-13": pass(9999, 99), "maplibre-gl-5": pass(9999, 99), "maplibre-gl-6": pass(9999, 99) } },
    { index: 1, warmup: false, order: [], results: { "mapbox-gl-1-13": pass(1200, 4), "maplibre-gl-5": pass(1000, 3), "maplibre-gl-6": pass(900, 2.5) } },
    { index: 2, warmup: false, order: [], results: { "mapbox-gl-1-13": pass(1300, 4.2), "maplibre-gl-5": pass(1100, 3.1), "maplibre-gl-6": pass(950, 2.6) } },
  ],
  gate: { pass: 1, viewpoints: {}, pixelDiff: {}, violations: [], ok: true },
  memory: {},
  violations: [],
  failures: [],
};

const meta: RunMetadata = {
  id: "2026-09-03-test",
  label: "test",
  publishedAt: "2026-09-03",
  environment: { machine: "m", chip: "c", cores: "8", memory: "24 GB", os: "w", arch: "x64", runtime: "r" },
  protocol: { warmups: 1, runs: 2, processModel: "", cacheState: "", output: "" },
};

describe("import", () => {
  test("ignores warmup passes and ranks sections by mean", () => {
    const run = buildRun(raw, meta);
    expect(run.sections.map((s) => s.id)).toEqual(["startup", "frame-time"]);
    const startup = run.sections[0]!;
    expect(startup.candidates[0]!.samplesMs).toEqual([1200, 1300]);
    expect(startup.verdict.winnerId).toBe("maplibre-gl-6");
    const frame = run.sections[1]!;
    expect(frame.verdict.winnerId).toBe("maplibre-gl-6");
    expect(frame.candidates.find((c) => c.id === "mapbox-gl-1-13")!.statistics.meanMs).toBeCloseTo(4.2, 0);
  });

  test("keeps the site's candidate order regardless of pass order", () => {
    const run = buildRun(raw, meta);
    expect(run.sections[0]!.candidates.map((c) => c.id)).toEqual(["mapbox-gl-1-13", "maplibre-gl-5", "maplibre-gl-6"]);
  });

  test("samples are independently measured, never replicated", () => {
    const run = buildRun(raw, meta);
    for (const s of run.sections) for (const c of s.candidates) expect(new Set(c.samplesMs).size).toBeGreaterThan(1);
  });
});
