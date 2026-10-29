import { resolve } from "node:path";
import { type BenchmarkSection, type TestStatistic, buildSections, mergeMemoryResults, validateMemoryResults, validateResults } from "./import";
import { mean } from "./stats";

// Adds to a published run file what the importer has since learned to emit from the same raw results: today each
// test's statistic and each result's per-pass samples. The file's own text is the base, so its id, label, provenance,
// lineup and every number stay as published, and the new keys are appended where the importer would write them.

/** The parts of a published run file the enrich reads and extends; everything else in it is carried through as it is. */
interface PublishedResult {
  candidateId: string;
  value: number;
  samples?: number[];
  [key: string]: unknown;
}

interface PublishedTest {
  id: string;
  results: PublishedResult[];
  statistic?: TestStatistic;
  [key: string]: unknown;
}

interface PublishedSection {
  id: string;
  tests: PublishedTest[];
  [key: string]: unknown;
}

export interface PublishedRun {
  id: string;
  sections: PublishedSection[];
  [key: string]: unknown;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isNumbers(x: unknown): x is number[] {
  return Array.isArray(x) && x.every((v) => typeof v === "number");
}

function isStatistic(x: unknown): x is TestStatistic {
  return x === "mean" || x === "median" || x === "min" || x === "max" || x === "other";
}

function isResult(x: unknown): x is PublishedResult {
  return isRecord(x) && typeof x.candidateId === "string" && typeof x.value === "number" && (x.samples === undefined || isNumbers(x.samples));
}

function isTest(x: unknown): x is PublishedTest {
  return isRecord(x) && typeof x.id === "string" && Array.isArray(x.results) && x.results.every(isResult) && (x.statistic === undefined || isStatistic(x.statistic));
}

function isSection(x: unknown): x is PublishedSection {
  return isRecord(x) && typeof x.id === "string" && Array.isArray(x.tests) && x.tests.every(isTest);
}

export function isPublishedRun(x: unknown): x is PublishedRun {
  return isRecord(x) && typeof x.id === "string" && Array.isArray(x.sections) && x.sections.every(isSection);
}

/** The site's check of a value against its samples: their mean lands within half a unit of the value's last printed digit. */
export function summarizes(value: number, samples: number[]): boolean {
  const printed = String(value);
  const point = printed.indexOf(".");
  const digits = point < 0 ? 0 : printed.length - point - 1;
  return Math.abs(mean(samples) - value) <= 0.5 * 10 ** -digits + 1e-9;
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface EnrichCounts {
  tests: number;
  results: number;
}

/**
 * Append each test's statistic and each result's samples from a fresh build of the same results to a published run,
 * refusing unless every published value is exactly what the fresh build computes and its samples summarize to it.
 */
export function enrichRun(old: PublishedRun, fresh: BenchmarkSection[]): EnrichCounts {
  const counts: EnrichCounts = { tests: 0, results: 0 };
  for (const section of old.sections) {
    const freshSection = fresh.find((s) => s.id === section.id);
    if (!freshSection) throw new Error(`${old.id}: section ${section.id} is not in the rebuilt run`);
    for (const test of section.tests) {
      const at = `${old.id}: ${section.id}/${test.id}`;
      const freshTest = freshSection.tests.find((t) => t.id === test.id);
      if (!freshTest) throw new Error(`${at} is not in the rebuilt run`);
      if (!freshTest.statistic) throw new Error(`${at}: the rebuilt test carries no statistic`);
      if (test.statistic !== undefined && test.statistic !== freshTest.statistic) throw new Error(`${at}: already carries statistic ${test.statistic}, rebuilt as ${freshTest.statistic}`);
      for (const result of test.results) {
        const freshResult = freshTest.results.find((r) => r.candidateId === result.candidateId);
        if (!freshResult) throw new Error(`${at}/${result.candidateId} is not in the rebuilt run`);
        if (freshResult.value !== result.value) throw new Error(`${at}/${result.candidateId}: published ${result.value}, rebuilt ${freshResult.value}`);
        if (!freshResult.samples) throw new Error(`${at}/${result.candidateId}: the rebuilt result carries no samples`);
        if (!summarizes(result.value, freshResult.samples)) throw new Error(`${at}/${result.candidateId}: ${result.value} does not summarize the rebuilt samples`);
        if (result.samples !== undefined && !same(result.samples, freshResult.samples)) throw new Error(`${at}/${result.candidateId}: already carries different samples`);
        result.samples = freshResult.samples;
        counts.results++;
      }
      test.statistic = freshTest.statistic;
      counts.tests++;
    }
  }
  return counts;
}

/** Enrich the run file at `runPath` in place from the raw timing results and, when given, the memory results of the same run. */
export async function enrichRunFile(runPath: string, resultsPath: string, memoryResultsPath?: string): Promise<EnrichCounts> {
  const text = await Bun.file(runPath).text();
  const parsed: unknown = JSON.parse(text);
  if (JSON.stringify(parsed, null, 2) + "\n" !== text) throw new Error(`${runPath} is not formatted as the importer writes it, so additions could not be told from reformatting`);
  if (!isPublishedRun(parsed)) throw new Error(`${runPath} does not look like a run file`);
  const raw = validateResults(await Bun.file(resultsPath).json());
  if (memoryResultsPath) mergeMemoryResults(raw, validateMemoryResults(await Bun.file(memoryResultsPath).json()));
  const counts = enrichRun(parsed, buildSections(raw));
  await Bun.write(runPath, JSON.stringify(parsed, null, 2) + "\n");
  return counts;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const run = flag("run");
  const results = flag("results");
  if (!run || !results) throw new Error("usage: bun run src/enrich.ts --run=runs/<id>.json --results=<results-timing.json> [--memory-results=<results-memory.json>]");
  const memory = flag("memory-results");
  const counts = await enrichRunFile(resolve(run), resolve(results), memory ? resolve(memory) : undefined);
  console.log(`enriched ${run}: ${counts.tests} tests with their statistic, ${counts.results} results with their samples`);
}
