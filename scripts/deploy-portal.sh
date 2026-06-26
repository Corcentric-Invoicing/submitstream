#!/usr/bin/env bash
# ============================================================
# deploy-portal.sh
# ============================================================
# Build the React portal and upload it to the submitstream R2
# bucket where the Worker serves it from.
#
# What this does:
#   1. Builds packages/portal → dist/
#   2. Uploads dist/index.html → R2: invoice-pdfs/portal/index.html
#   3. Uploads dist/assets/* → R2: invoice-pdfs/portal/assets/*
#   4. Optionally redeploys the Worker (--with-worker flag)
#
# Pre-flight: you must be logged into wrangler (`wrangler whoami`)
# against the submitstream account (50c65f617dd2112476424061ea46db14).
#
# Usage:
#   ./scripts/deploy-portal.sh                # portal only
#   ./scripts/deploy-portal.sh --with-worker  # portal + worker
# ============================================================
set -euo pipefail

# Resolve paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PORTAL_DIR="$REPO_ROOT/packages/portal"
WORKER_DIR="${WORKER_DIR:-$HOME/Downloads/ocr processing/worker-deploy}"
BUCKET="invoice-pdfs"
PREFIX="portal"

# Helper that uploads a single file with the right content type.
# Wrangler 3.x defaults to remote R2 (no --remote flag — that's wrangler 4).
upload() {
  local key="$1"
  local file="$2"
  local content_type="$3"
  npx wrangler r2 object put "$BUCKET/$key" \
    --file="$file" \
    --content-type="$content_type"
}

# ── Build ──────────────────────────────────────────────────
echo "→ Building React portal"
cd "$PORTAL_DIR"
rm -rf dist
npm run build

if [[ ! -d "dist" || ! -f "dist/index.html" ]]; then
  echo "✗ Build did not produce dist/index.html. Aborting."
  exit 1
fi

# ── Upload index.html ──────────────────────────────────────
echo "→ Uploading dist/index.html → r2://$BUCKET/$PREFIX/index.html"
upload "$PREFIX/index.html" "dist/index.html" "text/html; charset=utf-8"

# ── Upload favicon (if present) ────────────────────────────
if [[ -f "dist/favicon.svg" ]]; then
  echo "→ Uploading dist/favicon.svg → r2://$BUCKET/$PREFIX/favicon.svg"
  upload "$PREFIX/favicon.svg" "dist/favicon.svg" "image/svg+xml"
fi

# ── Upload all asset files ─────────────────────────────────
echo "→ Uploading dist/assets/* → r2://$BUCKET/$PREFIX/assets/"
shopt -s nullglob
for f in dist/assets/*; do
  name=$(basename "$f")
  case "$name" in
    *.js)         ct="application/javascript; charset=utf-8" ;;
    *.css)        ct="text/css; charset=utf-8" ;;
    *.svg)        ct="image/svg+xml" ;;
    *.png)        ct="image/png" ;;
    *.jpg|*.jpeg) ct="image/jpeg" ;;
    *.woff)       ct="font/woff" ;;
    *.woff2)      ct="font/woff2" ;;
    *)            ct="application/octet-stream" ;;
  esac
  echo "  • $name ($ct)"
  upload "$PREFIX/assets/$name" "$f" "$ct"
done

echo "✓ Portal upload complete"

# ── Optionally deploy the Worker ───────────────────────────
if [[ "${1:-}" == "--with-worker" ]]; then
  echo ""
  echo "→ Deploying Worker from $WORKER_DIR"
  if [[ ! -d "$WORKER_DIR" ]]; then
    echo "✗ Worker directory not found at: $WORKER_DIR"
    echo "  Set WORKER_DIR env var if it's elsewhere."
    exit 1
  fi
  cd "$WORKER_DIR"
  npx wrangler deploy
  echo "✓ Worker deployed"
fi

echo ""
echo "Done. Hit https://submitstream.com to verify."
