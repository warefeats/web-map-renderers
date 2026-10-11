import { describe, expect, test } from "bun:test";
import { buildRun, checkFleetRun, lineupOf, runMetadata, versionOf, type RunMetadata } from "../src/import";
import type { PassResult, RawResults } from "../src/run";

function pass(idle: number, warm: number): PassResult {
  return {
    startup: { importMs: 50, styleLoadMs: 100, firstTileMs: 200, loadMs: 400, firstIdleMs: idle },
    startupNoFade: { importMs: 50, styleLoadMs: 100, firstTileMs: 200, loadMs: idle / 2, firstIdleMs: idle / 2 + 5 },
    geojsonMs: 300,
    geojsonFeatures: 5000,
    coldViewsMs: Array.from({ length: 12 }, (_, i) => 40 + i),
    warmStepsMs: Array.from({ length: 60 }, (_, i) => warm + (i % 3) * 0.1),
    tileRequests: 120,
    tilesMissing: 0,
    tileBytes: 1_000_000,
    warmTileRequests: 0,
    glyphRequests: 10,
    pageErrors: [],
    mapErrors: [],
    consoleWarnings: 0,
    libraryVersion: null,
    workerCount: 2,
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
  browserRelaunches: [],
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
    expect(startup.candidates[0]!.samplesMs).toEqual([600, 650]);
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

describe("fleet runs", () => {
  const versioned: RawResults = {
    ...raw,
    candidates: raw.candidates.map((c) => ({ ...c, version: c.id === "maplibre-gl-6" ? "6.13.0" : c.id === "maplibre-gl-5" ? "5.24.0" : "1.13.3", libraryVersion: null })),
  };
  const lock = [
    '    "mapbox-gl": ["mapbox-gl@1.13.3", "", { "dependencies": { "pbf": "^3.2.1" } }, "sha512-AAA="],',
    '    "maplibre-gl-5": ["maplibre-gl@5.24.0", "", { "dependencies": {} }, "sha512-BBB="],',
    '    "maplibre-gl-6": ["maplibre-gl@6.13.0", "", { "dependencies": {} }, "sha512-CCC="],',
  ].join("\n");

  test("versions come from the run, so a bump needs no matrix edit", () => {
    expect(versionOf(versioned, "maplibre-gl-6")).toBe("6.13.0");
    const reported = { ...versioned, candidates: versioned.candidates.map((c) => ({ ...c, libraryVersion: c.version })) };
    expect(buildRun(reported, meta).sections[0]!.candidates.find((c) => c.id === "maplibre-gl-6")!.version).toBe("6.13.0");
  });

  test("the label carries the date, the GPU keeps the recorded driver, and a smoke run says so in its id", () => {
    const m = runMetadata(versioned, { fleet: true, rig: "radeon-680m-win11", gpuShort: "Radeon 680M", osShort: "Windows 11", gpuName: "AMD Radeon 680M" });
    expect(m.id).toBe("2026-09-03-radeon-680m-win11");
    expect(m.label).toBe("Radeon 680M / Windows 11, 2026-09-03");
    expect(m.environment.gpu).toBe("AMD Radeon 680M, driver 1");
    expect(runMetadata({ ...versioned, smoke: true }, { fleet: true, rig: "r" }).id).toBe("2026-09-03-r-smoke");
    expect(runMetadata(versioned, { rig: "r" }).label).toBe("AMD Radeon(TM) Graphics / Windows 11 Pro 24H2 (local)");
  });

  test("the lineup pins each candidate's package and integrity from bun.lock", () => {
    expect(lineupOf(versioned, lock)).toEqual([
      { candidateId: "mapbox-gl-1-13", package: "mapbox-gl", version: "1.13.3", integrity: "sha512-AAA=" },
      { candidateId: "maplibre-gl-5", package: "maplibre-gl", version: "5.24.0", integrity: "sha512-BBB=" },
      { candidateId: "maplibre-gl-6", package: "maplibre-gl", version: "6.13.0", integrity: "sha512-CCC=" },
    ]);
    expect(() => lineupOf(versioned, lock.replace("6.13.0", "6.12.0"))).toThrow("bun.lock pins 6.12.0");
  });

  test("refuses smoke runs, failed gates, failed passes, a missing commit and a version mismatch", () => {
    const commit = "a".repeat(40);
    expect(() => checkFleetRun(versioned, { allowSmoke: false, commit })).not.toThrow();
    expect(() => checkFleetRun({ ...versioned, smoke: true }, { allowSmoke: false, commit })).toThrow("smoke");
    expect(() => checkFleetRun({ ...versioned, smoke: true }, { allowSmoke: true, commit })).not.toThrow();
    expect(() => checkFleetRun({ ...versioned, gate: { ...versioned.gate, ok: false } }, { allowSmoke: false, commit })).toThrow("parity gate");
    expect(() => checkFleetRun({ ...versioned, failures: [{ candidate: "maplibre-gl-6", pass: 1, phase: "pass", message: "x" }] }, { allowSmoke: false, commit })).toThrow("failed pass");
    expect(() => checkFleetRun({ ...versioned, failures: [{ candidate: null, pass: 0, phase: "memory", message: "x" }] }, { allowSmoke: false, commit })).not.toThrow();
    expect(() => checkFleetRun(versioned, { allowSmoke: false })).toThrow("--commit");
    const mismatch = { ...versioned, candidates: versioned.candidates.map((c) => ({ ...c, libraryVersion: c.id === "maplibre-gl-6" ? "6.12.0" : null })) };
    expect(() => checkFleetRun(mismatch, { allowSmoke: false, commit })).toThrow("reported 6.12.0");
  });
});
