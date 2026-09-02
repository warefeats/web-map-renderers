import { describe, expect, test } from "bun:test";
import { percentile, statistics } from "../src/stats";

describe("stats", () => {
  test("statistics summarize a sample array", () => {
    expect(statistics([3, 1, 2])).toEqual({ medianMs: 2, meanMs: 2, minMs: 1, maxMs: 3 });
  });
  test("percentile interpolates", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.99)).toBeCloseTo(39.7, 5);
  });
});
