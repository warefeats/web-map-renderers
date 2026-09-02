set dotenv-load

rig := env_var_or_default("RIG", "rig-windows")
rig_dir := env_var_or_default("RIG_DIR", "C:/bench/web-map-renderers")

check:
    bun run check

test:
    bun test

# GPU probe: launches the pinned Chromium the way the benchmark does and prints the renderer it got.
probe *ARGS:
    bun run src/probe.ts {{ARGS}}

# Static server alone (artifacts, style, sprite, glyphs, tiles, fixtures), for poking at a candidate by hand.
serve *ARGS:
    bun run src/server.ts {{ARGS}}

# Short protocol, every candidate, gate calibration output.
smoke *ARGS:
    bun run src/run.ts --smoke {{ARGS}}

# Full protocol, every candidate.
bench *ARGS:
    bun run src/run.ts {{ARGS}}

# Turn results.json into runs/<date>-<rig>.json and register it in benchmark.json.
import RESULTS="results.json":
    bun run src/import.ts --results={{RESULTS}}

# Corpus: download + verify inputs, cut tiles, extract the GeoJSON fixture.
corpus-fetch:
    bash corpus/fetch.sh

corpus-tiles:
    bash corpus/build-tiles.sh

corpus-fixture:
    bun run corpus/extract-buildings.ts

# Rig: push the repo and corpus cache to the Windows box, run there, pull results back.
rig-push:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp=$(mktemp -t wmr-push.XXXXXX.tgz)
    git ls-files -z | tar czf "$tmp" --null -T -
    ssh {{rig}} "New-Item -ItemType Directory -Force -Path '{{rig_dir}}/corpus/cache' | Out-Null"
    scp -q "$tmp" {{rig}}:{{rig_dir}}/push.tgz
    ssh {{rig}} "Set-Location '{{rig_dir}}'; tar -xzf push.tgz; Remove-Item push.tgz"
    rm -f "$tmp"
    ssh {{rig}} "Set-Location '{{rig_dir}}'; bun install --frozen-lockfile"

# Corpus cache to the rig: the MBTiles and the glyph tree, not the planetiler sources.
rig-push-corpus:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp=$(mktemp -t wmr-corpus.XXXXXX.tgz)
    tar czf "$tmp" -C corpus/cache berlin.mbtiles glyphs
    scp "$tmp" {{rig}}:{{rig_dir}}/corpus/cache/corpus.tgz
    ssh {{rig}} "Set-Location '{{rig_dir}}/corpus/cache'; tar -xzf corpus.tgz; Remove-Item corpus.tgz"
    rm -f "$tmp"

rig-probe:
    ssh {{rig}} "cd '{{rig_dir}}'; bun run src/probe.ts"

rig-smoke *ARGS:
    ssh {{rig}} "cd '{{rig_dir}}'; bun run src/run.ts --smoke {{ARGS}}"

rig-bench *ARGS:
    ssh {{rig}} "cd '{{rig_dir}}'; bun run src/run.ts {{ARGS}}"

rig-pull:
    scp {{rig}}:{{rig_dir}}/results.json ./results.json
