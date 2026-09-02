import { chromiumArgs, launch, newBenchContext } from "./browser";
import { START, cameraPath } from "./camera";
import { CANDIDATES, MEMORY_MAP_OPTIONS, type CandidateId } from "./matrix";
import { startServer } from "./server";
import { join } from "node:path";

/**
 * Reproduce the fresh-browser crash: launch a new browser per attempt, run startup plus the cold pan for one
 * candidate, and report what died and how. Usage: bun run src/diag-crash.ts [candidate] [attempts] [extra chromium flags...]
 */
const [, , candidateArg = "maplibre-gl-6", attemptsArg = "4", ...extraFlags] = process.argv;
const id = candidateArg as CandidateId;
const meta = CANDIDATES[id];
if (!meta) throw new Error(`unknown candidate ${id}`);
const attempts = Number(attemptsArg);
const root = join(import.meta.dirname!, "..");
const server = startServer({ root });
const states = cameraPath(60);
const args = [...chromiumArgs(), ...extraFlags];
console.log(`candidate ${id}, ${attempts} attempts, flags: ${extraFlags.join(" ") || "(benchmark defaults)"}`);
for (let i = 0; i < attempts; i++) {
  const t0 = Date.now();
  const browser = await launch(args);
  const events: string[] = [];
  browser.on("disconnected", () => events.push(`browser disconnected at +${Date.now() - t0} ms`));
  const ctx = await newBenchContext(browser, server.origin, id, () => "diag");
  ctx.page.on("crash", () => events.push(`PAGE CRASH at +${Date.now() - t0} ms`));
  ctx.page.on("close", () => events.push(`page closed at +${Date.now() - t0} ms`));
  let outcome = "ok";
  let view = -1;
  try {
    await ctx.page.goto(`${server.origin}/?candidate=${id}`, { waitUntil: "load" });
    await ctx.page.evaluate((m) => (window as any).bench.loadLib(m), { id: meta.id, kind: meta.kind, js: meta.js, css: meta.css, global: meta.global ?? null });
    await ctx.page.evaluate((cfg) => (window as any).bench.start(cfg), { state: START, options: MEMORY_MAP_OPTIONS, idleTimeoutMs: 60000 });
    for (view = 0; view < states.length; view++) {
      await ctx.page.evaluate((cfg) => (window as any).bench.traverseIdle([cfg.state], cfg.idleTimeoutMs), { state: states[view], idleTimeoutMs: 60000 });
    }
  } catch (err) {
    outcome = `FAILED at view ${view}: ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`;
  }
  const mapErrors = await ctx.page.evaluate(() => (window as any).bench.errors.slice()).catch(() => ["(page gone)"]);
  console.log(`attempt ${i}: ${outcome} in ${((Date.now() - t0) / 1000).toFixed(0)} s; events: ${events.join("; ") || "none"}; pageErrors: ${JSON.stringify(ctx.pageErrors)}; mapErrors: ${JSON.stringify(mapErrors).slice(0, 300)}; consoleWarnings: ${ctx.consoleWarnings}`);
  await ctx.context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
server.stop();
process.exit(0);
