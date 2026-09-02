#!/usr/bin/env bash
# build-tiles.sh — build corpus/cache/berlin.mbtiles from the pinned Berlin extract with planetiler in Docker.
#
# Pins:
#   extract     cache/berlin-260101.osm.pbf (placed and checksum-verified by ./fetch.sh)
#   planetiler  ghcr.io/onthegomap/planetiler:0.10.2 (multi-arch index digest below), default OpenMapTiles profile
#   sources     natural earth, OSM water polygons and lake centerlines are fetched by planetiler's --download into
#               cache/sources/ on the first run and reused afterwards; their SHA-256s are recorded in checksums.txt.
#               The water-polygons URL is not versioned upstream (osmdata.openstreetmap.de republishes it), so a
#               fresh download on another day may differ from the recorded checksum; keep cache/sources/ to rebuild
#               the same tiles.
#
# Output: cache/berlin.mbtiles (z0-z14, gzip-compressed MVT blobs), cache/berlin.mbtiles.log (planetiler output) and
# cache/berlin.mbtiles.build-time.txt.
# Re-running is a no-op once the output exists; set FORCE=1 to rebuild. JAVA_HEAP overrides the 6 GB default and
# OUT_NAME the output file name (used to rebuild alongside the original for a determinism check).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$HERE/cache"
EXTRACT_NAME=berlin-260101.osm.pbf
OUT_NAME="${OUT_NAME:-berlin.mbtiles}"
IMAGE=ghcr.io/onthegomap/planetiler:0.10.2
IMAGE_DIGEST=sha256:cf32202dbc001a9ab4bc11534b642b13de3798179817da8558e567a3d13dd403
JAVA_HEAP="${JAVA_HEAP:--Xmx6g}"

if [ ! -f "$CACHE/$EXTRACT_NAME" ]; then
  echo "build-tiles: missing $CACHE/$EXTRACT_NAME — run ./fetch.sh first" >&2
  exit 1
fi
if [ -f "$CACHE/$OUT_NAME" ] && [ "${FORCE:-0}" != 1 ]; then
  echo "build-tiles: $CACHE/$OUT_NAME already exists (FORCE=1 to rebuild)"
  exit 0
fi
rm -f "$CACHE/$OUT_NAME"
mkdir -p "$CACHE/sources" "$CACHE/tmp"

echo "build-tiles: $IMAGE@$IMAGE_DIGEST, heap $JAVA_HEAP"
start=$(date +%s)
# The image has no WORKDIR, so planetiler's relative defaults (data/sources, data/tmp) resolve under /data;
# every path is still passed explicitly so the layout does not depend on that.
docker run --rm \
  -e JAVA_TOOL_OPTIONS="$JAVA_HEAP" \
  -v "$CACHE":/data \
  "$IMAGE@$IMAGE_DIGEST" \
  --osm_path=/data/"$EXTRACT_NAME" \
  --output=/data/"$OUT_NAME" \
  --download \
  --natural_earth_path=/data/sources/natural_earth_vector.sqlite.zip \
  --water_polygons_path=/data/sources/water-polygons-split-3857.zip \
  --lake_centerlines_path=/data/sources/lake_centerline.shp.zip \
  --tmpdir=/data/tmp \
  --force \
  2>&1 | tee "$CACHE/$OUT_NAME.log"
end=$(date +%s)
rm -rf "$CACHE/tmp"

elapsed=$((end - start))
printf 'build-tiles: wrote %s in %dm%02ds\n' "$CACHE/$OUT_NAME" $((elapsed / 60)) $((elapsed % 60)) | tee "$CACHE/$OUT_NAME.build-time.txt"
