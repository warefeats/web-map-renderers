import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import type { Browser } from "playwright";
import { assertGpu, chromiumArgs, gpuInfo, launch, newBenchContext, type GpuInfo, type Violation } from "./browser";
import { START, VIEWPOINTS, cameraPath, type CameraState } from "./camera";
import { compareCounts, pixelDiff, type CountViolation, type Counts } from "./gate";
import { CANDIDATES, CANDIDATE_ORDER, GATE, MAP_OPTIONS, REFERENCE, VIEWPORT, protocol, type CandidateId, type CandidateMeta, type Protocol } from "./matrix";
import { processBytes, type ProcessBytes } from "./memory";
import { rigInfo, type RigInfo } from "./rig";
import { startServer, type BenchServer } from "./server";

export interface StartupMarks {
  importMs: number;
  styleLoadMs: number | null;
  firstTileMs: number | null;
  loadMs: number | null;
  firstIdleMs: number | null;
}

export interface PassResult {
  startup: StartupMarks;
  geojsonMs: number;
  geojsonFeatures: number;
  coldViewsMs: number[];
  warmStepsMs: number[];
  tileRequests: number;
  tileBytes: number;
  glyphRequests: number;
  pageErrors: string[];
  mapErrors: string[];
}

export interface MemorySample {
  baseline: ProcessBytes;
  afterIdle: ProcessBytes;
  afterPath: ProcessBytes;
  jsHeapAfterIdleBytes: number | null;
  jsHeapAfterPathBytes: number | null;
}

export interface Pass {
  index: number;
  warmup: boolean;
  order: CandidateId[];
  results: Partial<Record<CandidateId, PassResult>>;
}

export interface FileBytes {
  raw: number;
  gzip: number;
  brotli: number;
}

export interface BundleBytes extends FileBytes {
  files: Record<string, FileBytes>;
}

export interface Failure {
  candidate: CandidateId | null;
  pass: number | null;
  phase: string;
  message: string;
}

export interface RawResults {
  schemaVersion: 1;
  smoke: boolean;
  generatedAt: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  rig: RigInfo;
  browser: GpuInfo & { playwright: string; args: string[] };
  harness: { bun: string; platform: string };
  protocol: Protocol & {
    viewport: typeof VIEWPORT;
    mapOptions: typeof MAP_OPTIONS;
    gate: typeof GATE;
    reference: CandidateId;
    coldAdvance: string;
    warmAdvance: string;
    memoryMeasure: string;
  };
  candidates: (CandidateMeta & { bytes: BundleBytes; libraryVersion: string | null; workerCount: number | null })[];
  passes: Pass[];
  gate: {
    pass: number | null;
    viewpoints: Record<string, Partial<Record<CandidateId, Counts>>>;
    pixelDiff: Record<string, Partial<Record<CandidateId, number>>>;
    violations: CountViolation[];
    ok: boolean;
  };
  memory: Partial<Record<CandidateId, MemorySample[]>>;
  violations: Violation[];
  failures: Failure[];
}

interface Args {
  smoke: boolean;
  passes?: number;
  warmups?: number;
  memorySamples?: number;
  candidates: CandidateId[];
  output: string;
  skipMemory: boolean;
  allowSoftwareGpu: boolean;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))?.split("=")[1];
  const has = (name: string) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  const list = flag("candidates");
  const candidates = list ? (list.split(",") as CandidateId[]) : CANDIDATE_ORDER;
  for (const c of candidates) if (!CANDIDATES[c]) throw new Error(`unknown candidate ${c}; known: ${CANDIDATE_ORDER.join(", ")}`);
  const num = (name: string) => (flag(name) === undefined ? undefined : Number(flag(name)));
  return {
    smoke: has("smoke"),
    passes: num("passes"),
    warmups: num("warmups"),
    memorySamples: num("memory-samples"),
    candidates,
    output: flag("output") ?? "results.json",
    skipMemory: has("skip-memory"),
    allowSoftwareGpu: has("allow-software-gpu"),
  };
}

function bundleBytes(root: string, meta: CandidateMeta): BundleBytes {
  const files: Record<string, FileBytes> = {};
  const total: FileBytes = { raw: 0, gzip: 0, brotli: 0 };
  for (const name of meta.files) {
    const data = new Uint8Array(readFileSync(join(root, "node_modules", meta.pkg, "dist", name)));
    const gz = Bun.gzipSync(data, { level: 9 }).byteLength;
    const br = brotliCompressSync(data, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }).byteLength;
    files[name] = { raw: data.byteLength, gzip: gz, brotli: br };
    total.raw += data.byteLength;
    total.gzip += gz;
    total.brotli += br;
  }
  return { ...total, files };
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items;
  const k = by % items.length;
  return [...items.slice(k), ...items.slice(0, k)];
}

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function measurePass(
  browser: Browser,
  server: BenchServer,
  root: string,
  id: CandidateId,
  proto: Protocol,
  coldStates: CameraState[],
  warmStates: CameraState[],
  gate: { run: boolean; sink: RawResults["gate"]; screenshotDir: string },
  violations: Violation[],
  passIndex: number,
): Promise<PassResult> {
  const meta = CANDIDATES[id];
  let phase = "navigate";
  const ctx = await newBenchContext(browser, server.origin, id, () => phase);
  try {
    server.resetCounters();
    await ctx.page.goto(`${server.origin}/?candidate=${id}`, { waitUntil: "load" });
    phase = "import";
    const lib = (await ctx.page.evaluate((m) => (window as any).bench.loadLib(m), { id: meta.id, kind: meta.kind, js: meta.js, css: meta.css, global: meta.global ?? null })) as {
      importMs: number;
      libraryVersion: string | null;
      workerCount: number | null;
    };
    phase = "startup";
    const startup = (await ctx.page.evaluate((cfg) => (window as any).bench.start(cfg), { state: START, options: MAP_OPTIONS, idleTimeoutMs: proto.idleTimeoutMs })) as StartupMarks;
    phase = "geojson";
    const geojson = (await ctx.page.evaluate((cfg) => (window as any).bench.geojson(cfg.url, cfg.idleTimeoutMs), { url: "/fixtures/buildings-5k.geojson", idleTimeoutMs: proto.idleTimeoutMs })) as {
      ms: number;
      features: number;
    };
    if (gate.run) {
      phase = "gate";
      for (const vp of VIEWPOINTS) {
        const counts = (await ctx.page.evaluate((cfg) => (window as any).bench.viewAndCount(cfg.state, cfg.idleTimeoutMs), { state: vp.state, idleTimeoutMs: proto.idleTimeoutMs })) as Counts;
        (gate.sink.viewpoints[vp.id] ??= {})[id] = counts;
        const png = await ctx.page.screenshot({ type: "png" });
        await Bun.write(join(gate.screenshotDir, `${vp.id}--${id}.png`), png);
      }
      // Back to the start before the camera path so every candidate begins the cold pan from the same state.
      await ctx.page.evaluate((cfg) => (window as any).bench.viewAndCount(cfg.state, cfg.idleTimeoutMs), { state: START, idleTimeoutMs: proto.idleTimeoutMs });
    }
    phase = "cold-pan";
    const coldViewsMs = (await ctx.page.evaluate((cfg) => (window as any).bench.traverseIdle(cfg.states, cfg.idleTimeoutMs), { states: coldStates, idleTimeoutMs: proto.idleTimeoutMs })) as number[];
    phase = "prime";
    await ctx.page.evaluate((cfg) => (window as any).bench.traverseIdle(cfg.states, cfg.idleTimeoutMs), { states: warmStates, idleTimeoutMs: proto.idleTimeoutMs });
    phase = "warm-paint";
    const warmStepsMs = (await ctx.page.evaluate((cfg) => (window as any).bench.traverseRender(cfg.states, cfg.idleTimeoutMs), { states: warmStates, idleTimeoutMs: proto.idleTimeoutMs })) as number[];
    const mapErrors = (await ctx.page.evaluate(() => (window as any).bench.errors.slice())) as string[];
    violations.push(...ctx.violations);
    const c = server.counters;
    return {
      startup: { ...startup, importMs: lib.importMs },
      geojsonMs: geojson.ms,
      geojsonFeatures: geojson.features,
      coldViewsMs,
      warmStepsMs,
      tileRequests: c.tiles,
      tileBytes: c.tileBytes,
      glyphRequests: c.glyphs,
      pageErrors: [...ctx.pageErrors, ...ctx.consoleErrors],
      mapErrors,
    };
  } finally {
    await ctx.context.close();
  }
}

async function measureMemory(server: BenchServer, id: CandidateId | null, proto: Protocol, coldStates: CameraState[], args: string[]): Promise<{ bytes: ProcessBytes; afterPath?: ProcessBytes; heapIdle: number | null; heapPath: number | null }> {
  const browser = await launch(args);
  const ctx = await newBenchContext(browser, server.origin, id ?? "baseline", () => "memory");
  try {
    const cdp = await ctx.context.newCDPSession(ctx.page);
    const gc = () => cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
    if (id === null) {
      await ctx.page.goto(`${server.origin}/blank.html`, { waitUntil: "load" });
      await ctx.page.waitForTimeout(1500);
      await gc();
      return { bytes: await processBytes(browser), heapIdle: null, heapPath: null };
    }
    const meta = CANDIDATES[id];
    await ctx.page.goto(`${server.origin}/?candidate=${id}`, { waitUntil: "load" });
    await ctx.page.evaluate((m) => (window as any).bench.loadLib(m), { id: meta.id, kind: meta.kind, js: meta.js, css: meta.css, global: meta.global ?? null });
    await ctx.page.evaluate((cfg) => (window as any).bench.start(cfg), { state: START, options: MAP_OPTIONS, idleTimeoutMs: proto.idleTimeoutMs });
    await ctx.page.waitForTimeout(1000);
    await gc();
    const heapIdle = (await ctx.page.evaluate(() => (window as any).bench.jsHeap())) as number | null;
    const bytes = await processBytes(browser);
    await ctx.page.evaluate((cfg) => (window as any).bench.traverseIdle(cfg.states, cfg.idleTimeoutMs), { states: coldStates, idleTimeoutMs: proto.idleTimeoutMs });
    await ctx.page.waitForTimeout(1000);
    await gc();
    const heapPath = (await ctx.page.evaluate(() => (window as any).bench.jsHeap())) as number | null;
    const afterPath = await processBytes(browser);
    return { bytes, afterPath, heapIdle, heapPath };
  } finally {
    await ctx.context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = join(import.meta.dirname!, "..");
  const proto: Protocol = { ...protocol(args.smoke) };
  if (args.passes !== undefined) proto.passes = args.passes;
  if (args.warmups !== undefined) proto.warmups = args.warmups;
  if (args.memorySamples !== undefined) proto.memorySamples = args.memorySamples;
  if (args.skipMemory) proto.memorySamples = 0;
  const startedAt = new Date();
  const screenshotDir = join(root, "results", "screenshots");
  mkdirSync(screenshotDir, { recursive: true });

  log(`web-map-renderers ${args.smoke ? "SMOKE" : "full"}: ${proto.warmups} warmups + ${proto.passes} passes, ${proto.coldViews} cold views, ${proto.warmSteps} warm steps, ${proto.memorySamples} memory samples`);
  const server = startServer({ root });
  log(`server at ${server.origin}`);
  const rig = await rigInfo();
  log(`rig: ${rig.machine}; ${rig.chip}; ${rig.gpu}`);
  const chromeArgs = chromiumArgs();
  const browser = await launch(chromeArgs);
  const probePage = await browser.newPage();
  await probePage.setContent("<canvas></canvas>");
  const gpu = await gpuInfo(browser, probePage);
  await probePage.close();
  log(`browser: Chromium ${gpu.chromium}; WebGL2 on ${gpu.webgl2}; compositing ${gpu.features["gpu_compositing"] ?? "?"}`);
  assertGpu(gpu, { allowSoftware: args.allowSoftwareGpu });
  const playwrightVersion = ((await Bun.file(join(root, "node_modules", "playwright", "package.json")).json()) as { version: string }).version;

  const coldStates = cameraPath(proto.coldViews);
  const warmStates = cameraPath(proto.warmSteps);
  const results: RawResults = {
    schemaVersion: 1,
    smoke: args.smoke,
    generatedAt: startedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
    rig,
    browser: { ...gpu, playwright: playwrightVersion, args: chromeArgs },
    harness: { bun: Bun.version, platform: process.platform },
    protocol: {
      ...proto,
      viewport: VIEWPORT,
      mapOptions: MAP_OPTIONS,
      gate: GATE,
      reference: REFERENCE,
      coldAdvance: "jumpTo, then wait for the map's idle event",
      warmAdvance: "jumpTo, then wait for the map's render event, after an idle-advanced priming traversal of the same steps",
      memoryMeasure: process.platform === "win32" ? "private bytes of the renderer and GPU processes, fresh browser process per sample, minus a blank-page baseline" : "RSS of the renderer and GPU processes, fresh browser process per sample, minus a blank-page baseline",
    },
    candidates: args.candidates.map((id) => ({ ...CANDIDATES[id], bytes: bundleBytes(root, CANDIDATES[id]), libraryVersion: null, workerCount: null })),
    passes: [],
    gate: { pass: null, viewpoints: {}, pixelDiff: {}, violations: [], ok: true },
    memory: {},
    violations: [],
    failures: [],
  };

  const totalPasses = proto.warmups + proto.passes;
  const firstMeasured = proto.warmups;
  for (let p = 0; p < totalPasses; p++) {
    const warmup = p < proto.warmups;
    const order = rotate(args.candidates, p);
    const pass: Pass = { index: p, warmup, order, results: {} };
    const runGate = p === firstMeasured;
    if (runGate) results.gate.pass = p;
    for (const id of order) {
      const t0 = Date.now();
      try {
        const r = await measurePass(browser, server, root, id, proto, coldStates, warmStates, { run: runGate, sink: results.gate, screenshotDir }, results.violations, p);
        pass.results[id] = r;
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
        log(
          `pass ${p}${warmup ? " (warmup)" : ""} ${id}: idle ${r.startup.firstIdleMs?.toFixed(0)} ms, geojson ${r.geojsonMs.toFixed(0)} ms, cold ${mean(r.coldViewsMs).toFixed(1)} ms/view, warm ${mean(r.warmStepsMs).toFixed(2)} ms/frame, ${r.tileRequests} tiles, ${r.mapErrors.length + r.pageErrors.length} errors, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.failures.push({ candidate: id, pass: p, phase: "pass", message });
        log(`pass ${p} ${id}: FAILED ${message}`);
      }
    }
    results.passes.push(pass);
  }
  await browser.close();

  // Parity gate: every candidate against the reference at every viewpoint, plus the pixel diff as information.
  const refId = REFERENCE;
  for (const vp of VIEWPOINTS) {
    const ref = results.gate.viewpoints[vp.id]?.[refId];
    if (!ref) continue;
    const refPng = await Bun.file(join(screenshotDir, `${vp.id}--${refId}.png`)).bytes();
    for (const id of args.candidates) {
      const counts = results.gate.viewpoints[vp.id]?.[id];
      if (!counts) continue;
      if (id !== refId) results.gate.violations.push(...compareCounts(vp.id, id, ref, counts));
      const png = await Bun.file(join(screenshotDir, `${vp.id}--${id}.png`)).bytes();
      (results.gate.pixelDiff[vp.id] ??= {})[id] = Number(pixelDiff(refPng, png).ratio.toFixed(4));
    }
  }
  results.gate.ok = results.gate.violations.length === 0 && args.candidates.includes(refId);

  if (proto.memorySamples > 0) {
    for (let s = 0; s < proto.memorySamples; s++) {
      try {
        const baseline = await measureMemory(server, null, proto, coldStates, chromeArgs);
        for (const id of rotate(args.candidates, s)) {
          const m = await measureMemory(server, id, proto, coldStates, chromeArgs);
          (results.memory[id] ??= []).push({ baseline: baseline.bytes, afterIdle: m.bytes, afterPath: m.afterPath!, jsHeapAfterIdleBytes: m.heapIdle, jsHeapAfterPathBytes: m.heapPath });
          log(`memory ${s} ${id}: baseline ${baseline.bytes.total} MB, idle ${m.bytes.total} MB, after path ${m.afterPath!.total} MB (renderer ${m.afterPath!.renderer}, gpu ${m.afterPath!.gpu})`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.failures.push({ candidate: null, pass: s, phase: "memory", message });
        log(`memory sample ${s}: FAILED ${message}`);
      }
    }
  }

  for (const c of results.candidates) {
    const first = results.passes.find((p) => p.results[c.id])?.results[c.id];
    if (first) c.libraryVersion = c.version;
  }
  server.stop();
  const finished = new Date();
  results.finishedAt = finished.toISOString();
  results.durationMs = finished.getTime() - startedAt.getTime();
  await Bun.write(join(root, args.output), JSON.stringify(results, null, 2) + "\n");

  log(`wrote ${args.output} in ${(results.durationMs / 60000).toFixed(1)} min`);
  if (results.gate.pass !== null) {
    console.log("\nParity gate (rendered features by source layer, reference first):");
    for (const vp of VIEWPOINTS) {
      const row = results.gate.viewpoints[vp.id];
      if (!row) continue;
      const layers = new Set<string>();
      for (const id of args.candidates) for (const k of Object.keys(row[id]?.bySourceLayer ?? {})) layers.add(k);
      console.log(`  ${vp.title}`);
      console.log(`    ${"layer".padEnd(18)}${args.candidates.map((id) => id.padStart(16)).join("")}   pixel diff ${args.candidates.map((id) => `${((results.gate.pixelDiff[vp.id]?.[id] ?? 0) * 100).toFixed(1)}%`).join(" / ")}`);
      for (const layer of [...layers].sort()) console.log(`    ${layer.padEnd(18)}${args.candidates.map((id) => String(row[id]?.bySourceLayer[layer] ?? 0).padStart(16)).join("")}`);
    }
    console.log(results.gate.ok ? "  gate: ok" : `  gate: ${results.gate.violations.length} violation(s)`);
    for (const v of results.gate.violations) console.log(`    ${v.viewpoint} ${v.candidate} ${v.layer}: ${v.actual} vs reference ${v.reference} (allowed ±${v.allowed.toFixed(0)})`);
  }
  if (results.violations.length) {
    console.log(`\nNETWORK VIOLATIONS (${results.violations.length}):`);
    for (const v of results.violations.slice(0, 20)) console.log(`  ${v.candidate} [${v.phase}] ${v.url}`);
  }
  if (results.failures.length) {
    console.log(`\nFAILURES (${results.failures.length}):`);
    for (const f of results.failures) console.log(`  ${f.candidate ?? "-"} pass ${f.pass ?? "-"} ${f.phase}: ${f.message}`);
  }
  const invalid = !args.smoke && (!results.gate.ok || results.violations.length > 0 || results.failures.length > 0);
  if (invalid) {
    console.log("\nRUN INVALID: gate, network block or a failure tripped; results.json written for inspection only.");
    process.exit(2);
  }
}

if (import.meta.main) await main();
