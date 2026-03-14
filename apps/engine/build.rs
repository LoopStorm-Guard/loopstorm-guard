// SPDX-License-Identifier: MIT
//! build.rs — Policy schema integrity check (ADR-003).
//!
//! At build time, computes the SHA-256 hash of `schemas/policy/policy.schema.json`
//! (relative to the workspace root, located via CARGO_MANIFEST_DIR) and asserts it
//! matches POLICY_SCHEMA_HASH. If the schema has changed without updating this hash,
//! the build fails with a clear error message directing the developer to the process
//! documented in ADR-003.
//!
//! To update the hash after an intentional schema change:
//!   sha256sum schemas/policy/policy.schema.json
//! Then update POLICY_SCHEMA_HASH below and commit both files together.

use std::fs;
use std::path::PathBuf;

/// SHA-256 hex digest of schemas/policy/policy.schema.json.
/// This value is the single enforcement point for ADR-003.
/// Update this constant only as part of the schema change process defined in ADR-003.
const POLICY_SCHEMA_HASH: &str = "10725f37ecb7e82d1073afdd154a4e4d42705c806b15ce6a3a381e53be1721bb";

fn main() {
    // Locate the workspace root: CARGO_MANIFEST_DIR is apps/engine/, so go up two levels.
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be set by cargo"),
    );
    let workspace_root = manifest_dir
        .parent() // apps/
        .expect("apps/ parent must exist")
        .parent() // workspace root
        .expect("workspace root must exist");

    let schema_path = workspace_root.join("schemas/policy/policy.schema.json");

    // Tell cargo to re-run this build script if the schema file changes.
    println!("cargo:rerun-if-changed={}", schema_path.display());

    // Read and hash the schema file.
    let schema_bytes = fs::read(&schema_path).unwrap_or_else(|e| {
        panic!(
            "build.rs: failed to read policy schema at {}: {}\n\
             \n\
             This file is required. Ensure the monorepo is checked out completely.\n\
             Expected path: {}",
            schema_path.display(),
            e,
            schema_path.display()
        )
    });

    // Compute SHA-256 without pulling in external crates in build.rs.
    // We shell out to sha256sum / shasum to keep build.rs dependency-free.
    // On Linux/macOS: sha256sum; on macOS fallback: shasum -a 256.
    // CI runners always have one of these. Local dev on Windows: use git-bash / WSL.
    let computed_hash = compute_sha256_hex(&schema_bytes);

    if computed_hash != POLICY_SCHEMA_HASH {
        panic!(
            "\n\
             ╔══════════════════════════════════════════════════════════════════╗\n\
             ║  POLICY SCHEMA HASH MISMATCH — BUILD ABORTED (ADR-003)          ║\n\
             ╠══════════════════════════════════════════════════════════════════╣\n\
             ║  The policy schema has changed without updating the pinned hash. ║\n\
             ║                                                                  ║\n\
             ║  Schema file : schemas/policy/policy.schema.json                 ║\n\
             ║  Expected    : {expected}  ║\n\
             ║  Computed    : {computed}  ║\n\
             ║                                                                  ║\n\
             ║  If this schema change is intentional, follow ADR-003:           ║\n\
             ║  1. Bump schema_version in the JSON schema.                      ║\n\
             ║  2. Add a backward-compat fixture test.                          ║\n\
             ║  3. Update POLICY_SCHEMA_HASH in apps/engine/build.rs.           ║\n\
             ║  4. Update all consumer PRs before merging.                      ║\n\
             ╚══════════════════════════════════════════════════════════════════╝\n",
            expected = POLICY_SCHEMA_HASH,
            computed = computed_hash,
        );
    }

    // Emit the hash as a compile-time env var so the engine binary can include
    // it in its version output for auditability.
    println!("cargo:rustc-env=POLICY_SCHEMA_HASH={}", POLICY_SCHEMA_HASH);
}

/// Pure-Rust SHA-256 implementation sufficient for build.rs.
/// We intentionally avoid external crates in build.rs to keep the
/// build dependency graph lean and Mode-0 compatible.
fn compute_sha256_hex(data: &[u8]) -> String {
    // SHA-256 constants
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    // Pre-processing: add padding
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    // Process each 512-bit (64-byte) chunk
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word_bytes) in chunk.chunks(4).enumerate().take(16) {
            w[i] = u32::from_be_bytes([word_bytes[0], word_bytes[1], word_bytes[2], word_bytes[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    // Format as lowercase hex string
    h.iter().fold(String::new(), |mut acc, word| {
        acc.push_str(&format!("{:08x}", word));
        acc
    })
}
