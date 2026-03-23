#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# check-license-boundary.sh — Verify MIT packages never import AGPL packages.
#
# ADR-013 licensing boundary: MIT-licensed packages must never import from
# AGPL-licensed packages, as this would contaminate the MIT code with AGPL
# obligations.
#
# MIT packages:  apps/engine, apps/cli, apps/shim-python, apps/shim-ts, packages/schemas
# AGPL packages: packages/backend (@loopstorm/api), packages/web (@loopstorm/web)
#
# Checks performed:
# 1. TypeScript/JavaScript: no `import ... from "@loopstorm/api"` or `@loopstorm/web`
#    in MIT source files.
# 2. package.json: no dependency on `@loopstorm/api` or `@loopstorm/web` in MIT
#    packages' dependencies (devDependencies excluded — they don't ship).
# 3. Python: no import of packages/backend or packages/web modules.
# 4. Rust: Rust crates don't depend on JS packages, but we verify Cargo.toml
#    does not reference any AGPL path.
#
# Usage: ./scripts/check-license-boundary.sh
# Exit 0 = clean, Exit 1 = AGPL contamination detected.

set -euo pipefail

FAIL=0

echo "=== AGPL/MIT Import Boundary Check ==="
echo ""

# -------------------------------------------------------------------------
# Check 1: TypeScript/JavaScript imports in MIT source files
# -------------------------------------------------------------------------
echo "--- Check 1: TS/JS imports in MIT packages ---"

MIT_TS_DIRS=(
  "apps/shim-ts/src"
  "apps/shim-ts/tests"
  "packages/schemas"
)

AGPL_IMPORT_PATTERN='@loopstorm/(api|web)'

for dir in "${MIT_TS_DIRS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi

  # Search for imports of AGPL packages
  MATCHES=$(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
    -E "(import|require).*['\"]${AGPL_IMPORT_PATTERN}" "$dir" 2>/dev/null || true)

  if [[ -n "$MATCHES" ]]; then
    echo "  FAIL: AGPL import found in MIT package:"
    echo "$MATCHES" | sed 's/^/    /'
    FAIL=1
  fi
done

if [[ $FAIL -eq 0 ]]; then
  echo "  No AGPL imports in MIT TypeScript/JavaScript source files. OK."
fi
echo ""

# -------------------------------------------------------------------------
# Check 2: package.json dependencies in MIT packages
# -------------------------------------------------------------------------
echo "--- Check 2: package.json dependencies ---"

MIT_PKG_DIRS=(
  "apps/shim-ts"
  "packages/schemas"
)

for pkg_dir in "${MIT_PKG_DIRS[@]}"; do
  if [[ ! -f "$pkg_dir/package.json" ]]; then
    continue
  fi

  # Check dependencies (NOT devDependencies — those don't ship)
  AGPL_DEPS=$(node -e "
    const pkg = require('./$pkg_dir/package.json');
    const deps = Object.keys(pkg.dependencies || {});
    const agpl = deps.filter(d => d === '@loopstorm/api' || d === '@loopstorm/web');
    if (agpl.length > 0) {
      console.log(agpl.join(', '));
    }
  " 2>/dev/null || true)

  if [[ -n "$AGPL_DEPS" ]]; then
    echo "  FAIL: $pkg_dir/package.json has AGPL dependency: $AGPL_DEPS"
    FAIL=1
  fi
done

if [[ $FAIL -eq 0 ]]; then
  echo "  No AGPL dependencies in MIT package.json files. OK."
fi
echo ""

# -------------------------------------------------------------------------
# Check 3: Python imports
# -------------------------------------------------------------------------
echo "--- Check 3: Python imports in MIT packages ---"

MIT_PY_DIRS=(
  "apps/shim-python"
)

for dir in "${MIT_PY_DIRS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi

  # Python shim should never import from packages/backend or packages/web.
  # Check for any suspicious relative imports or path manipulations.
  MATCHES=$(grep -rn --include="*.py" \
    -E "(packages\.backend|packages\.web|packages/backend|packages/web)" "$dir" 2>/dev/null || true)

  if [[ -n "$MATCHES" ]]; then
    echo "  FAIL: Reference to AGPL package found in MIT Python source:"
    echo "$MATCHES" | sed 's/^/    /'
    FAIL=1
  fi
done

if [[ $FAIL -eq 0 ]]; then
  echo "  No AGPL references in MIT Python source files. OK."
fi
echo ""

# -------------------------------------------------------------------------
# Check 4: Rust Cargo.toml
# -------------------------------------------------------------------------
echo "--- Check 4: Rust Cargo.toml ---"

MIT_CARGO_FILES=(
  "apps/engine/Cargo.toml"
  "apps/cli/Cargo.toml"
  "Cargo.toml"
)

for cargo_file in "${MIT_CARGO_FILES[@]}"; do
  if [[ ! -f "$cargo_file" ]]; then
    continue
  fi

  MATCHES=$(grep -n -i -E "(packages/backend|packages/web|agpl)" "$cargo_file" 2>/dev/null || true)

  if [[ -n "$MATCHES" ]]; then
    echo "  FAIL: AGPL reference found in $cargo_file:"
    echo "$MATCHES" | sed 's/^/    /'
    FAIL=1
  fi
done

if [[ $FAIL -eq 0 ]]; then
  echo "  No AGPL references in Rust Cargo.toml files. OK."
fi
echo ""

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
if [[ $FAIL -ne 0 ]]; then
  echo "BOUNDARY CHECK FAILED: AGPL contamination detected in MIT packages."
  echo ""
  echo "MIT packages must NEVER import from AGPL packages (ADR-013)."
  echo "The AGPL packages are: @loopstorm/api (packages/backend), @loopstorm/web (packages/web)."
  echo ""
  echo "If you need shared types, put them in packages/schemas (MIT)."
  exit 1
fi

echo "All AGPL/MIT boundary checks passed."
