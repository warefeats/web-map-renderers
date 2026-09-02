import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { GATE, SYMBOL_ONLY_SOURCE_LAYERS } from "./matrix";

export interface Counts {
  /** Distinct features on screen. */
  total: number;
  /** Raw query hits: the same feature once per tile piece and per style layer. */
  totalRaw: number;
  bySourceLayer: Record<string, number>;
  bySourceLayerRaw: Record<string, number>;
  byLayer: Record<string, number>;
  zoom: number;
}

export interface CountViolation {
  viewpoint: string;
  candidate: string;
  layer: string;
  reference: number;
  actual: number;
  allowed: number;
}

/** Every source layer whose rendered-feature count strays further from the reference than the tolerance allows. */
export function compareCounts(viewpoint: string, candidate: string, reference: Counts, actual: Counts, tolerance = GATE): CountViolation[] {
  const layers = new Set([...Object.keys(reference.bySourceLayer), ...Object.keys(actual.bySourceLayer)]);
  const out: CountViolation[] = [];
  for (const layer of [...layers].sort()) {
    const ref = reference.bySourceLayer[layer] ?? 0;
    const act = actual.bySourceLayer[layer] ?? 0;
    const relative = SYMBOL_ONLY_SOURCE_LAYERS.has(layer) ? tolerance.symbolRelativeTolerance : tolerance.relativeTolerance;
    const allowed = Math.max(ref * relative, tolerance.absoluteTolerance);
    if (Math.abs(act - ref) > allowed) out.push({ viewpoint, candidate, layer, reference: ref, actual: act, allowed });
  }
  return out;
}

export interface PixelDiff {
  differing: number;
  total: number;
  ratio: number;
}

/** Share of pixels that differ between two same-sized PNG screenshots. Information, not a gate. */
export function pixelDiff(a: Uint8Array, b: Uint8Array, threshold: number = GATE.pixelThreshold): PixelDiff {
  const pa = PNG.sync.read(Buffer.from(a));
  const pb = PNG.sync.read(Buffer.from(b));
  if (pa.width !== pb.width || pa.height !== pb.height) throw new Error(`screenshot sizes differ: ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`);
  const total = pa.width * pa.height;
  const differing = pixelmatch(pa.data, pb.data, undefined, pa.width, pa.height, { threshold });
  return { differing, total, ratio: total === 0 ? 0 : differing / total };
}
