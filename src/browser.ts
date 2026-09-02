import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { VIEWPORT } from "./matrix";

/** Loopback only: every other host resolves to nothing, at the network layer, before any request leaves the box. */
export const HOST_RULES = "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1";

/** Chromium flags the benchmark launches with. The ANGLE backend is per platform; everything else is shared. */
export function chromiumArgs(platform: NodeJS.Platform = process.platform): string[] {
  const angle = platform === "win32" ? ["--use-angle=d3d11"] : platform === "darwin" ? ["--use-angle=metal"] : [];
  return [
    ...angle,
    "--use-gl=angle",
    "--ignore-gpu-blocklist",
    "--disable-gpu-vsync",
    "--disable-frame-rate-limit",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    `--host-resolver-rules=${HOST_RULES}`,
  ];
}

export async function launch(args: string[] = chromiumArgs()): Promise<Browser> {
  return chromium.launch({ headless: true, args, chromiumSandbox: false });
}

export interface GpuInfo {
  chromium: string;
  webgl1: string | null;
  webgl2: string | null;
  devices: string[];
  features: Record<string, string>;
  hardwareConcurrency: number;
}

/** What the browser actually rendered with, from the page's unmasked renderer strings and the browser's own GPU feature table. */
export async function gpuInfo(browser: Browser, page: Page): Promise<GpuInfo> {
  const webgl = await page.evaluate(() => {
    const out: { webgl1: string | null; webgl2: string | null; hardwareConcurrency: number } = { webgl1: null, webgl2: null, hardwareConcurrency: navigator.hardwareConcurrency };
    for (const [key, kind] of [["webgl1", "webgl"], ["webgl2", "webgl2"]] as const) {
      const gl = document.createElement("canvas").getContext(kind) as WebGLRenderingContext | null;
      if (!gl) continue;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      out[key] = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    }
    return out;
  });
  let devices: string[] = [];
  let features: Record<string, string> = {};
  try {
    const session = await browser.newBrowserCDPSession();
    const info = (await session.send("SystemInfo.getInfo")) as {
      gpu: { devices: { vendorString?: string; deviceString?: string; driverVersion?: string }[]; featureStatus?: Record<string, string> };
    };
    devices = info.gpu.devices.map((d) => `${d.vendorString ?? ""} ${d.deviceString ?? ""}${d.driverVersion ? ` driver ${d.driverVersion}` : ""}`.trim());
    features = Object.fromEntries(Object.entries(info.gpu.featureStatus ?? {}).filter(([k]) => /webgl|rasterization|gpu_compositing|opengl|vulkan|canvas/.test(k)));
    await session.detach();
  } catch {
    // SystemInfo is a browser-level domain; if it is unavailable the renderer strings still decide.
  }
  return { chromium: browser.version(), ...webgl, devices, features };
}

/** The GPU assert: refuse to sample unless WebGL ran on the rig's GPU through a hardware backend. */
export function assertGpu(info: GpuInfo, opts: { allowSoftware?: boolean; platform?: NodeJS.Platform } = {}): void {
  const platform = opts.platform ?? process.platform;
  const renderers = [info.webgl1, info.webgl2];
  const problems: string[] = [];
  if (!info.webgl1) problems.push("no WebGL 1 context");
  if (!info.webgl2) problems.push("no WebGL 2 context");
  for (const r of renderers) {
    if (r && /swiftshader|software|llvmpipe/i.test(r)) problems.push(`software renderer: ${r}`);
    if (r && platform === "win32" && !/Direct3D11/.test(r)) problems.push(`not Direct3D 11: ${r}`);
  }
  if (info.features["gpu_compositing"] && info.features["gpu_compositing"] !== "enabled") problems.push(`gpu_compositing is ${info.features["gpu_compositing"]}`);
  if (problems.length && !opts.allowSoftware) throw new Error(`GPU assert failed: ${problems.join("; ")}`);
}

export interface Violation {
  candidate: string;
  phase: string;
  url: string;
}

export interface BenchContext {
  context: BrowserContext;
  page: Page;
  violations: Violation[];
  pageErrors: string[];
  consoleErrors: string[];
}

/** A fresh context with the benchmark viewport, request policing, and error capture. */
export async function newBenchContext(browser: Browser, origin: string, candidate: string, phase: () => string): Promise<BenchContext> {
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.deviceScaleFactor,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const violations: Violation[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(origin + "/") || url.startsWith("blob:") || url.startsWith("data:")) return;
    violations.push({ candidate, phase: phase(), url });
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return { context, page, violations, pageErrors, consoleErrors };
}
