import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichRunFile, summarizes } from "../src/enrich";
import { buildRun, checkFleetRun, lineupOf, runMetadata, versionOf, type RunFile, type RunMetadata } from "../src/import";
import type { ProcessBytes } from "../src/memory";
import type { MemorySample, PassResult, RawResults } from "../src/run";

/** One measured pass whose every mark follows `idle`, so no two passes of a candidate measure alike. */
function pass(idle: number, warm: number): PassResult {
  return {
    startup: { importMs: idle / 50, styleLoadMs: idle / 20, firstTileMs: idle / 5, loadMs: idle / 3, firstIdleMs: idle },
    startupNoFade: { importMs: idle / 50, styleLoadMs: idle / 20, firstTileMs: idle / 5, loadMs: idle / 2, firstIdleMs: idle / 2 + 5 },
    geojsonMs: idle / 4,
    geojsonFeatures: 5000,
    coldViewsMs: Array.from({ length: 12 }, (_, i) => idle / 30 + i),
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

function bytes(renderer: number, gpu: number): ProcessBytes {
  return { renderer, gpu, utility: 0, browser: 0, total: renderer + gpu, processes: 2, measure: "private-bytes" };
}

/** One memory sample: the renderer grew by `idle` MB at first idle and by `path` MB after the camera path, the GPU process by a tenth of each. */
function memorySample(idle: number, path: number): MemorySample {
  return { baseline: bytes(100, 50), afterIdle: bytes(100 + idle, 50 + idle / 10), afterPath: bytes(100 + path, 50 + path / 10), jsHeapAfterIdleBytes: null, jsHeapAfterPathBytes: null, jsHeapScope: null };
}

const memory: RawResults["memory"] = {
  "mapbox-gl-1-13": [memorySample(300, 1300), memorySample(320, 1400)],
  "maplibre-gl-5": [memorySample(170, 900), memorySample(180, 920)],
  "maplibre-gl-6": [memorySample(160, 1000), memorySample(150, 1100)],
};

const withMemory: RawResults = { ...raw, memory, protocol: { ...raw.protocol, memorySamples: 2 } };

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
    for (const results of [raw, withMemory]) {
      const run = buildRun(results, meta);
      for (const s of run.sections) {
        for (const c of s.candidates) expect(new Set(c.samplesMs).size).toBeGreaterThan(1);
        for (const t of s.tests) {
          for (const r of t.results) {
            const samples = r.samples ?? [];
            expect(samples.length).toBe(s.id === "memory" ? results.protocol.memorySamples : results.protocol.passes);
            if (samples.length > 1) expect(new Set(samples).size).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  test("every test carries its per-pass samples and names the statistic its value is", () => {
    const run = buildRun(withMemory, meta);
    for (const s of run.sections) for (const t of s.tests) expect(t.statistic).toBe("mean");
    const loadNoFade = run.sections[0]!.tests.find((t) => t.id === "load-no-fade")!;
    expect(loadNoFade.results).toEqual([
      { candidateId: "mapbox-gl-1-13", value: 625, samples: [600, 650] },
      { candidateId: "maplibre-gl-5", value: 525, samples: [500, 550] },
      { candidateId: "maplibre-gl-6", value: 462.5, samples: [450, 475] },
    ]);
    const warmPaint = run.sections[1]!.tests.find((t) => t.id === "warm-paint")!;
    expect(warmPaint.results).toEqual([
      { candidateId: "mapbox-gl-1-13", value: 4.2, samples: [4.1, 4.3] },
      { candidateId: "maplibre-gl-5", value: 3.15, samples: [3.1, 3.2] },
      { candidateId: "maplibre-gl-6", value: 2.65, samples: [2.6, 2.7] },
    ]);
    expect(Object.keys(loadNoFade)).toEqual(["id", "title", "description", "unit", "lowerIsBetter", "results", "statistic"]);
    expect(Object.keys(loadNoFade.results[0]!)).toEqual(["candidateId", "value", "samples"]);
  });
});

describe("enrich", () => {
  const memoryOnly: RawResults = { ...withMemory, passes: [] };
  const fresh: RunFile = {
    ...buildRun(withMemory, meta),
    provenance: { kind: "fleet", commit: "a".repeat(40), rig: "r" },
    lineup: [{ candidateId: "maplibre-gl-6", package: "maplibre-gl", version: "6.13.0", integrity: "sha512-CCC=" }],
  };
  /** The same run as an importer that knew nothing of samples and statistics wrote it. */
  const bare: RunFile = {
    ...fresh,
    sections: fresh.sections.map((s) => ({ ...s, tests: s.tests.map(({ statistic: _statistic, ...t }) => ({ ...t, results: t.results.map(({ samples: _samples, ...r }) => r) })) })),
  };
  const bytesOf = (run: RunFile) => JSON.stringify(run, null, 2) + "\n";

  function workspace(): { dir: string; run: string; timing: string; memory: string } {
    const dir = mkdtempSync(join(tmpdir(), "wmr-enrich-"));
    const files = { dir, run: join(dir, "run.json"), timing: join(dir, "results-timing.json"), memory: join(dir, "results-memory.json") };
    writeFileSync(files.run, bytesOf(bare));
    writeFileSync(files.timing, JSON.stringify(raw));
    writeFileSync(files.memory, JSON.stringify(memoryOnly));
    return files;
  }

  test("the site's check: the samples' mean lands within half a unit of the value's last printed digit", () => {
    expect(summarizes(4.2, [4.1, 4.3])).toBe(true);
    expect(summarizes(6.5, [6.46, 6.54])).toBe(true);
    expect(summarizes(6.53, [6.5, 6.5])).toBe(false);
    expect(summarizes(203, [200, 207])).toBe(true);
    expect(summarizes(203, [200, 207.1])).toBe(false);
    expect(summarizes(203, [])).toBe(false);
  });

  test("a run published without them gets the fresh build's samples and statistics and nothing else changes", async () => {
    const files = workspace();
    try {
      expect(bytesOf(bare)).not.toBe(bytesOf(fresh));
      expect(await enrichRunFile(files.run, files.timing, files.memory)).toEqual({ tests: 11, results: 33 });
      const text = readFileSync(files.run, "utf8");
      expect(text).toBe(bytesOf(fresh));
      expect(JSON.parse(text)).toEqual(JSON.parse(bytesOf(fresh)));
      expect(await enrichRunFile(files.run, files.timing, files.memory)).toEqual({ tests: 11, results: 33 });
      expect(readFileSync(files.run, "utf8")).toBe(bytesOf(fresh));
    } finally {
      rmSync(files.dir, { recursive: true, force: true });
    }
  });

  test("refuses raw results that rebuild a different value, a missing memory file and a reformatted run, leaving the file alone", async () => {
    const files = workspace();
    try {
      await expect(enrichRunFile(files.run, files.timing)).rejects.toThrow("section memory is not in the rebuilt run");
      const perturbed: RawResults = { ...raw, passes: raw.passes.map((p) => (p.index === 2 ? { ...p, results: { ...p.results, "maplibre-gl-6": { ...p.results["maplibre-gl-6"]!, geojsonMs: 999 } } } : p)) };
      writeFileSync(files.timing, JSON.stringify(perturbed));
      await expect(enrichRunFile(files.run, files.timing, files.memory)).rejects.toThrow("startup/geojson-5k/maplibre-gl-6: published 231.3, rebuilt 612");
      expect(readFileSync(files.run, "utf8")).toBe(bytesOf(bare));
      writeFileSync(files.timing, JSON.stringify(raw));
      writeFileSync(files.run, JSON.stringify(bare, null, 4) + "\n");
      await expect(enrichRunFile(files.run, files.timing, files.memory)).rejects.toThrow("not formatted as the importer writes it");
    } finally {
      rmSync(files.dir, { recursive: true, force: true });
    }
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
