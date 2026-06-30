#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
VERSION="${1:-dev}"
export GOCACHE="${GOCACHE:-$ROOT/.cache/go-build}"
export GOMODCACHE="${GOMODCACHE:-$ROOT/.cache/go-mod}"

mkdir -p "$DIST"
mkdir -p "$GOCACHE" "$GOMODCACHE"

targets=(
  "windows amd64 .exe"
  "windows arm64 .exe"
  "linux amd64"
  "linux arm64"
  "darwin amd64"
  "darwin arm64"
)

for target in "${targets[@]}"; do
  read -r goos goarch suffix <<<"$target"
  outdir="$DIST/myoga-$VERSION-$goos-$goarch"
  mkdir -p "$outdir"
  binary="$outdir/myoga${suffix:-}"
  echo "building $binary"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$binary" "$ROOT"
  cp "$ROOT/README.md" "$outdir/README.md"
done

echo "release binaries written to $DIST"
