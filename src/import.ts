import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CANDIDATES, CANDIDATE_ORDER, type CandidateId } from "./matrix";
import type { PassResult, RawResults, StartupMarks } from "./run";
import { type Statistics, mean, percentile, round, statistics } from "./stats";

export interface Environment {
  machine: string;
  chip: string;
  cores: string;
  memory: string;
  os: string;
  arch: string;
  runtime: string;
  gpu?: string;
  browser?: string;
  display?: string;
}

export interface RunMetadata {
  id: string;
  label: string;
  publishedAt: string;
  environment: Environment;
  protocol: { warmups: number; runs: number; processModel: string; cacheState: string; output: string };
}

export type Metric = { value: number; unit: string; label?: string };

export interface Candidate {
  id: string;
  name: string;
  version: string;
  color?: string;
  homepage?: string;
  statistics: Statistics;
  samplesMs: number[];
  metrics?: Record<string, Metric>;
}

export interface BenchmarkTest {
  id: string;
  title: string;
  description: string;
  unit: string;
  lowerIsBetter: boolean;
  results: { candidateId: string; value: number }[];
}

export interface BenchmarkSection {
  id: string;
  title: string;
  deck: string;
  unit: string;
  lowerIsBetter: boolean;
  verdict: { winnerId: string; headline: string; summary: string };
  candidates: Candidate[];
  tests: BenchmarkTest[];
}

export interface RunFile {
  schemaVersion: 1;
  id: string;
  label: string;
  publishedAt: string;
  environment: Environment;
  protocol: RunMetadata["protocol"];
  candidates: [];
  sections: BenchmarkSection[];
}

export function validateResults(raw: unknown): RawResults {
  if (!raw || typeof raw !== "object") throw new Error("results: not an object");
  const r = raw as Partial<RawResults>;
  if (r.schemaVersion !== 1) throw new Error("results: unsupported schemaVersion");
  if (!Array.isArray(r.passes) || r.passes.length === 0) throw new Error("results: no passes");
  if (!Array.isArray(r.candidates) || r.candidates.length < 2) throw new Error("results: fewer than two candidates");
  return raw as RawResults;
}

/** A memory-only run has no passes; it needs a schema, a rig, a browser and at least one candidate's samples. */
export function validateMemoryResults(raw: unknown): RawResults {
  if (!raw || typeof raw !== "object") throw new Error("memory results: not an object");
  const r = raw as Partial<RawResults>;
  if (r.schemaVersion !== 1) throw new Error("memory results: unsupported schemaVersion");
  if (!r.memory || typeof r.memory !== "object" || Object.keys(r.memory).length === 0) throw new Error("memory results: no memory samples");
  if (!r.rig || !r.browser || !r.protocol) throw new Error("memory results: rig, browser or protocol missing");
  return raw as RawResults;
}

export function candidateIds(raw: RawResults): CandidateId[] {
  const present = new Set(raw.candidates.map((c) => c.id));
  return CANDIDATE_ORDER.filter((id) => present.has(id));
}

/** One value per measured pass that has a result for the candidate. */
export function perPass(raw: RawResults, id: CandidateId, pick: (r: PassResult) => number | null): number[] {
  const out: number[] = [];
  for (const pass of raw.passes) {
    if (pass.warmup) continue;
    const r = pass.results[id];
    if (!r) continue;
    const v = pick(r);
    if (v !== null && Number.isFinite(v)) out.push(round(v, 3));
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? mean(xs) : Number.NaN);

function base(id: CandidateId, samples: number[], metrics: Record<string, Metric>): Candidate {
  const meta = CANDIDATES[id];
  return { id, name: meta.name, version: meta.version, color: meta.color, homepage: meta.homepage, statistics: statistics(samples), samplesMs: samples, metrics };
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 2 : ms < 100 ? 1 : 0)} ms`;
}

function ratio(a: number, b: number): string {
  return `${(a / b).toFixed(2)}x`;
}

function rankByMean(candidates: Candidate[], lowerIsBetter = true): { best: Candidate; worst: Candidate } {
  const ranked = [...candidates].sort((a, b) => (lowerIsBetter ? a.statistics.meanMs - b.statistics.meanMs : b.statistics.meanMs - a.statistics.meanMs));
  return { best: ranked[0]!, worst: ranked[ranked.length - 1]! };
}

export function buildStartupSection(raw: RawResults): BenchmarkSection {
  const ids = candidateIds(raw);
  const marks: { key: keyof PassResult["startup"]; id: string; title: string; description: string }[] = [
    { key: "importMs", id: "import", title: "Bundle import", description: "Script or module tag inserted until the library has evaluated, from the loopback server." },
    { key: "styleLoadMs", id: "style-load", title: "Style load", description: "Map constructed until the style.load event: style JSON fetched and parsed, layers created." },
    { key: "firstTileMs", id: "first-tile", title: "First tile", description: "Map constructed until the first vector tile has been fetched and parsed by a worker." },
    { key: "loadMs", id: "load", title: "Load, default fade", description: "Map constructed until the load event with the default 300 ms fade. mapbox-gl 1.13 holds this event until its tile fade has finished; the MapLibre builds do not, so this mark is what each build reports, not the same amount of work." },
    { key: "firstIdleMs", id: "first-idle", title: "First idle, default fade", description: "Map constructed until the first idle event after load with the default 300 ms fade. mapbox-gl 1.13 also holds idle until its label fade has finished; the MapLibre builds fire idle within a few milliseconds of load." },
  ];
  const noFade = (id: CandidateId, key: keyof StartupMarks) => perPass(raw, id, (r) => r.startupNoFade?.[key] ?? null);
  const candidates = ids.map((id) => {
    const metrics: Record<string, Metric> = {};
    for (const m of marks) metrics[`${m.id}-mean`] = { value: round(avg(perPass(raw, id, (r) => r.startup[m.key])), 1), unit: "ms", label: `${m.title} mean` };
    metrics["load-no-fade-mean"] = { value: round(avg(noFade(id, "loadMs")), 1), unit: "ms", label: "Load with fades off, mean" };
    metrics["first-idle-no-fade-mean"] = { value: round(avg(noFade(id, "firstIdleMs")), 1), unit: "ms", label: "First idle with fades off, mean" };
    metrics["geojson-5k-mean"] = { value: round(avg(perPass(raw, id, (r) => r.geojsonMs)), 1), unit: "ms", label: "5,000 building polygons added until idle, mean" };
    const c = raw.candidates.find((x) => x.id === id)!;
    metrics["bundle-raw"] = { value: c.bytes.raw, unit: "B", label: "JavaScript served, uncompressed" };
    metrics["bundle-gzip"] = { value: c.bytes.gzip, unit: "B", label: "JavaScript served, gzip -9" };
    metrics["bundle-brotli"] = { value: c.bytes.brotli, unit: "B", label: "JavaScript served, brotli 11" };
    metrics["tile-requests"] = { value: round(avg(perPass(raw, id, (r) => r.tileRequests)), 0), unit: "requests", label: "Tile requests per pass" };
    const workers = perPass(raw, id, (r) => r.workerCount);
    if (workers.length) metrics["workers"] = { value: workers[0]!, unit: "workers", label: "Web Workers the library started by default" };
    return base(id, noFade(id, "loadMs"), metrics);
  });
  const tests: BenchmarkTest[] = [
    {
      id: "load-no-fade",
      title: "Load, fades off",
      description: "Map constructed until the load event with fadeDuration 0: style, every tile in the view fetched and parsed, everything drawn once. The one startup mark that means the same amount of work in all three builds.",
      unit: "ms",
      lowerIsBetter: true,
      results: ids.map((id) => ({ candidateId: id, value: round(avg(noFade(id, "loadMs")), 1) })),
    },
    ...marks.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      unit: "ms",
      lowerIsBetter: true,
      results: ids.map((id) => ({ candidateId: id, value: round(avg(perPass(raw, id, (r) => r.startup[m.key])), 1) })),
    })),
    {
      id: "geojson-5k",
      title: "GeoJSON, 5,000 buildings",
      description: "A pre-parsed FeatureCollection of 5,000 Berlin building footprints added as a fill layer to the idle map, until the next idle.",
      unit: "ms",
      lowerIsBetter: true,
      results: ids.map((id) => ({ candidateId: id, value: round(avg(perPass(raw, id, (r) => r.geojsonMs)), 1) })),
    },
  ];
  const { best, worst } = rankByMean(candidates);
  return {
    id: "startup",
    title: "Startup timeline",
    deck: "From script tag to a drawn map of Berlin Mitte at z11, read from the events every build fires: bundle import, style load, first tile, load, first idle. The headline mark is load with fades off, because the builds disagree about whether a fade counts. Plus 5,000 GeoJSON polygons added to the settled map.",
    unit: "ms",
    lowerIsBetter: true,
    verdict: {
      winnerId: best.id,
      headline: `${best.name} drew the first complete frame in ${fmtMs(best.statistics.meanMs)} on average; ${worst.name} took ${fmtMs(worst.statistics.meanMs)} (${ratio(worst.statistics.meanMs, best.statistics.meanMs)})`,
      summary: "Time from map construction to the load event with fades off, one sample per measured pass, fresh browser context every pass.",
    },
    candidates,
    tests,
  };
}

export function buildFrameTimeSection(raw: RawResults): BenchmarkSection {
  const ids = candidateIds(raw);
  const allViews = (id: CandidateId) => raw.passes.filter((p) => !p.warmup).flatMap((p) => p.results[id]?.coldViewsMs ?? []);
  const allSteps = (id: CandidateId) => raw.passes.filter((p) => !p.warmup).flatMap((p) => p.results[id]?.warmStepsMs ?? []);
  const candidates = ids.map((id) =>
    base(id, perPass(raw, id, (r) => avg(r.warmStepsMs)), {
      "cold-view-mean": { value: round(avg(allViews(id)), 1), unit: "ms", label: "Cold pan, mean per view" },
      "cold-view-p99": { value: round(percentile(allViews(id), 0.99), 1), unit: "ms", label: "Cold pan, p99 view" },
      "warm-frame-mean": { value: round(avg(allSteps(id)), 2), unit: "ms", label: "Warm paint, mean per frame" },
      "warm-frame-median": { value: round(percentile(allSteps(id), 0.5), 2), unit: "ms", label: "Warm paint, median frame" },
      "warm-frame-p99": { value: round(percentile(allSteps(id), 0.99), 2), unit: "ms", label: "Warm paint, p99 frame" },
      "warm-tile-requests": { value: round(avg(perPass(raw, id, (r) => r.warmTileRequests)), 1), unit: "requests", label: "Tile requests during the measured warm traversal, mean per pass" },
    }),
  );
  const tests: BenchmarkTest[] = [
    {
      id: "cold-pan",
      title: "Cold pan, per view",
      description: `Mean time per view over the ${raw.protocol.coldViews}-view camera path, each view advanced only when the map reports idle, so fetch, parse, layout and paint are all inside it.`,
      unit: "ms",
      lowerIsBetter: true,
      results: ids.map((id) => ({ candidateId: id, value: round(avg(perPass(raw, id, (r) => avg(r.coldViewsMs))), 1) })),
    },
    {
      id: "warm-paint",
      title: "Warm paint, per frame",
      description: `Mean time per frame over the ${raw.protocol.warmSteps}-step camera path, the camera moved on every render event, vsync and the frame-rate limit off. Every tile the cold pan loaded is resident; tiles only needed at intermediate camera states are still requested and abandoned as the camera moves on, and those requests are counted beside the timings and included in the frame time.`,
      unit: "ms",
      lowerIsBetter: true,
      results: ids.map((id) => ({ candidateId: id, value: round(avg(perPass(raw, id, (r) => avg(r.warmStepsMs))), 2) })),
    },
  ];
  const { best, worst } = rankByMean(candidates);
  return {
    id: "frame-time",
    title: "Frame time",
    deck: "One deterministic camera path over Berlin, traversed twice: cold, waiting for idle at each of the views so tiles are fetched and parsed on the way; then warm, moving the camera every frame with everything resident.",
    unit: "ms",
    lowerIsBetter: true,
    verdict: {
      winnerId: best.id,
      headline: `${best.name} painted a warm frame in ${fmtMs(best.statistics.meanMs)} on average; ${worst.name} took ${fmtMs(worst.statistics.meanMs)} (${ratio(worst.statistics.meanMs, best.statistics.meanMs)})`,
      summary: "Per-pass mean frame time over the warm traversal is the sample.",
    },
    candidates,
    tests,
  };
}

export function buildMemorySection(raw: RawResults): BenchmarkSection {
  const ids = candidateIds(raw).filter((id) => (raw.memory[id]?.length ?? 0) > 0);
  const delta = (id: CandidateId, pick: "afterIdle" | "afterPath") => (raw.memory[id] ?? []).map((m) => round(m[pick].renderer + m[pick].gpu - (m.baseline.renderer + m.baseline.gpu), 2));
  const heapScope = (id: CandidateId) => ((raw.memory[id] ?? []).find((m) => m.jsHeapScope)?.jsHeapScope === "agent" ? "main thread and workers" : "main thread only; tile data lives in workers");
  const heap = (id: CandidateId, pick: "jsHeapAfterIdleBytes" | "jsHeapAfterPathBytes") => (raw.memory[id] ?? []).map((m) => m[pick]).filter((v): v is number => v !== null).map((v) => v / 1024 / 1024);
  const candidates = ids.map((id) =>
    base(id, delta(id, "afterPath"), {
      "after-idle-mean": { value: round(avg(delta(id, "afterIdle")), 1), unit: "MB", label: "Renderer + GPU process over baseline after first idle, mean" },
      "after-path-mean": { value: round(avg(delta(id, "afterPath")), 1), unit: "MB", label: "Renderer + GPU process over baseline after the camera path, mean" },
      "renderer-after-path": { value: round(avg((raw.memory[id] ?? []).map((m) => m.afterPath.renderer - m.baseline.renderer)), 1), unit: "MB", label: "Renderer process over baseline after the camera path" },
      "gpu-after-path": { value: round(avg((raw.memory[id] ?? []).map((m) => m.afterPath.gpu - m.baseline.gpu)), 1), unit: "MB", label: "GPU process over baseline after the camera path" },
      "js-heap-after-idle": { value: round(avg(heap(id, "jsHeapAfterIdleBytes")), 1), unit: "MB", label: `JS heap (${heapScope(id)}) after first idle` },
      "js-heap-after-path": { value: round(avg(heap(id, "jsHeapAfterPathBytes")), 1), unit: "MB", label: `JS heap (${heapScope(id)}) after the camera path` },
      "memory-samples": { value: (raw.memory[id] ?? []).length, unit: "samples", label: "Memory samples measured" },
      "browser-relaunches": { value: (raw.browserRelaunches ?? []).filter((r) => r.candidate === id).length, unit: "relaunches", label: "Fresh browsers that died and were relaunched during memory sampling" },
    }),
  );
  const tests: BenchmarkTest[] = [
    {
      id: "memory-after-idle",
      title: "After first idle",
      description: "Renderer and GPU process memory over a blank page, once the initial view has settled.",
      unit: "MB",
      lowerIsBetter: true,
      results: ids.map((id) => ({ candidateId: id, value: round(avg(delta(id, "afterIdle")), 1) })),
    },
    {
      id: "memory-after-path",
      title: "After the camera path",
      description: `Renderer and GPU process memory over a blank page after the ${raw.protocol.coldViews}-view cold pan, with each library's default tile cache.`,
      unit: "MB",
      lowerIsBetter: true,
      results: ids.map((id) => ({ candidateId: id, value: round(avg(delta(id, "afterPath")), 1) })),
    },
  ];
  const { best, worst } = rankByMean(candidates);
  return {
    id: "memory",
    title: "Memory",
    deck: `${raw.protocol.memoryMeasure.charAt(0).toUpperCase()}${raw.protocol.memoryMeasure.slice(1)}.`,
    unit: "MB",
    lowerIsBetter: true,
    verdict: {
      winnerId: best.id,
      headline: `${best.name} held ${best.statistics.meanMs.toFixed(0)} MB over baseline after the camera path; ${worst.name} held ${worst.statistics.meanMs.toFixed(0)} MB (${ratio(worst.statistics.meanMs, best.statistics.meanMs)})`,
      summary: "Renderer plus GPU process memory over a blank-page baseline after the camera path, one fresh browser process per sample.",
    },
    candidates,
    tests,
  };
}

export function buildRun(raw: RawResults, meta: RunMetadata): RunFile {
  const results = validateResults(raw);
  const sections = [buildStartupSection(results), buildFrameTimeSection(results)];
  if (Object.keys(results.memory).length >= 2) sections.push(buildMemorySection(results));
  return { schemaVersion: 1, id: meta.id, label: meta.label, publishedAt: meta.publishedAt, environment: meta.environment, protocol: meta.protocol, candidates: [], sections };
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(tm\)|\(r\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

if (import.meta.main) {
  const root = join(import.meta.dirname!, "..");
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const resultsPath = flag("results") ? resolve(flag("results")!) : join(root, "results.json");
  const raw = validateResults(await Bun.file(resultsPath).json());
  // --memory-results=<file>: take the memory samples (and their relaunch count) from a separate run of the memory
  // phase alone, on the same rig and build, so a lost memory sample does not cost the timing passes a rerun.
  const memoryArg = flag("memory-results");
  if (memoryArg) {
    const mem = validateMemoryResults(await Bun.file(resolve(memoryArg)).json());
    if (mem.rig.gpu !== raw.rig.gpu || mem.browser.chromium !== raw.browser.chromium) throw new Error("memory results come from a different rig or browser build");
    raw.memory = mem.memory;
    raw.browserRelaunches = mem.browserRelaunches ?? [];
    raw.protocol.memorySamples = mem.protocol.memorySamples;
    raw.protocol.memoryMeasure = mem.protocol.memoryMeasure;
    console.log(`memory samples taken from ${memoryArg} (${mem.protocol.memorySamples} samples, ${raw.browserRelaunches.length} relaunches)`);
  }
  if (raw.smoke) console.warn("warning: importing a SMOKE run");
  if (!raw.gate.ok) console.warn("warning: the parity gate did not pass; this run is not publishable");
  const publishedAt = raw.generatedAt.split("T")[0]!;
  const gpuShort = flag("gpu-short") ?? raw.rig.gpu.split(",")[0]!.trim();
  const osShort = flag("os-short") ?? raw.rig.os.split(" (")[0]!.trim();
  const rigSlug = flag("rig") ?? slug(gpuShort);
  const meta: RunMetadata = {
    id: `${publishedAt}-${rigSlug}`,
    label: flag("label") ?? `${gpuShort} / ${osShort} (local)`,
    publishedAt,
    environment: {
      machine: flag("machine") ?? raw.rig.machine,
      chip: raw.rig.chip,
      cores: raw.rig.cores,
      memory: raw.rig.memory,
      os: raw.rig.os,
      arch: raw.rig.arch,
      runtime: `Playwright ${raw.browser.playwright} Chromium ${raw.browser.chromium} headless shell; Bun ${raw.harness.bun} harness and loopback static server`,
      gpu: flag("gpu") ?? raw.rig.gpu,
      browser: `Chromium ${raw.browser.chromium}, ${raw.browser.webgl2 ?? raw.browser.webgl1 ?? "unknown renderer"}; flags ${raw.browser.args.filter((a) => !a.startsWith("--host-resolver")).join(" ")}`,
      display: `${raw.protocol.viewport.width}x${raw.protocol.viewport.height} at ${raw.protocol.viewport.deviceScaleFactor}x, offscreen; ${raw.rig.display}`,
    },
    protocol: {
      warmups: raw.protocol.warmups,
      runs: raw.protocol.passes,
      processModel: `One Chromium process for startup and frame time, fresh browser context per pass, candidates interleaved and rotated each pass; ${raw.protocol.memorySamples} memory samples with a fresh browser process each; every request outside loopback fails at the resolver and any attempt invalidates the run`,
      cacheState: `Fresh context per pass, no HTTP cache; timing passes run with maxTileCacheSize ${raw.protocol.mapOptions.maxTileCacheSize} so the warm traversal is warm, memory samples with each library's default tile cache; tiles served gzip from one MBTiles by the harness`,
      output: "The map's own events timed with performance.now() under cross-origin isolation; Playwright screenshots and queryRenderedFeatures for the parity gate; process memory from the OS",
    },
  };
  const run = buildRun(raw, meta);
  const runPath = `runs/${run.id}.json`;
  await Bun.write(join(root, runPath), JSON.stringify(run, null, 2) + "\n");
  const benchmarkPath = join(root, "benchmark.json");
  if (!existsSync(benchmarkPath)) throw new Error(`benchmark.json not found at ${benchmarkPath}`);
  const benchmark = (await Bun.file(benchmarkPath).json()) as { runs?: string[] };
  const runs = benchmark.runs ?? [];
  if (!runs.includes(runPath)) {
    runs.push(runPath);
    benchmark.runs = runs;
    await Bun.write(benchmarkPath, JSON.stringify(benchmark, null, 2) + "\n");
  }
  console.log(`wrote ${runPath}`);
  for (const section of run.sections) console.log(`  ${section.id}: ${section.candidates.length} candidates, ${section.tests.length} tests, winner ${section.verdict.winnerId}`);
}
