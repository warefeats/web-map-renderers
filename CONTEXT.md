# web-map-renderers

The runner behind the browser map renderer benchmark: three pinned renderer builds fed identical self-hosted tiles, style, sprites and glyphs, measured in one pinned Chromium on one rig. Shared catalog terms live in the site repo's glossary; only renderer-specific language is defined here.

## Language

**Candidate**:
One pinned renderer build: `mapbox-gl` 1.13.3, `maplibre-gl` 5.24.0, or `maplibre-gl` 6.7.0. Never "Mapbox" or "MapLibre" alone.
_Avoid_: library, engine, renderer (as a candidate name)

**Reference candidate**:
The candidate whose rendered-feature counts and screenshots the parity gate compares the others against: `mapbox-gl` 1.13.3, the fork point.
_Avoid_: baseline, control

**Camera path**:
The single deterministic sequence of camera states over Berlin every candidate traverses: z11 over Mitte, zoom to z16 while rotating and pitching, pan east, zoom out to z12.
_Avoid_: route, flight, tour, animation

**View**:
One camera state on the camera path at which the map is allowed to reach idle. The cold pan is 60 views.
_Avoid_: stop, waypoint, keyframe

**Step**:
One camera state on the camera path applied with a jump and advanced on the next render. The warm paint is 600 steps.
_Avoid_: frame, tick

**Cold pan**:
The first traversal of the camera path in a fresh browser context, advancing view by view on the map's idle event, so every view includes tile fetch and parse. Reported as milliseconds per view.
_Avoid_: cold run, load test, first pass

**Warm paint**:
The second traversal of the camera path with every tile already resident, advancing step by step on the map's render event. Reported as milliseconds per frame.
_Avoid_: hot run, paint test, fps

**Startup timeline**:
The five lifecycle marks both renderers expose through their public events: bundle import, style load, first tile, load, first idle.
_Avoid_: load time, time to interactive

**Viewpoint**:
One of six fixed camera states at which the parity gate queries rendered features and takes a screenshot.
_Avoid_: checkpoint, sample point

**Parity gate**:
The precondition that every candidate renders, at every viewpoint, a per-source-layer feature count within the frozen tolerance of the reference candidate. A failed gate invalidates the run.
_Avoid_: visual parity score, similarity, pixel match

**GPU assert**:
The check at the start of every run that the browser's unmasked WebGL renderer names the rig's GPU through Direct3D 11 and not a software rasterizer.
_Avoid_: gpu check, sanity check

**Network block**:
The harness rule that aborts any browser request not addressed to the loopback server and fails the run naming the candidate and URL.
_Avoid_: offline mode, request filter
