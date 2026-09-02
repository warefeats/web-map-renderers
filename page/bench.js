// The in-page half of the harness. Drives whichever candidate the runner loads through the public API
// the three builds share, and reports timings from the map's own events. No candidate-specific code.
(() => {
  const marks = {};
  const errors = [];
  const bench = { marks, errors, lib: null, map: null, candidate: null, ready: true };
  window.bench = bench;

  function withTimeout(promise, ms, what) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms waiting for ${what}`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function once(map, event, ms, what) {
    return withTimeout(new Promise((resolve) => map.once(event, resolve)), ms, what || event);
  }

  function loadCss(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = resolve;
      link.onerror = () => reject(new Error(`stylesheet failed: ${href}`));
      document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`script failed: ${src}`));
      document.head.appendChild(script);
    });
  }

  // Bundle import: stylesheet first (not timed), then the JS, timed from tag insertion to evaluation.
  bench.loadLib = async (meta) => {
    bench.candidate = meta.id;
    await loadCss(`/vendor/${meta.id}/${meta.css}`);
    marks.importStart = performance.now();
    if (meta.kind === "esm") {
      const mod = await import(`/vendor/${meta.id}/${meta.js}`);
      bench.lib = mod.default || mod;
    } else {
      await loadScript(`/vendor/${meta.id}/${meta.js}`);
      bench.lib = window[meta.global];
    }
    marks.importEnd = performance.now();
    if (!bench.lib || typeof bench.lib.Map !== "function") throw new Error("library did not expose Map");
    return {
      importMs: marks.importEnd - marks.importStart,
      libraryVersion: bench.lib.version || (typeof bench.lib.getVersion === "function" ? bench.lib.getVersion() : null),
      workerCount:
        typeof bench.lib.workerCount === "number"
          ? bench.lib.workerCount
          : typeof bench.lib.getWorkerCount === "function"
            ? bench.lib.getWorkerCount()
            : null,
    };
  };

  // Startup timeline: create the map and record style load, first tile, load, first idle relative to construction.
  bench.start = ({ state, options, idleTimeoutMs }) =>
    new Promise((resolve, reject) => {
      const lib = bench.lib;
      const timer = setTimeout(() => reject(new Error(`timeout after ${idleTimeoutMs} ms waiting for first idle`)), idleTimeoutMs);
      marks.mapCreate = performance.now();
      const map = new lib.Map({
        container: "map",
        style: "/style.json",
        center: state.center,
        zoom: state.zoom,
        bearing: state.bearing,
        pitch: state.pitch,
        ...options,
      });
      bench.map = map;
      marks.styleLoad = null;
      marks.firstTile = null;
      marks.load = null;
      marks.firstIdle = null;
      map.on("error", (e) => errors.push(String((e && e.error && e.error.message) || (e && e.message) || e)));
      map.on("data", (e) => {
        if (marks.firstTile === null && e.dataType === "source" && e.tile) marks.firstTile = performance.now();
      });
      map.once("style.load", () => {
        marks.styleLoad = performance.now();
      });
      map.once("load", () => {
        marks.load = performance.now();
      });
      // Synchronous handlers on purpose: load and the first idle can fire in the same render pass.
      const onIdle = () => {
        if (marks.load === null) return;
        marks.firstIdle = performance.now();
        map.off("idle", onIdle);
        clearTimeout(timer);
        const rel = (v) => (v === null ? null : v - marks.mapCreate);
        resolve({
          importMs: marks.importEnd - marks.importStart,
          styleLoadMs: rel(marks.styleLoad),
          firstTileMs: rel(marks.firstTile),
          loadMs: rel(marks.load),
          firstIdleMs: rel(marks.firstIdle),
        });
      };
      map.on("idle", onIdle);
    });

  bench.jumpTo = (state) => {
    bench.map.jumpTo({ center: state.center, zoom: state.zoom, bearing: state.bearing, pitch: state.pitch });
  };

  // Cold pan: advance a view only when the map reports idle, so each view includes fetch and parse.
  bench.traverseIdle = async (states, idleTimeoutMs) => {
    const out = [];
    for (let i = 0; i < states.length; i++) {
      const t0 = performance.now();
      const idle = once(bench.map, "idle", idleTimeoutMs, `idle at view ${i}`);
      bench.jumpTo(states[i]);
      await idle;
      out.push(performance.now() - t0);
    }
    return out;
  };

  // Warm paint: advance a step on every render, so the camera moves every frame.
  bench.traverseRender = async (states, timeoutMs) => {
    const out = [];
    for (let i = 0; i < states.length; i++) {
      const t0 = performance.now();
      const rendered = once(bench.map, "render", timeoutMs, `render at step ${i}`);
      bench.jumpTo(states[i]);
      await rendered;
      out.push(performance.now() - t0);
    }
    return out;
  };

  // GeoJSON: parsed data handed to the source so only worker processing, indexing and painting are timed; then removed.
  bench.geojson = async (url, idleTimeoutMs) => {
    const data = await (await fetch(url)).json();
    const map = bench.map;
    const t0 = performance.now();
    const idle = once(map, "idle", idleTimeoutMs, "idle after GeoJSON add");
    map.addSource("bench-buildings", { type: "geojson", data });
    map.addLayer({
      id: "bench-buildings",
      type: "fill",
      source: "bench-buildings",
      paint: { "fill-color": "#e11d48", "fill-opacity": 0.6, "fill-outline-color": "#881337" },
    });
    await idle;
    const ms = performance.now() - t0;
    const cleared = once(map, "idle", idleTimeoutMs, "idle after GeoJSON removal");
    map.removeLayer("bench-buildings");
    map.removeSource("bench-buildings");
    await cleared;
    return { ms, features: data.features.length };
  };

  // Parity gate input: rendered features at a viewpoint, grouped by source layer and by style layer.
  bench.viewAndCount = async (state, idleTimeoutMs) => {
    const idle = once(bench.map, "idle", idleTimeoutMs, "idle at viewpoint");
    bench.jumpTo(state);
    await idle;
    const features = bench.map.queryRenderedFeatures();
    const bySourceLayer = {};
    const byLayer = {};
    for (const f of features) {
      const sourceLayer = f.sourceLayer || (f.layer && f.layer["source-layer"]) || "(none)";
      bySourceLayer[sourceLayer] = (bySourceLayer[sourceLayer] || 0) + 1;
      const layerId = f.layer ? f.layer.id : "(none)";
      byLayer[layerId] = (byLayer[layerId] || 0) + 1;
    }
    return { total: features.length, bySourceLayer, byLayer, zoom: bench.map.getZoom() };
  };

  // JS heap including dedicated workers; needs cross-origin isolation, which the server provides.
  bench.jsHeap = async () => {
    if (!performance.measureUserAgentSpecificMemory) return null;
    const m = await performance.measureUserAgentSpecificMemory();
    return m.bytes;
  };
})();
