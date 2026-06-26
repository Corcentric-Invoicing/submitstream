#!/bin/bash
# Upload all portal-deploy files to R2 under the portal/ prefix
# Run from the worker-deploy directory: bash upload-portal.sh

PORTAL_DIR="../portal-deploy"
BUCKET="invoice-pdfs"

if [ ! -d "$PORTAL_DIR" ]; then
  echo "Error: $PORTAL_DIR not found"
  exit 1
fi

echo "Uploading portal assets to R2 bucket: $BUCKET"

# Upload all files recursively
find "$PORTAL_DIR" -type f ! -path "*/.wrangler/*" | while read -r file; do
  # Get relative path from portal-deploy dir
  rel_path="${file#$PORTAL_DIR/}"
  r2_key="portal/$rel_path"

  # Determine content type
  case "$file" in
    *.html) ct="text/html; charset=utf-8" ;;
    *.js)   ct="application/javascript; charset=utf-8" ;;
    *.css)  ct="text/css; charset=utf-8" ;;
    *.svg)  ct="image/svg+xml" ;;
    *.png)  ct="image/png" ;;
    *.jpg|*.jpeg) ct="image/jpeg" ;;
    *.ico)  ct="image/x-icon" ;;
    *.json) ct="application/json" ;;
    *.woff2) ct="font/woff2" ;;
    *.woff) ct="font/woff" ;;
    *.sql)  ct="text/plain" ;;
    *)      ct="application/octet-stream" ;;
  esac

  echo "  → $r2_key ($ct)"
  npx wrangler r2 object put "$BUCKET/$r2_key" --file="$file" --content-type="$ct" --remote 2>&1 | tail -1
done

echo ""
echo "Done! Portal assets uploaded to R2."
