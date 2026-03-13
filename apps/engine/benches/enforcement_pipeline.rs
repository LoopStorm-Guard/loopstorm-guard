// SPDX-License-Identifier: MIT
//! Criterion benchmark suite for the enforcement pipeline.
//!
//! Latency targets (P99, single-threaded, no I/O):
//!   allow decision        < 1 ms
//!   deny decision         < 1 ms
//!   budget check          < 1 ms
//!   loop detection        < 2 ms
//!   UDS roundtrip P99     < 2 ms
//!   total_per_call P99    < 5 ms
//!
//! CI runs these with `cargo bench --bench enforcement_pipeline -- --test`
//! to verify they compile and run without panics. Full regression comparison
//! uses `cargo bench` output against a stored baseline.

use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_allow_decision(c: &mut Criterion) {
    c.bench_function("allow_decision", |b| {
        b.iter(|| {
            // TODO(engine): replace with real PolicyPack::evaluate() call
            black_box("allow")
        })
    });
}

fn bench_deny_decision(c: &mut Criterion) {
    c.bench_function("deny_decision", |b| {
        b.iter(|| {
            // TODO(engine): replace with real PolicyPack::evaluate() call
            black_box("deny")
        })
    });
}

fn bench_budget_check(c: &mut Criterion) {
    c.bench_function("budget_check", |b| {
        b.iter(|| {
            // TODO(engine): replace with real BudgetTracker::record() call
            black_box(0u64)
        })
    });
}

fn bench_loop_detection(c: &mut Criterion) {
    c.bench_function("loop_detection", |b| {
        b.iter(|| {
            // TODO(engine): replace with real LoopDetector::check() call
            black_box(false)
        })
    });
}

criterion_group!(
    benches,
    bench_allow_decision,
    bench_deny_decision,
    bench_budget_check,
    bench_loop_detection,
);
criterion_main!(benches);
