# SPDX-License-Identifier: MIT
"""Tests for args_hash computation using the shared test vectors."""

from __future__ import annotations

from typing import Any

from loopstorm._args_hash import args_hash
from loopstorm._jcs import jcs_serialize


class TestArgsHashVectors:
    """All test vectors from specs/args-hash.md and tests/fixtures/args-hash-vectors.json."""

    def test_vector_1_simple_flat(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[0]
        assert v["id"] == "simple_flat"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_2_key_reordering(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[1]
        assert v["id"] == "key_reordering"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_3_nested(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[2]
        assert v["id"] == "nested_objects"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_4_number_normalization(
        self, args_hash_vectors: list[dict[str, Any]]
    ) -> None:
        v = args_hash_vectors[3]
        assert v["id"] == "number_normalization"
        # The input has float values that must normalize:
        # 1.0 -> 1, -0.0 -> 0, 1e2 -> 100
        inp = {"one": 1.0, "neg_zero": -0.0, "sci": 1e2}
        assert jcs_serialize(inp) == v["canonical"]
        assert args_hash(inp) == v["sha256"]

    def test_vector_5_empty_object(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[4]
        assert v["id"] == "empty_object"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_6_arrays(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[5]
        assert v["id"] == "array_values"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_7_unicode(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[6]
        assert v["id"] == "unicode_strings"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_8_control_chars(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[7]
        assert v["id"] == "control_characters"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_9_deeply_nested(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[8]
        assert v["id"] == "deeply_nested"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_10_large_int_float(
        self, args_hash_vectors: list[dict[str, Any]]
    ) -> None:
        v = args_hash_vectors[9]
        assert v["id"] == "large_int_float"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_11_backslash_quote(
        self, args_hash_vectors: list[dict[str, Any]]
    ) -> None:
        v = args_hash_vectors[10]
        assert v["id"] == "backslash_quote"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_12_mixed_types(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[11]
        assert v["id"] == "mixed_types"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]

    def test_vector_13_null_args(self, args_hash_vectors: list[dict[str, Any]]) -> None:
        v = args_hash_vectors[12]
        assert v["id"] == "null_args"
        assert jcs_serialize(v["input"]) == v["canonical"]
        assert args_hash(v["input"]) == v["sha256"]


class TestArgsHashEdgeCases:
    def test_null_args(self) -> None:
        """A13: null/absent args hash the string 'null'."""
        result = args_hash(None)
        assert result == "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"

    def test_primitive_args_string(self) -> None:
        """A14: Primitive string arg."""
        result = args_hash("hello")
        expected_canonical = '"hello"'
        import hashlib

        expected = hashlib.sha256(expected_canonical.encode("utf-8")).hexdigest()
        assert result == expected

    def test_primitive_args_number(self) -> None:
        """A15: Primitive integer arg."""
        result = args_hash(42)
        import hashlib

        expected = hashlib.sha256(b"42").hexdigest()
        assert result == expected

    def test_all_vectors_from_fixture(
        self, args_hash_vectors: list[dict[str, Any]]
    ) -> None:
        """Verify every single vector in the fixture file passes."""
        for v in args_hash_vectors:
            assert jcs_serialize(v["input"]) == v["canonical"], (
                f"canonical mismatch for {v['id']}"
            )
            assert args_hash(v["input"]) == v["sha256"], (
                f"sha256 mismatch for {v['id']}"
            )
