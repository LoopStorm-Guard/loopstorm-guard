#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# check-js-licenses.sh — Verify no GPL-incompatible deps in MIT JS/TS packages.
#
# Scans the dependency trees of MIT-licensed Bun workspaces:
#   - apps/shim-ts
#   - packages/schemas
#
# AGPL-licensed packages (packages/backend, packages/web) are excluded because
# AGPL is copyleft and may depend on any license it is compatible with.
#
# Usage: ./scripts/check-js-licenses.sh
# Exit 0 = all clean, Exit 1 = GPL-incompatible dependency found.

set -euo pipefail

FAIL=0

# GPL-family license identifiers that are incompatible with MIT distribution.
# This pattern matches common SPDX identifiers and license-checker output.
GPL_PATTERN="GPL|AGPL|LGPL|SSPL|EUPL|CPAL|OSL"

echo "=== JS/TS Dependency License Audit ==="
echo ""

# MIT-licensed workspaces to audit.
MIT_PACKAGES=(
  "apps/shim-ts"
  "packages/schemas"
)

for pkg_dir in "${MIT_PACKAGES[@]}"; do
  if [[ ! -d "$pkg_dir" ]]; then
    echo "SKIP: $pkg_dir (directory not found)"
    continue
  fi

  if [[ ! -f "$pkg_dir/package.json" ]]; then
    echo "SKIP: $pkg_dir (no package.json)"
    continue
  fi

  echo "--- Checking: $pkg_dir ---"

  # Read the dependencies and devDependencies from package.json.
  # We only care about production dependencies for license contamination.
  # devDependencies do not ship in the distributed package.
  DEPS=$(cd "$pkg_dir" && node -e "
    const pkg = require('./package.json');
    const deps = Object.keys(pkg.dependencies || {});
    // Exclude workspace references (they are our own packages)
    const external = deps.filter(d => !d.startsWith('@loopstorm/'));
    console.log(external.join('\n'));
  " 2>/dev/null || true)

  if [[ -z "$DEPS" ]]; then
    echo "  No external production dependencies. OK."
    echo ""
    continue
  fi

  # For each dependency, check its license field in its package.json
  # within node_modules.
  while IFS= read -r dep; do
    # Resolve the dependency's package.json
    DEP_PKG=""
    # Try the workspace root node_modules first (Bun hoists)
    if [[ -f "node_modules/$dep/package.json" ]]; then
      DEP_PKG="node_modules/$dep/package.json"
    elif [[ -f "$pkg_dir/node_modules/$dep/package.json" ]]; then
      DEP_PKG="$pkg_dir/node_modules/$dep/package.json"
    fi

    if [[ -z "$DEP_PKG" ]]; then
      echo "  WARN: Cannot find package.json for $dep (may not be installed)"
      continue
    fi

    LICENSE=$(node -e "
      const pkg = require('./$DEP_PKG');
      console.log(pkg.license || 'UNKNOWN');
    " 2>/dev/null || echo "UNKNOWN")

    if echo "$LICENSE" | grep -qEi "$GPL_PATTERN"; then
      echo "  FAIL: $dep has license '$LICENSE' — incompatible with MIT"
      FAIL=1
    fi
  done <<< "$DEPS"

  if [[ $FAIL -eq 0 ]]; then
    echo "  All production dependencies OK."
  fi
  echo ""
done

if [[ $FAIL -ne 0 ]]; then
  echo "LICENSE AUDIT FAILED: GPL-incompatible dependencies found in MIT packages."
  echo "See ADR-013 for licensing boundary rules."
  exit 1
fi

echo "All JS/TS license checks passed."
