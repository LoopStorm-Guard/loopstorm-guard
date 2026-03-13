#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# scripts/pre-commit-license-check.sh
#
# Pre-commit hook: checks staged files for correct SPDX headers.
# Install: cp scripts/pre-commit-license-check.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#
# This hook mirrors the CI license-check job exactly so failures are caught
# locally before a push.

set -euo pipefail

FAIL=0

check_staged_file() {
  local file="$1"
  local expected_spdx="$2"
  local ext="${file##*.}"

  case "$ext" in
    rs|ts|tsx) prefix="//" ;;
    py)        prefix="#"  ;;
    *)         return 0    ;;
  esac

  local header="${prefix} SPDX-License-Identifier: ${expected_spdx}"
  local first_line
  first_line=$(git show ":$file" 2>/dev/null | head -n1 || head -n1 "$file" 2>/dev/null || true)

  if [[ "$first_line" != "$header" ]]; then
    echo "MISSING OR WRONG SPDX HEADER: $file"
    echo "  Expected : $header"
    echo "  Got      : $first_line"
    FAIL=1
  fi
}

# Get list of staged .ts/.tsx/.py/.rs files
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ ! -f "$file" ]] && continue

  # Determine expected license by path
  if [[ "$file" == apps/* ]] || [[ "$file" == packages/schemas/* ]]; then
    check_staged_file "$file" "MIT"
  elif [[ "$file" == packages/backend/* ]] || [[ "$file" == packages/web/* ]]; then
    check_staged_file "$file" "AGPL-3.0-only"
  fi
done < <(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|py|rs)$' || true)

if [[ $FAIL -ne 0 ]]; then
  echo ""
  echo "Pre-commit hook FAILED: SPDX license headers missing or incorrect."
  echo "Run: bash scripts/add-license-headers.sh"
  echo "Then re-stage the fixed files."
  exit 1
fi
