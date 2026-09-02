#!/usr/bin/env bash
# fetch.sh — download and checksum-verify every corpus input into corpus/cache/, then stage the committed style/ files.
#
# Idempotent: a cached file with the right checksum is not downloaded again; one with a wrong checksum is re-fetched
# once and the script refuses to continue if it still mismatches (the bad file is kept as *.rejected for inspection).
#
# Inputs and pins (SHA-256 unless noted):
#   1. OSM extract  berlin-260101.osm.pbf — Geofabrik Berlin, 2026-01-01 snapshot.
#        Copied from ../../vector-tile-servers/data/cache/ when that sibling checkout exists (override: EXTRACT_LOCAL),
#        otherwise downloaded from download.geofabrik.de. MD5 and SHA-256 are both enforced.
#   2. OSM Bright style — openmaptiles/osm-bright-gl-style @ 563b249f7ae71528b1f1e327cb9c019d0dda4c50 (master,
#        2026-08-04). style.json and LICENSE.md; that commit has no LICENSE file and no sprite files.
#   3. OSM Bright sprites — the same repo's gh-pages build @ 286b174adbd6e8693887841d6cfdf7445cd5f8c0
#        ("Update sprites", 2026-08-04T08:21Z, generated from the pinned commit). Fetched 2026-09-02; the live
#        https://openmaptiles.github.io/osm-bright-gl-style/ served byte-identical files that day.
#   4. Glyphs — openmaptiles/fonts release v2.0, noto-sans.zip: Noto Sans Regular / Bold / Italic, 256 ranges each,
#        extracted into cache/glyphs/<fontstack>/<range>.pbf.
#
# After fetching, LICENSE.md and the four sprite files are copied into style/ and rewrite-style.ts derives
# style/osm-bright.json (it also checks that every fontstack the style requests has a glyph directory).
#
# Requires: bash, curl, shasum or sha256sum, md5 or md5sum, unzip, bun.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$HERE/cache"
STYLE="$HERE/style"
mkdir -p "$CACHE" "$STYLE"

EXTRACT_NAME=berlin-260101.osm.pbf
EXTRACT_URL="https://download.geofabrik.de/europe/germany/$EXTRACT_NAME"
EXTRACT_LOCAL="${EXTRACT_LOCAL:-$HERE/../../vector-tile-servers/data/cache/$EXTRACT_NAME}"
EXTRACT_MD5=6d6de8da2d8192c5bbe7dd00e1004c82
EXTRACT_SHA256=9a5dff3801473f7d59dc41cad2224c6f590d7d0cb9d8dc0789970902f13c6e94

STYLE_COMMIT=563b249f7ae71528b1f1e327cb9c019d0dda4c50
STYLE_RAW="https://raw.githubusercontent.com/openmaptiles/osm-bright-gl-style/$STYLE_COMMIT"
STYLE_JSON_SHA256=f22ea32155549fb694581d3623ecbb32edea68f599e19861f06b4c62d1d524ce
STYLE_LICENSE_SHA256=aa25033b12c9cbf8c2d95a310c66ce08727c01139d23de6df5ae97505fb98f82

SPRITE_COMMIT=286b174adbd6e8693887841d6cfdf7445cd5f8c0
SPRITE_RAW="https://raw.githubusercontent.com/openmaptiles/osm-bright-gl-style/$SPRITE_COMMIT"
SPRITE_JSON_SHA256=73586a1c10e60b536a3a7b8b3d4e70cd4e6ffa6afe801ff1cb08f38bf38d7cb0
SPRITE_PNG_SHA256=66f12c218af7bada52ccd319013f73c570f3fe1b90d2c79e26bb4d30f7a121f8
SPRITE2X_JSON_SHA256=89bc79bdad0a0351cab255c8db20485f741c9f606e98f564f6918c0a44845809
SPRITE2X_PNG_SHA256=c26647b95eb807beb0c7d9439d4a02468e7c19aa8f665b5e8580794fbfc0478a

FONTS_URL=https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-sans.zip
FONTS_SHA256=d117316544b43a5dde7ee761b36e17701e9f85574e181d76a74814240fdbaf34

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi
}
md5hex() {
  if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1" | cut -d' ' -f1; fi
}

# verify FILE SHA256 [MD5] — exit status only; prints the mismatch to stderr.
verify() {
  local file=$1 want=$2 md5want=${3:-} got
  got=$(sha256 "$file")
  if [ "$got" != "$want" ]; then
    printf 'fetch: SHA-256 mismatch for %s\n  want %s\n  got  %s\n' "${file#"$HERE"/}" "$want" "$got" >&2
    return 1
  fi
  if [ -n "$md5want" ]; then
    got=$(md5hex "$file")
    if [ "$got" != "$md5want" ]; then
      printf 'fetch: MD5 mismatch for %s (want %s, got %s)\n' "${file#"$HERE"/}" "$md5want" "$got" >&2
      return 1
    fi
  fi
}

# fetch URL DEST SHA256 [MD5] — download when missing or wrong, verify, refuse on a persistent mismatch.
fetch() {
  local url=$1 dest=$2 sha=$3 md5=${4:-}
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ]; then
    if verify "$dest" "$sha" "$md5" 2>/dev/null; then
      echo "fetch: ok        ${dest#"$HERE"/}"
      return 0
    fi
    echo "fetch: cached copy of ${dest#"$HERE"/} fails its checksum, fetching again" >&2
    rm -f "$dest"
  fi
  echo "fetch: download  $url"
  curl -fsSL --retry 3 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
  if ! verify "$dest" "$sha" "$md5"; then
    mv "$dest" "$dest.rejected"
    echo "fetch: refusing to continue; the rejected download is at ${dest#"$HERE"/}.rejected" >&2
    exit 1
  fi
  echo "fetch: verified  ${dest#"$HERE"/}"
}

# stage SRC DEST — copy into style/ when missing or different.
stage() {
  if [ ! -f "$2" ] || ! cmp -s "$1" "$2"; then
    cp "$1" "$2"
    echo "fetch: staged    ${2#"$HERE"/}"
  else
    echo "fetch: ok        ${2#"$HERE"/}"
  fi
}

# 1. OSM extract
if [ ! -f "$CACHE/$EXTRACT_NAME" ] && [ -f "$EXTRACT_LOCAL" ]; then
  echo "fetch: copying   $EXTRACT_LOCAL"
  cp "$EXTRACT_LOCAL" "$CACHE/$EXTRACT_NAME.part"
  mv "$CACHE/$EXTRACT_NAME.part" "$CACHE/$EXTRACT_NAME"
fi
fetch "$EXTRACT_URL" "$CACHE/$EXTRACT_NAME" "$EXTRACT_SHA256" "$EXTRACT_MD5"

# 2. Style + licence at the pinned commit
fetch "$STYLE_RAW/style.json" "$CACHE/upstream-style/style.json" "$STYLE_JSON_SHA256"
fetch "$STYLE_RAW/LICENSE.md" "$CACHE/upstream-style/LICENSE.md" "$STYLE_LICENSE_SHA256"

# 3. Sprites from the pinned gh-pages build
fetch "$SPRITE_RAW/sprite.json" "$CACHE/sprites/sprite.json" "$SPRITE_JSON_SHA256"
fetch "$SPRITE_RAW/sprite.png" "$CACHE/sprites/sprite.png" "$SPRITE_PNG_SHA256"
fetch "$SPRITE_RAW/sprite@2x.json" "$CACHE/sprites/sprite@2x.json" "$SPRITE2X_JSON_SHA256"
fetch "$SPRITE_RAW/sprite@2x.png" "$CACHE/sprites/sprite@2x.png" "$SPRITE2X_PNG_SHA256"

# 4. Glyphs
fetch "$FONTS_URL" "$CACHE/noto-sans.zip" "$FONTS_SHA256"
GLYPH_STAMP="$CACHE/glyphs/.extracted-from-${FONTS_SHA256:0:16}"
if [ ! -f "$GLYPH_STAMP" ]; then
  echo "fetch: extracting noto-sans.zip into cache/glyphs/"
  rm -rf "$CACHE/glyphs"
  mkdir -p "$CACHE/glyphs"
  unzip -q "$CACHE/noto-sans.zip" -d "$CACHE/glyphs"
  touch "$GLYPH_STAMP"
else
  echo "fetch: ok        cache/glyphs/ (extracted)"
fi

# 5. Stage the committed style/ directory
stage "$CACHE/upstream-style/LICENSE.md" "$STYLE/LICENSE.md"
for f in sprite.json sprite.png sprite@2x.json sprite@2x.png; do
  stage "$CACHE/sprites/$f" "$STYLE/$f"
done
bun run "$HERE/rewrite-style.ts"

echo "fetch: done — inputs verified in cache/, style/ staged; next: ./build-tiles.sh"
