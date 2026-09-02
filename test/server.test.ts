import { describe, expect, test } from "bun:test";
import { rewriteStyle, tmsRow } from "../src/server";

describe("server helpers", () => {
  test("rewrites every origin placeholder", () => {
    const style = JSON.stringify({ sprite: "{origin}/sprite/sprite", glyphs: "{origin}/glyphs/{fontstack}/{range}.pbf", sources: { openmaptiles: { tiles: ["{origin}/tiles/{z}/{x}/{y}.pbf"] } } });
    const out = rewriteStyle(style, "http://127.0.0.1:4321");
    expect(out).not.toContain("{origin}");
    expect(out).toContain("http://127.0.0.1:4321/glyphs/{fontstack}/{range}.pbf");
  });

  test("flips XYZ rows to TMS", () => {
    expect(tmsRow(0, 0)).toBe(0);
    expect(tmsRow(1, 0)).toBe(1);
    expect(tmsRow(14, 5373)).toBe(16383 - 5373);
  });
});
