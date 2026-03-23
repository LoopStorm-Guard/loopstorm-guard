#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# sync-schemas.sh — Copy canonical schemas to packages/schemas/.
#
# Source of truth: schemas/ (repo root)
# Destination:     packages/schemas/ (TypeScript package)
#
# This script copies JSON schema files from the canonical location to the
# TypeScript package. The canonical location is used by:
#   - apps/engine/build.rs (compile-time hash assertion)
#   - VERIFY.md (human-readable hash record)
#   - CI schema-hash-check job
#
# The packages/schemas/ copy is consumed by:
#   - packages/schemas/index.ts (TypeScript exports)
#   - packages/backend (via @loopstorm/schemas import)
#   - packages/web (via @loopstorm/schemas import)
#
# Usage:
#   ./scripts/sync-schemas.sh        — copy schemas and verify hashes match
#   ./scripts/sync-schemas.sh --check — verify only (exit 1 if out of sync)

set -euo pipefail

MODE="${1:-sync}"

SCHEMAS=(
  "events/event.schema.json"
  "ipc/decision-request.schema.json"
  "ipc/decision-response.schema.json"
  "policy/policy.schema.json"
)

SRC_DIR="schemas"
DST_DIR="packages/schemas"

FAIL=0

echo "=== Schema Path Sync ==="
echo "Source: $SRC_DIR/ (canonical)"
echo "Dest:   $DST_DIR/ (TypeScript package)"
echo ""

for schema in "${SCHEMAS[@]}"; do
  SRC="$SRC_DIR/$schema"
  DST="$DST_DIR/$schema"

  if [[ ! -f "$SRC" ]]; then
    echo "ERROR: Canonical schema not found: $SRC"
    FAIL=1
    continue
  fi

  if [[ "$MODE" == "--check" ]]; then
    # Verify mode: check that dest exists and matches source
    if [[ ! -f "$DST" ]]; then
      echo "FAIL: $DST does not exist (source: $SRC)"
      FAIL=1
      continue
    fi

    SRC_HASH=$(sha256sum "$SRC" | awk '{print $1}')
    DST_HASH=$(sha256sum "$DST" | awk '{print $1}')

    if [[ "$SRC_HASH" != "$DST_HASH" ]]; then
      echo "FAIL: $schema — hashes differ"
      echo "  Source ($SRC): $SRC_HASH"
      echo "  Dest   ($DST): $DST_HASH"
      echo "  Run: ./scripts/sync-schemas.sh"
      FAIL=1
    else
      echo "OK: $schema ($SRC_HASH)"
    fi
  else
    # Sync mode: copy source to dest
    mkdir -p "$(dirname "$DST")"
    cp "$SRC" "$DST"
    HASH=$(sha256sum "$DST" | awk '{print $1}')
    echo "Copied: $schema ($HASH)"
  fi
done

echo ""

if [[ $FAIL -ne 0 ]]; then
  echo "SCHEMA SYNC CHECK FAILED."
  echo ""
  echo "The schema files in packages/schemas/ are out of sync with schemas/."
  echo "The canonical source is schemas/ (repo root)."
  echo ""
  echo "To fix: run ./scripts/sync-schemas.sh"
  exit 1
fi

if [[ "$MODE" == "--check" ]]; then
  echo "All schema files in sync."
else
  echo "Schema sync complete."
fi
