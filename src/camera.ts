export interface CameraState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export const MITTE: [number, number] = [13.404, 52.52];

/** 2 km east of Mitte. One degree of longitude at 52.52° N is 111.32 km × cos(52.52°) = 67.74 km, so 2 km is 0.02953°. */
export const MITTE_EAST_2KM: [number, number] = [13.43353, 52.52];

/** The camera path's keyframes: overview, zoom in while rotating and pitching, pan east, zoom out. */
export const KEYFRAMES: CameraState[] = [
  { center: MITTE, zoom: 11, bearing: 0, pitch: 0 },
  { center: MITTE, zoom: 16, bearing: 90, pitch: 60 },
  { center: MITTE_EAST_2KM, zoom: 16, bearing: 90, pitch: 60 },
  { center: MITTE_EAST_2KM, zoom: 12, bearing: 90, pitch: 60 },
];

export const START: CameraState = KEYFRAMES[0]!;

const SEGMENTS = KEYFRAMES.length - 1;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function fixed(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function interpolate(a: CameraState, b: CameraState, t: number): CameraState {
  return {
    center: [fixed(lerp(a.center[0], b.center[0], t), 6), fixed(lerp(a.center[1], b.center[1], t), 6)],
    zoom: fixed(lerp(a.zoom, b.zoom, t), 4),
    bearing: fixed(lerp(a.bearing, b.bearing, t), 4),
    pitch: fixed(lerp(a.pitch, b.pitch, t), 4),
  };
}

/** The camera path sampled into `steps` states, equally many per segment, never repeating the start state. */
export function cameraPath(steps: number): CameraState[] {
  if (steps <= 0 || steps % SEGMENTS !== 0) throw new Error(`camera path steps must be a positive multiple of ${SEGMENTS}, got ${steps}`);
  const perSegment = steps / SEGMENTS;
  const out: CameraState[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    for (let i = 1; i <= perSegment; i++) out.push(interpolate(KEYFRAMES[s]!, KEYFRAMES[s + 1]!, i / perSegment));
  }
  return out;
}

export interface Viewpoint {
  id: string;
  title: string;
  state: CameraState;
}

/** Where the parity gate looks. */
export const VIEWPOINTS: Viewpoint[] = [
  { id: "overview-z11", title: "Overview, z11", state: { center: MITTE, zoom: 11, bearing: 0, pitch: 0 } },
  { id: "mid-z13", title: "Mid zoom, z13", state: { center: MITTE, zoom: 13, bearing: 0, pitch: 0 } },
  { id: "labels-z14", title: "Dense labels, z14", state: { center: MITTE, zoom: 14, bearing: 0, pitch: 0 } },
  { id: "streets-z16", title: "Streets, z16", state: { center: MITTE, zoom: 16, bearing: 0, pitch: 0 } },
  { id: "pitched-z15", title: "Pitched 60°, z15", state: { center: MITTE, zoom: 15, bearing: 0, pitch: 60 } },
  { id: "rotated-z15", title: "Rotated 45°, z15", state: { center: MITTE, zoom: 15, bearing: 45, pitch: 0 } },
];
