import { describe, expect, test } from "bun:test";
import { compareCounts, type Counts } from "../src/gate";

const counts = (bySourceLayer: Record<string, number>): Counts => ({ total: Object.values(bySourceLayer).reduce((a, b) => a + b, 0), bySourceLayer, byLayer: {}, zoom: 14 });

describe("parity gate", () => {
  test("accepts counts within 10% of the reference", () => {
    expect(compareCounts("vp", "c", counts({ building: 1000, road: 200 }), counts({ building: 1090, road: 185 }))).toEqual([]);
  });

  test("uses the absolute tolerance for small layers", () => {
    expect(compareCounts("vp", "c", counts({ poi: 3 }), counts({ poi: 8 }))).toEqual([]);
    expect(compareCounts("vp", "c", counts({ poi: 3 }), counts({ poi: 9 }))).toHaveLength(1);
  });

  test("flags a layer that vanished and a layer that appeared", () => {
    const v = compareCounts("vp", "c", counts({ building: 1000, water: 40 }), counts({ building: 1000, landuse: 40 }));
    expect(v.map((x) => x.layer).sort()).toEqual(["landuse", "water"]);
  });

  test("flags a blank canvas", () => {
    const v = compareCounts("vp", "c", counts({ building: 1000, road: 200 }), counts({}));
    expect(v).toHaveLength(2);
  });
});
