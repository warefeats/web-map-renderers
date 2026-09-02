import { assertGpu, chromiumArgs, gpuInfo, launch } from "./browser";

/** Launch the pinned Chromium exactly as the benchmark does and print what it rendered with. Exit 1 if the GPU assert would refuse it. */
const args = chromiumArgs();
const browser = await launch(args);
const page = await browser.newPage();
await page.setContent("<canvas></canvas>");
const info = await gpuInfo(browser, page);
console.log(JSON.stringify({ platform: process.platform, args, ...info }, null, 2));
await browser.close();
try {
  assertGpu(info);
  console.log("GPU assert: ok");
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}
