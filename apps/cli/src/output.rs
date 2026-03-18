// SPDX-License-Identifier: MIT
//! Shared output helpers, exit codes, and utility functions.

use sha2::{Digest, Sha256};

/// Exit code: success.
pub const EXIT_OK: u8 = 0;
/// Exit code: validation/verification failure.
pub const EXIT_FAIL: u8 = 1;
/// Exit code: I/O error or malformed input.
pub const EXIT_IO_ERROR: u8 = 2;

/// Compute SHA-256 hex digest of some bytes.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}
