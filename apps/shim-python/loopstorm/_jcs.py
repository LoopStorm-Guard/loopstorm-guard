# SPDX-License-Identifier: MIT
"""RFC 8785 JSON Canonicalization Scheme (JCS) — pure Python, stdlib only."""

from __future__ import annotations

import math
import struct
from typing import Any


def jcs_serialize(value: Any) -> str:
    """Serialize a Python value to RFC 8785 canonical JSON."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return _jcs_number(value)
    if isinstance(value, str):
        return _jcs_string(value)
    if isinstance(value, list):
        return "[" + ",".join(jcs_serialize(item) for item in value) + "]"
    if isinstance(value, dict):
        sorted_keys = sorted(value.keys(), key=_utf16_sort_key)
        pairs = [
            _jcs_string(k) + ":" + jcs_serialize(value[k]) for k in sorted_keys
        ]
        return "{" + ",".join(pairs) + "}"
    raise TypeError(f"unsupported type for JCS: {type(value).__name__}")


def _utf16_sort_key(key: str) -> list[int]:
    """Return a sort key based on UTF-16 code unit ordering (RFC 8785 S3.2.3)."""
    return list(key.encode("utf-16-le"))


def _jcs_string(s: str) -> str:
    """Serialize a string per RFC 8785 / RFC 8259 escaping rules."""
    out: list[str] = ['"']
    for ch in s:
        cp = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif cp < 0x20:
            out.append(f"\\u{cp:04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _jcs_number(value: float) -> str:
    """Serialize a float per ECMAScript Number.toString() / RFC 8785 S3.2.2.3.

    Rules:
    1. NaN and Infinity are rejected.
    2. -0.0 serializes as "0".
    3. Integer-valued floats (no fractional part, within safe range) serialize
       without decimal point.
    4. Other floats use the shortest representation that round-trips.
    5. Exponential notation when exponent >= 21 or <= -7.
    """
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"JCS does not support {value}")

    # Negative zero
    if value == 0.0 and _is_negative_zero(value):
        return "0"

    # Integer-valued floats
    if value == int(value) and abs(value) < 1e21:
        return str(int(value))

    # Use ES Number.toString() algorithm via IEEE 754 bits
    return _es_number_to_string(value)


def _is_negative_zero(value: float) -> bool:
    """Check if value is -0.0 using IEEE 754 sign bit."""
    return struct.pack(">d", value) == struct.pack(">d", -0.0)


def _es_number_to_string(value: float) -> str:
    """Format a float per ECMAScript's Number.prototype.toString().

    Produces the shortest decimal representation that round-trips through
    IEEE 754 double-precision, then applies ES formatting rules for
    fixed vs exponential notation.
    """
    # Python's repr already gives shortest round-trip representation
    s = repr(value)

    # Parse into mantissa and exponent
    if "e" in s or "E" in s:
        parts = s.lower().split("e")
        mantissa_str = parts[0]
        exp = int(parts[1])
    else:
        mantissa_str = s
        exp = 0

    # Remove leading minus for processing
    negative = mantissa_str.startswith("-")
    if negative:
        mantissa_str = mantissa_str[1:]

    # Normalize: remove decimal point and track its position
    if "." in mantissa_str:
        dot_pos = mantissa_str.index(".")
        digits = mantissa_str.replace(".", "")
        exp += dot_pos - 1
    else:
        digits = mantissa_str
        exp += len(digits) - 1

    # Strip trailing zeros from digits
    digits = digits.rstrip("0") or "0"

    n = len(digits)
    k = exp  # exponent such that value = 0.digits * 10^(k+1)

    # ES Number.toString formatting rules
    sign = "-" if negative else ""

    if 0 <= k < n:
        # Decimal point within the digits: e.g. 12.34
        result = digits[: k + 1] + ("." + digits[k + 1 :] if k + 1 < n else "")
    elif n <= k + 1 < 21:
        # Integer with trailing zeros: e.g. 1200
        result = digits + "0" * (k + 1 - n)
    elif -6 <= k < 0:
        # Small number: 0.00123
        result = "0." + "0" * (-k - 1) + digits
    else:
        # Exponential notation
        if n == 1:
            result = digits
        else:
            result = digits[0] + "." + digits[1:]
        e = k
        result += "e+" + str(e) if e >= 0 else "e" + str(e)

    return sign + result
