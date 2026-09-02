import { describe, expect, test } from "bun:test";
import { KEYFRAMES, START, VIEWPOINTS, cameraPath } from "../src/camera";

describe("camera path", () => {
  test("is deterministic and never repeats the start state", () => {
    const a = cameraPath(60);
    const b = cameraPath(60);
    expect(a).toEqual(b);
    expect(a).toHaveLength(60);
    expect(a[0]).not.toEqual(START);
  });

  test("passes through every keyframe after the first, in order", () => {
    const path = cameraPath(600);
    expect(path[199]).toEqual(KEYFRAMES[1]!);
    expect(path[399]).toEqual(KEYFRAMES[2]!);
    expect(path[599]).toEqual(KEYFRAMES[3]!);
  });

  test("consecutive states always differ, so every jumpTo triggers a frame", () => {
    const path = [START, ...cameraPath(60)];
    for (let i = 1; i < path.length; i++) expect(path[i]).not.toEqual(path[i - 1]);
  });

  test("rejects step counts that do not divide into the segments", () => {
    expect(() => cameraPath(61)).toThrow();
    expect(() => cameraPath(0)).toThrow();
  });

  test("viewpoints have unique ids", () => {
    expect(new Set(VIEWPOINTS.map((v) => v.id)).size).toBe(VIEWPOINTS.length);
  });
});
