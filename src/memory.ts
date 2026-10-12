import type { Browser } from "playwright";

export interface ProcessBytes {
  /** Megabytes. Windows: private bytes (PrivatePageCount). macOS and Linux: resident set size, the closest ps offers. */
  renderer: number;
  gpu: number;
  utility: number;
  browser: number;
  total: number;
  processes: number;
  measure: "private-bytes" | "rss";
}

export interface ChromiumProcess {
  pid: number;
  type: string;
}

/** Chromium's own process table, from the DevTools SystemInfo domain: no process-tree guessing. */
export async function chromiumProcesses(browser: Browser): Promise<ChromiumProcess[]> {
  const session = await browser.newBrowserCDPSession();
  try {
    const info = (await session.send("SystemInfo.getProcessInfo")) as { processInfo: { type: string; id: number }[] };
    return info.processInfo.map((p) => ({ pid: p.id, type: p.type }));
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/** The browser process's own pid, taken while it still answers, so a browser that stops answering can be killed. */
export async function browserPid(browser: Browser): Promise<number | null> {
  return (await chromiumProcesses(browser)).find((p) => p.type === "browser")?.pid ?? null;
}

/** Kill a browser that won't close, with its child processes. */
export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore", timeout: 15_000 }).exited;
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

type Bucket = keyof Pick<ProcessBytes, "renderer" | "gpu" | "utility" | "browser">;

function bucket(type: string): Bucket {
  if (type === "renderer") return "renderer";
  if (type === "GPU" || type === "gpu-process") return "gpu";
  if (type === "browser") return "browser";
  return "utility";
}

async function bytesByPidWindows(pids: number[]): Promise<Map<number, number>> {
  const filter = pids.map((p) => `ProcessId=${p}`).join(" OR ");
  const script = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,PrivatePageCount | ConvertTo-Json -Compress`;
  // A WMI query that stops answering is killed; one that fails must not read as zero bytes.
  const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], { stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  const text = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  if (code !== 0 || proc.signalCode) throw new Error(`process memory: powershell exited with ${proc.signalCode ?? code}`);
  const parsed = text ? (JSON.parse(text) as { ProcessId: number; PrivatePageCount: number } | { ProcessId: number; PrivatePageCount: number }[]) : [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return new Map(rows.map((r) => [r.ProcessId, Number(r.PrivatePageCount ?? 0)]));
}

async function bytesByPidUnix(pids: number[]): Promise<Map<number, number>> {
  const proc = Bun.spawn(["ps", "-o", "pid=,rss=", "-p", pids.join(",")], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const out = new Map<number, number>();
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) out.set(Number(m[1]), Number(m[2]) * 1024);
  }
  return out;
}

const MB = 1024 * 1024;

/** Memory of every process Chromium reports, split by process type. */
export async function processBytes(browser: Browser): Promise<ProcessBytes> {
  const windows = process.platform === "win32";
  const procs = await chromiumProcesses(browser);
  const pids = procs.map((p) => p.pid);
  const bytes = pids.length ? (windows ? await bytesByPidWindows(pids) : await bytesByPidUnix(pids)) : new Map<number, number>();
  const out: ProcessBytes = { renderer: 0, gpu: 0, utility: 0, browser: 0, total: 0, processes: procs.length, measure: windows ? "private-bytes" : "rss" };
  for (const p of procs) {
    const mb = (bytes.get(p.pid) ?? 0) / MB;
    out[bucket(p.type)] += mb;
    out.total += mb;
  }
  for (const k of ["renderer", "gpu", "utility", "browser", "total"] as const) out[k] = Number(out[k].toFixed(2));
  return out;
}
