# SPDX-License-Identifier: MIT
"""Tests for RFC 8785 JCS canonicalization."""

from __future__ import annotations

import pytest

from loopstorm._jcs import jcs_serialize


class TestJcsSimple:
    def test_simple_object(self) -> None:
        """J1: Basic key sorting."""
        obj = {"url": "https://example.com", "method": "GET"}
        assert jcs_serialize(obj) == '{"method":"GET","url":"https://example.com"}'

    def test_nested_objects(self) -> None:
        """J2: Recursive canonicalization."""
        obj = {"config": {"retry": True, "timeout": 30}, "action": "fetch"}
        assert (
            jcs_serialize(obj)
            == '{"action":"fetch","config":{"retry":true,"timeout":30}}'
        )


class TestJcsNumbers:
    def test_number_integer(self) -> None:
        """J3: Integer-valued floats serialize without decimal."""
        assert jcs_serialize(1.0) == "1"
        assert jcs_serialize(100.0) == "100"
        assert jcs_serialize(-1.0) == "-1"

    def test_negative_zero(self) -> None:
        """J4: -0.0 serializes as '0'."""
        assert jcs_serialize(-0.0) == "0"

    def test_scientific_notation(self) -> None:
        """J5: Exponential notation thresholds."""
        assert jcs_serialize(1e2) == "100"
        assert jcs_serialize(1e20) == "100000000000000000000"
        assert jcs_serialize(1e21) == "1e+21"

    def test_small_float(self) -> None:
        """Small floats serialize correctly."""
        assert jcs_serialize(0.1) == "0.1"

    def test_nan_rejected(self) -> None:
        """J11: NaN raises ValueError."""
        with pytest.raises(ValueError, match="JCS does not support"):
            jcs_serialize(float("nan"))

    def test_infinity_rejected(self) -> None:
        """J11: Infinity raises ValueError."""
        with pytest.raises(ValueError, match="JCS does not support"):
            jcs_serialize(float("inf"))
        with pytest.raises(ValueError, match="JCS does not support"):
            jcs_serialize(float("-inf"))


class TestJcsStrings:
    def test_string_escaping(self) -> None:
        """J6: Control chars, backslash, quote."""
        assert jcs_serialize("hello\nworld") == '"hello\\nworld"'
        assert jcs_serialize("tab\there") == '"tab\\there"'
        assert jcs_serialize('say "hi"') == '"say \\"hi\\""'
        assert jcs_serialize("back\\slash") == '"back\\\\slash"'

    def test_unicode_literal(self) -> None:
        """J7: Non-ASCII chars serialized as literal UTF-8."""
        assert jcs_serialize("Jos\u00e9") == '"Jos\u00e9"'
        assert jcs_serialize("\U0001f525") == '"\U0001f525"'

    def test_low_control_chars(self) -> None:
        """Control chars U+0000-U+001F use \\uXXXX or named escapes."""
        assert jcs_serialize("\x00") == '"\\u0000"'
        assert jcs_serialize("\x01") == '"\\u0001"'
        assert jcs_serialize("\x1f") == '"\\u001f"'


class TestJcsContainers:
    def test_empty_containers(self) -> None:
        """J8: Empty object/array."""
        assert jcs_serialize({}) == "{}"
        assert jcs_serialize([]) == "[]"

    def test_null_true_false(self) -> None:
        """J9: Literal serialization."""
        assert jcs_serialize(None) == "null"
        assert jcs_serialize(True) == "true"
        assert jcs_serialize(False) == "false"

    def test_array_elements(self) -> None:
        """J10: Ordered, no whitespace."""
        assert jcs_serialize([1, "two", None, True]) == '[1,"two",null,true]'


class TestJcsUtf16KeyOrder:
    def test_ascii_key_ordering(self) -> None:
        """ASCII keys sort by code point (same as UTF-16)."""
        obj = {"b": 2, "a": 1, "c": 3}
        assert jcs_serialize(obj) == '{"a":1,"b":2,"c":3}'

    def test_utf16_key_ordering(self) -> None:
        """J12: Supplementary plane key sorting by UTF-16 code units."""
        # U+1D11E (MUSICAL SYMBOL G CLEF) encodes as surrogate pair (0xD834, 0xDD1E)
        # U+FFFD encodes as 0xFFFD
        # 0xD834 < 0xFFFD, so U+1D11E sorts BEFORE U+FFFD
        obj = {"\ufffd": "replacement", "\U0001d11e": "clef"}
        result = jcs_serialize(obj)
        assert result == '{"\U0001d11e":"clef","\ufffd":"replacement"}'


class TestJcsTypeSafety:
    def test_unsupported_type_raises(self) -> None:
        with pytest.raises(TypeError, match="unsupported type for JCS"):
            jcs_serialize(object())

    def test_bool_not_treated_as_int(self) -> None:
        """bool is a subclass of int — JCS must serialize as true/false."""
        assert jcs_serialize(True) == "true"
        assert jcs_serialize(False) == "false"

    def test_integer(self) -> None:
        assert jcs_serialize(42) == "42"
        assert jcs_serialize(-1) == "-1"
        assert jcs_serialize(0) == "0"

    def test_large_integer(self) -> None:
        assert jcs_serialize(9007199254740991) == "9007199254740991"
