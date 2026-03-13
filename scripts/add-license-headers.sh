#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# scripts/add-license-headers.sh
#
# Mass-adds missing SPDX license headers to source files based on their path.
# Run this once after cloning to fix any files that predate the header requirement.
#
# MIT  → apps/, packages/schemas/
# AGPL → packages/backend/, packages/web/
#
# Idempotent: files that already have a correct SPDX header are skipped.
# Files that have an INCORRECT header are reported but NOT modified — fix manually.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ADDED=0
SKIPPED=0
WRONG=0

add_header_if_missing() {
  local file="$1"
  local spdx="$2"
  local ext="${file##*.}"

  # Determine comment prefix
  case "$ext" in
    rs|ts|tsx) prefix="//" ;;
    py)        prefix="#"  ;;
    *)         return 0    ;;
  esac

  local header="${prefix} SPDX-License-Identifier: ${spdx}"
  local first_line
  first_line=$(head -n1 "$file")

  if [[ "$first_line" == "${prefix} SPDX-License-Identifier: ${spdx}" ]]; then
    # Already correct
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  if echo "$first_line" | grep -q "SPDX-License-Identifier:"; then
    # Has a header but wrong license
    echo "WRONG LICENSE: $file"
    echo "  Has    : $first_line"
    echo "  Needs  : $header"
    WRONG=$((WRONG + 1))
    return 0
  fi

  # Prepend header
  local tmp
  tmp=$(mktemp)
  echo "$header" | cat - "$file" > "$tmp"
  mv "$tmp" "$file"
  echo "ADDED: $file"
  ADDED=$((ADDED + 1))
}

# MIT paths
while IFS= read -r -d '' file; do
  add_header_if_missing "$file" "MIT"
done < <(find apps/ packages/schemas/ -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.rs" \) -print0 2>/dev/null || true)

# AGPL paths
while IFS= read -r -d '' file; do
  add_header_if_missing "$file" "AGPL-3.0-only"
done < <(find packages/backend/ packages/web/ -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.rs" \) -print0 2>/dev/null || true)

echo ""
echo "Summary: $ADDED added, $SKIPPED already correct, $WRONG wrong (fix manually)"

if [[ $WRONG -gt 0 ]]; then
  echo "ERROR: $WRONG files have incorrect license headers. Fix them manually per ADR-013."
  exit 1
fi
