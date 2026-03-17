<!-- SPDX-License-Identifier: MIT -->
# Task Brief: P1 -- Python Shim (`loopstorm-py`)

**Priority:** P1
**Assignee:** Implementation agent (Python)
**Branch:** `feat/p1-python-shim` (from `main` at `eee8069`)
**Gate:** P1 Python Shim Architecture -- RESOLVED by this document
**Blocked by:** P0-7 IPC Listener (merged, `eee8069`)
**Blocks:** P2 (CLI E2E tests require a working shim), Case Studies 1-3

---

## 1. Objective

Implement the Python shim package (`loopstorm`) that intercepts AI agent tool
calls, computes the `args_hash` per RFC 8785 / `specs/args-hash.md`, sends
`DecisionRequest` messages to the running `loopstorm-engine` over a Unix Domain
Socket, receives `DecisionResponse` messages, and enforces the engine's decision
(allow, deny, cooldown, kill) in the agent's process.

After this PR, a user can:

```python
from loopstorm import Guard

guard = Guard()

# Decorator-style wrapping
@guard.wrap("file_read")
def read_file(path: str) -> str:
    return open(path).read()

# Context-manager style for OpenAI
client = openai.OpenAI()
with guard.openai(client) as guarded_client:
    response = guarded_client.chat.completions.create(...)
```

---

## 2. Constraints

These are non-negotiable. Violating any of them blocks merge.

| # | Constraint | Source |
|---|---|---|
| C1 | **stdlib only** -- zero third-party runtime dependencies | ADR-013, pyproject.toml |
| C2 | **Python >= 3.10** -- use `from __future__ import annotations` for type union syntax | pyproject.toml |
| C3 | **MIT license** -- every `.py` file gets `# SPDX-License-Identifier: MIT` as line 1 | ADR-013 |
| C4 | **Mode 0 first** -- works air-gapped, no network calls | Product doc |
| C5 | **Fail-closed is the policy-evaluation default; fail-open/fail-closed for engine unavailability is operator-configured** | ADR-002 |
| C6 | **args_hash must match all 12 test vectors** in `specs/args-hash.md` | Spec |
| C7 | **NDJSON wire format** per `specs/ipc-wire-format.md` | ADR-001 |
| C8 | **No changes to JSON schema files or VERIFY.md** | Gate rule |

---

## 3. Public API Design

### 3.1 `Guard` Class

```python
class Guard:
    def __init__(
        self,
        *,
        socket_path: str | None = None,  # UDS path; env/default fallback
        fail_open: bool = True,           # behavior when engine is unavailable
        run_id: str | None = None,        # client-generated UUID v7; auto-generated if None
        agent_role: str | None = None,    # ADR-008 flat tag
        agent_name: str | None = None,    # human-readable name
        environment: str | None = None,   # e.g. "production", "staging"
        model: str | None = None,         # LLM model identifier
        timeout: float = 10.0,            # shim-side read timeout in seconds
    ):
        ...
```

**Socket path resolution order** (matches engine, per `specs/ipc-wire-format.md` S2.3):
1. `socket_path` constructor argument (highest priority)
2. `LOOPSTORM_SOCKET` environment variable
3. Platform default:
   - Unix: `/tmp/loopstorm-engine.sock`
   - Windows: `\\.\pipe\loopstorm-engine` (connection will fail until engine supports it, but path resolution works)

**`fail_open` semantics** (per ADR-002 discussion):
- `fail_open=True` (default): if the engine socket is unreachable or the
  read times out, log a warning and **allow the call to proceed**. This is
  the recommended default for development and gradual rollout.
- `fail_open=False`: if the engine is unreachable or times out, **raise
  `EngineUnavailableError`**. The caller must handle this. This is
  recommended for production deployments where unguarded execution is
  unacceptable.

**IMPORTANT**: `fail_open` controls behavior when the *engine process* is
unavailable. It does NOT override engine decisions. If the engine responds
with `deny`, the call is denied regardless of `fail_open`. This distinction
is critical and must be documented clearly. The `fail_open` flag is about
*infrastructure failure*, not *policy evaluation*.

**`run_id` generation** (per ADR-004):
- If `run_id` is `None`, the Guard generates a UUID v7 using stdlib.
- Python 3.10 does not have `uuid7()` in stdlib. Implementation must use
  `uuid.uuid4()` as a fallback. Document that UUID v7 generation will be
  adopted when Python adds stdlib support or when a future version adds an
  optional dependency.
- The `run_id` is fixed for the lifetime of the Guard instance. All calls
  through this Guard share the same `run_id`.

### 3.2 `guard.wrap()` Decorator

```python
@guard.wrap("tool_name")
def my_tool(arg1: str, arg2: int) -> str:
    ...
```

The decorator:
1. Captures the function arguments as a dict (kwargs preferred; positional args
   converted using `inspect.signature` parameter names).
2. Computes `args_hash` from the args dict.
3. Sends `DecisionRequest` to engine.
4. Blocks on `DecisionResponse`.
5. Handles the decision:
   - `allow`: call the wrapped function, return its result.
   - `deny`: raise `PolicyDeniedError(rule_id, reason)`.
   - `cooldown`: sleep for `cooldown_ms` milliseconds, then raise
     `CooldownError(cooldown_ms, cooldown_message)`. The caller (agent
     framework) decides whether to retry.
   - `kill`: raise `RunTerminatedError(rule_id, reason)`.
   - `require_approval`: raise `ApprovalRequiredError(approval_id,
     timeout_ms, timeout_action)`. This is a placeholder for v1.1.

**Why cooldown raises instead of auto-retrying**: The shim does not own the
agent's retry logic. Different agent frameworks have different retry patterns.
The shim's job is to enforce the pause (sleep) and then inform the caller that
a cooldown occurred. The agent framework can then decide whether and how to
retry. This keeps the shim thin and framework-agnostic.

### 3.3 `guard.check()` -- Imperative API

```python
response = guard.check("tool_name", args={"url": "https://example.com"})
if response.decision == "allow":
    do_the_thing()
```

For callers who prefer explicit control over the decision flow rather than
decorator-based wrapping. Returns a `DecisionResult` dataclass.

### 3.4 `guard.openai()` -- OpenAI Adapter

```python
client = openai.OpenAI()
guarded = guard.openai(client)
# Use guarded exactly like the original client
response = guarded.chat.completions.create(
    model="gpt-4o",
    tools=[...],
    ...
)
```

The adapter wraps the OpenAI client's tool call execution. When the LLM
returns tool calls in its response, the adapter intercepts each tool call
before execution and sends it through the Guard.

**Design**: The adapter is a **proxy object** that wraps the OpenAI client.
It intercepts `chat.completions.create()` responses, inspects
`response.choices[*].message.tool_calls`, and for each tool call:
1. Extracts `function.name` as the tool name.
2. Parses `function.arguments` (JSON string) as the args dict.
3. Calls `guard.check(tool_name, args)`.
4. If denied/killed, raises the appropriate error before execution.

**IMPORTANT**: The adapter does NOT execute tools. It only gates them. The
actual tool execution is the responsibility of the agent framework. The
adapter intercepts the response and raises if any tool call is denied.

**Scope limitation for v1**: The OpenAI adapter handles the
`chat.completions.create()` synchronous API only. Async and streaming
variants are out of scope for P1. Document this limitation.

### 3.5 `guard.close()`

```python
guard.close()
# or use as context manager:
with Guard() as guard:
    ...
```

Closes the UDS connection. The Guard implements `__enter__` and `__exit__`
for context manager usage.

---

## 4. Module Structure

```
apps/shim-python/
  pyproject.toml                   # (exists, update dev deps if needed)
  loopstorm/
    __init__.py                    # (exists, update exports)
    _version.py                    # (exists)
    _guard.py                      # Guard class, wrap(), check(), close()
    _connection.py                 # NEW: UDS connection management
    _jcs.py                        # NEW: RFC 8785 canonicalization (stdlib)
    _args_hash.py                  # NEW: args_hash = sha256(jcs(args))
    _protocol.py                   # NEW: DecisionRequest/Response dataclasses, NDJSON serde
    _errors.py                     # NEW: exception hierarchy
    _openai.py                     # NEW: OpenAI client adapter
    _types.py                      # NEW: DecisionResult, BudgetRemaining dataclasses
    py.typed                       # NEW: PEP 561 marker for mypy
  tests/
    __init__.py                    # NEW
    test_jcs.py                    # NEW: RFC 8785 canonicalization tests
    test_args_hash.py              # NEW: 12 test vectors from specs/args-hash.md
    test_protocol.py               # NEW: NDJSON serialization/deserialization
    test_guard.py                  # NEW: Guard unit tests (mocked connection)
    test_connection.py             # NEW: connection management tests
    test_errors.py                 # NEW: exception hierarchy tests
    test_openai.py                 # NEW: OpenAI adapter tests (mocked)
    conftest.py                    # NEW: shared fixtures
```

### Module Responsibilities

| Module | Responsibility | Stdlib deps |
|---|---|---|
| `_connection.py` | UDS socket lifecycle: connect, reconnect, send, receive, timeout, close | `socket`, `os`, `time`, `logging` |
| `_jcs.py` | RFC 8785 JSON Canonicalization Scheme (pure Python) | `math`, `struct`, `re` |
| `_args_hash.py` | `args_hash(args) -> str` = SHA-256 of JCS canonical form | `hashlib`, `json` |
| `_protocol.py` | `DecisionRequest` / `DecisionResponse` dataclasses + NDJSON serialize/deserialize | `json`, `dataclasses` |
| `_errors.py` | Exception class hierarchy | (none) |
| `_guard.py` | `Guard` class: orchestrates connection + protocol + hash + error handling | `uuid`, `time`, `functools`, `inspect`, `logging` |
| `_openai.py` | OpenAI client proxy adapter | `json`, `logging` |
| `_types.py` | `DecisionResult`, `BudgetRemaining` public dataclasses | `dataclasses` |

---

## 5. JCS Canonicalization (`_jcs.py`)

This is the most critical and error-prone module. It implements RFC 8785
using only the Python standard library.

### 5.1 Approach

Python's `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False,
allow_nan=False)` produces output that is **close to but not identical to**
RFC 8785 for all inputs. The specific divergences are:

1. **Number formatting**: Python's `json` module uses `repr()` for floats,
   which may produce different output than ECMAScript's `Number.toString()`
   for some edge cases (e.g., `-0` serializes as `-0.0`, not `0`).

2. **Key ordering**: Python sorts by Unicode code point order, which differs
   from RFC 8785's UTF-16 code unit order for keys containing characters
   outside the Basic Multilingual Plane (U+10000+). In practice, tool
   argument keys are ASCII identifiers, so this divergence does not arise.

### 5.2 Implementation Strategy

Implement a custom `jcs_serialize(value)` function that handles the specific
RFC 8785 requirements:

```python
def jcs_serialize(value: Any) -> str:
    """Serialize a Python value to RFC 8785 canonical JSON."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _jcs_string(value)
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return _jcs_number(value)
    if isinstance(value, list):
        return "[" + ",".join(jcs_serialize(item) for item in value) + "]"
    if isinstance(value, dict):
        sorted_keys = sorted(value.keys(), key=_utf16_sort_key)
        pairs = [_jcs_string(k) + ":" + jcs_serialize(v) for k, v in
                 ((k, value[k]) for k in sorted_keys)]
        return "{" + ",".join(pairs) + "}"
    raise TypeError(f"unsupported type for JCS: {type(value).__name__}")
```

### 5.3 Number Formatting (`_jcs_number`)

This is the hardest part. The rules follow ECMAScript's `Number.toString()`:

1. `NaN` and `Infinity` raise `ValueError`.
2. `-0.0` serializes as `"0"`.
3. Integers (no fractional part, within safe range) serialize without decimal
   point: `1.0` -> `"1"`, `100.0` -> `"100"`.
4. For other floats, use the shortest representation that round-trips through
   IEEE 754 double-precision.
5. Exponential notation: used when exponent >= 21 or <= -7. Format: `1e+21`,
   `1e-7`. Positive exponent has `+` sign. Negative has `-`.

**Implementation**: Use Python's `repr()` as a starting point, then normalize:
- Strip trailing zeros after decimal point.
- Strip trailing decimal point.
- Handle `-0.0` -> `"0"`.
- Convert between fixed and exponential notation based on the exponent
  threshold rules.

Alternatively, use `struct.pack('>d', value)` to extract the IEEE 754 bits
and implement the formatting directly. This is more complex but provably
correct. The recommended approach for v1 is the `repr()` normalization path,
validated against all 12 test vectors.

### 5.4 String Escaping (`_jcs_string`)

Follow the escaping table from `specs/args-hash.md` S3.3 exactly:
- `"` -> `\"`
- `\` -> `\\`
- Backspace -> `\b`
- Form feed -> `\f`
- Newline -> `\n`
- Carriage return -> `\r`
- Tab -> `\t`
- Other U+0000-U+001F -> `\uXXXX` (lowercase hex)
- All other characters: literal UTF-8 (no escaping)

### 5.5 Key Sorting (`_utf16_sort_key`)

RFC 8785 sorts keys by UTF-16 code unit ordering. For ASCII keys (the common
case), this is identical to Python's default string ordering. For non-BMP
characters (U+10000+), Python sorts by code point (a single value), while
RFC 8785 sorts by surrogate pair code units.

```python
def _utf16_sort_key(key: str) -> list[int]:
    """Return a sort key based on UTF-16 code unit ordering."""
    return list(key.encode("utf-16-le"))
```

Encoding to UTF-16-LE and comparing the resulting byte sequences produces
the correct RFC 8785 ordering.

### 5.6 Known Limitation

Supplementary plane characters (U+10000+) in object **keys** are correctly
handled by the `_utf16_sort_key` function. However, this is documented as a
theoretical concern only -- tool argument keys are ASCII identifiers in all
known agent frameworks.

---

## 6. UDS Connection Management (`_connection.py`)

### 6.1 Connection Lifecycle

```
Guard.__init__()
  -> EngineConnection(socket_path, timeout)
       -> lazy connect on first check()

guard.check() / guard.wrap()
  -> connection.send_request(request_json)
  -> connection.recv_response() -> response_json

guard.close()
  -> connection.close()
```

### 6.2 Design Decisions

**Lazy connection**: The UDS connection is established on the first
`check()` call, not in `__init__()`. This allows creating a Guard object
before the engine is running (useful in test setup and agent framework
initialization).

**Connection reuse**: A single UDS connection is held open for the lifetime
of the Guard. Per `specs/ipc-wire-format.md` S5: "The shim may hold the
connection open for the duration of the agent run." This is the recommended
pattern -- one connection per Guard, one Guard per agent run.

**Reconnection on failure**: If a `send` or `recv` fails:
1. Close the current socket.
2. On the next `check()` call, attempt to reconnect once.
3. If reconnection fails:
   - `fail_open=True`: log warning, return allow.
   - `fail_open=False`: raise `EngineUnavailableError`.

There is **no automatic retry loop**. One reconnection attempt per failure.
This prevents masking persistent failures.

**Timeout**: The shim-side read timeout (default 10 seconds per spec S7) is
implemented using `socket.settimeout()`. On timeout:
- `fail_open=True`: log warning, return allow.
- `fail_open=False`: raise `EngineUnavailableError`.

### 6.3 Thread Safety

The `Guard` class is **not thread-safe** in v1. If multiple threads share a
Guard, they must externally synchronize calls. This is documented.

Rationale: Most agent frameworks are single-threaded or use async. Adding
internal locking adds complexity without clear demand. Thread-safe support
can be added in v1.1 with a `threading.Lock` around `_connection`.

### 6.4 Wire Protocol Implementation

```python
def send_request(self, request: DecisionRequest) -> None:
    """Serialize request as NDJSON and send over UDS."""
    payload = json.dumps(request.to_dict(), separators=(",", ":"),
                         ensure_ascii=False)
    line = payload.encode("utf-8") + b"\n"
    if len(line) > 65_536:
        raise MessageTooLargeError(len(line))
    self._socket.sendall(line)

def recv_response(self) -> DecisionResponse:
    """Read one NDJSON line from the socket and deserialize."""
    data = b""
    while b"\n" not in data:
        chunk = self._socket.recv(4096)
        if not chunk:
            raise ConnectionClosedError()
        data += chunk
        if len(data) > 65_536:
            raise MessageTooLargeError(len(data))
    line = data[:data.index(b"\n")]
    return DecisionResponse.from_json(line.decode("utf-8"))
```

**Important**: The `recv` implementation must handle the case where the
engine sends a response larger than one `recv()` call. Buffer until `\n` is
found. This is standard NDJSON framing.

---

## 7. Protocol Types (`_protocol.py`)

### 7.1 DecisionRequest

```python
@dataclass
class DecisionRequest:
    schema_version: int  # always 1
    run_id: str
    seq: int
    tool: str
    args_hash: str
    ts: str  # ISO 8601
    args_redacted: dict[str, Any] | None = None
    agent_role: str | None = None
    agent_name: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None
    environment: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict for JSON encoding, omitting None fields."""
        d: dict[str, Any] = {
            "schema_version": self.schema_version,
            "run_id": self.run_id,
            "seq": self.seq,
            "tool": self.tool,
            "args_hash": self.args_hash,
            "ts": self.ts,
        }
        for field in ("args_redacted", "agent_role", "agent_name",
                      "model", "input_tokens", "output_tokens",
                      "estimated_cost_usd", "environment"):
            val = getattr(self, field)
            if val is not None:
                d[field] = val
        return d
```

Fields match `schemas/ipc/decision-request.schema.json` exactly.

### 7.2 DecisionResponse

```python
@dataclass
class DecisionResponse:
    schema_version: int
    run_id: str
    seq: int
    decision: str  # "allow" | "deny" | "cooldown" | "kill" | "require_approval"
    rule_id: str | None = None
    reason: str | None = None
    cooldown_ms: int | None = None
    cooldown_message: str | None = None
    approval_id: str | None = None
    approval_timeout_ms: int | None = None
    approval_timeout_action: str | None = None
    budget_remaining: dict[str, Any] | None = None
    ts: str | None = None

    @classmethod
    def from_json(cls, json_str: str) -> DecisionResponse:
        data = json.loads(json_str)
        return cls(**{k: v for k, v in data.items()
                      if k in cls.__dataclass_fields__})
```

Fields match `schemas/ipc/decision-response.schema.json` exactly.

---

## 8. Exception Hierarchy (`_errors.py`)

```python
class LoopStormError(Exception):
    """Base exception for all LoopStorm shim errors."""

class EngineUnavailableError(LoopStormError):
    """Engine is not running or connection failed (fail_open=False)."""

class PolicyDeniedError(LoopStormError):
    """Tool call was denied by policy."""
    def __init__(self, rule_id: str | None, reason: str | None): ...

class CooldownError(LoopStormError):
    """Loop detected; agent should retry after cooldown_ms."""
    def __init__(self, cooldown_ms: int, message: str | None): ...

class RunTerminatedError(LoopStormError):
    """Run was killed (budget exceeded, policy kill, audit failure)."""
    def __init__(self, rule_id: str | None, reason: str | None): ...

class ApprovalRequiredError(LoopStormError):
    """Human approval is required before this call can proceed (v1.1)."""
    def __init__(self, approval_id: str, timeout_ms: int,
                 timeout_action: str): ...

class ConnectionClosedError(LoopStormError):
    """Engine closed the connection unexpectedly."""

class MessageTooLargeError(LoopStormError):
    """Message exceeds 64 KiB limit."""
```

---

## 9. Sequence Number Management

The Guard maintains a monotonically increasing `_seq` counter, starting at 1.
Each `check()` call increments `_seq` and includes it in the
`DecisionRequest`. The engine echoes `seq` in the response -- the shim MUST
verify that `response.seq == request.seq` and `response.run_id == request.run_id`.
Mismatches indicate a protocol error and are treated as a kill.

---

## 10. Timestamp Generation

The `ts` field in `DecisionRequest` is an ISO 8601 timestamp generated by the
shim at the moment of interception. Use `datetime.datetime.now(datetime.UTC).isoformat()` (Python 3.11+) or
`datetime.datetime.utcnow().isoformat() + "Z"` (Python 3.10 compat).

For Python 3.10 compatibility, use:
```python
import datetime
ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
```

---

## 11. OpenAI Adapter (`_openai.py`)

### 11.1 Architecture

The adapter does NOT import `openai`. It works with the response objects
duck-typed: it accesses `.choices[*].message.tool_calls[*].function.name`
and `.function.arguments`. This means the adapter works with any OpenAI SDK
version that has this response shape, without depending on the SDK.

### 11.2 Interception Point

The adapter wraps `client.chat.completions.create()`. After the LLM returns
a response, and before the agent executes any tool calls, the adapter
iterates over tool calls and checks each one with the Guard.

```python
class OpenAIGuardedClient:
    """Proxy wrapping an OpenAI client to gate tool calls."""

    def __init__(self, client: Any, guard: Guard):
        self._client = client
        self._guard = guard

    @property
    def chat(self) -> OpenAIGuardedChat:
        return OpenAIGuardedChat(self._client.chat, self._guard)

class OpenAIGuardedChat:
    def __init__(self, chat: Any, guard: Guard):
        self._chat = chat
        self._guard = guard

    @property
    def completions(self) -> OpenAIGuardedCompletions:
        return OpenAIGuardedCompletions(self._chat.completions, self._guard)

class OpenAIGuardedCompletions:
    def __init__(self, completions: Any, guard: Guard):
        self._completions = completions
        self._guard = guard

    def create(self, **kwargs: Any) -> Any:
        response = self._completions.create(**kwargs)
        self._check_tool_calls(response)
        return response

    def _check_tool_calls(self, response: Any) -> None:
        for choice in response.choices:
            if not hasattr(choice.message, "tool_calls"):
                continue
            if choice.message.tool_calls is None:
                continue
            for tc in choice.message.tool_calls:
                args = json.loads(tc.function.arguments)
                result = self._guard.check(tc.function.name, args=args)
                # check() raises on deny/kill/cooldown
```

### 11.3 Scope for v1

- Synchronous `create()` only. No async, no streaming.
- Only `chat.completions.create()` is proxied. Other endpoints pass through.
- `guard.openai(client)` returns the proxy. It is a convenience method on Guard.

---

## 12. Test Plan

### 12.1 Unit Tests -- JCS Canonicalization (`test_jcs.py`)

| # | Test | Purpose |
|---|---|---|
| J1 | `test_jcs_simple_object` | Basic key sorting |
| J2 | `test_jcs_nested_objects` | Recursive canonicalization |
| J3 | `test_jcs_number_integer` | `1.0` -> `"1"`, `100.0` -> `"100"` |
| J4 | `test_jcs_negative_zero` | `-0.0` -> `"0"` |
| J5 | `test_jcs_scientific_notation` | `1e2` -> `"100"`, `1e21` -> `"1e+21"` |
| J6 | `test_jcs_string_escaping` | Control chars, backslash, quote |
| J7 | `test_jcs_unicode_literal` | Non-ASCII chars serialized as literal UTF-8 |
| J8 | `test_jcs_empty_containers` | `{}` -> `"{}"`, `[]` -> `"[]"` |
| J9 | `test_jcs_null_true_false` | Literal serialization |
| J10 | `test_jcs_array_elements` | Ordered, no whitespace |
| J11 | `test_jcs_nan_infinity_rejected` | `ValueError` raised |
| J12 | `test_jcs_utf16_key_ordering` | Supplementary plane key sorting |

### 12.2 Unit Tests -- args_hash (`test_args_hash.py`)

All 12 test vectors from `specs/args-hash.md` S4, plus the edge cases from S5:

| # | Test | Vector |
|---|---|---|
| A1 | `test_vector_1_simple_flat` | `abacd07d...` |
| A2 | `test_vector_2_key_reordering` | `c2985c5b...` |
| A3 | `test_vector_3_nested` | `3b79517f...` |
| A4 | `test_vector_4_number_normalization` | `3f0d3a9f...` |
| A5 | `test_vector_5_empty_object` | `44136fa3...` |
| A6 | `test_vector_6_arrays` | `f9147fa4...` |
| A7 | `test_vector_7_unicode` | `d118390a...` |
| A8 | `test_vector_8_control_chars` | `75bdf46f...` (ERRATA: corrected from `474fd71a...`) |
| A9 | `test_vector_9_deeply_nested` | `9dfbb4f9...` |
| A10 | `test_vector_10_large_int_float` | `2873f9a9...` |
| A11 | `test_vector_11_backslash_quote` | `00b3d93a...` |
| A12 | `test_vector_12_mixed_types` | `6958b38c...` |
| A13 | `test_null_args` | `74234e98...` |
| A14 | `test_primitive_args_string` | hash of `"hello"` |
| A15 | `test_primitive_args_number` | hash of `42` |

### 12.3 Unit Tests -- Protocol (`test_protocol.py`)

| # | Test | Purpose |
|---|---|---|
| P1 | `test_request_to_dict_required_only` | Only required fields in output |
| P2 | `test_request_to_dict_all_fields` | All optional fields included |
| P3 | `test_request_omits_none_fields` | `None` fields not in JSON |
| P4 | `test_response_from_json_allow` | Parse allow response |
| P5 | `test_response_from_json_deny` | Parse deny response with rule_id |
| P6 | `test_response_from_json_cooldown` | Parse cooldown with cooldown_ms |
| P7 | `test_response_from_json_kill` | Parse kill response |
| P8 | `test_response_ignores_unknown_fields` | Forward compat |
| P9 | `test_ndjson_round_trip` | Serialize + newline + deserialize |

### 12.4 Unit Tests -- Guard (`test_guard.py`)

| # | Test | Purpose |
|---|---|---|
| G1 | `test_wrap_allow_calls_function` | Allowed call executes and returns |
| G2 | `test_wrap_deny_raises` | Denied call raises PolicyDeniedError |
| G3 | `test_wrap_kill_raises` | Kill raises RunTerminatedError |
| G4 | `test_wrap_cooldown_sleeps_then_raises` | Cooldown sleeps then raises CooldownError |
| G5 | `test_check_returns_result` | check() returns DecisionResult |
| G6 | `test_seq_increments` | Each call gets seq+1 |
| G7 | `test_fail_open_engine_down` | Engine unreachable, fail_open=True -> call proceeds |
| G8 | `test_fail_closed_engine_down` | Engine unreachable, fail_open=False -> raises |
| G9 | `test_fail_open_timeout` | Engine hangs, fail_open=True -> call proceeds |
| G10 | `test_context_manager` | Guard as context manager closes connection |
| G11 | `test_run_id_auto_generated` | run_id is a valid UUID |
| G12 | `test_run_id_preserved_across_calls` | Same run_id in all requests |
| G13 | `test_response_seq_mismatch_treated_as_kill` | Protocol error handling |
| G14 | `test_response_run_id_mismatch_treated_as_kill` | Protocol error handling |

Tests G1-G10 use a mock socket (not a real UDS). The mock returns
pre-determined NDJSON responses.

### 12.5 Unit Tests -- OpenAI Adapter (`test_openai.py`)

| # | Test | Purpose |
|---|---|---|
| O1 | `test_openai_no_tool_calls_passes_through` | Response without tool calls is unmodified |
| O2 | `test_openai_allowed_tool_calls` | All tool calls allowed, response returned |
| O3 | `test_openai_denied_tool_call_raises` | One tool call denied, PolicyDeniedError raised |
| O4 | `test_openai_proxies_non_chat_attrs` | Other client attributes pass through |

Tests use mock objects -- no real OpenAI SDK required.

### 12.6 Integration Tests (require running engine)

These tests are NOT in the P1 scope but should be **prepared as skipped tests**
that will be enabled when the CI has a running engine. Mark them with
`@pytest.mark.skipif` or a custom marker.

| # | Test | Purpose |
|---|---|---|
| I1 | `test_real_engine_allow` | Send allow-able call to real engine |
| I2 | `test_real_engine_deny` | Send deny-able call to real engine |
| I3 | `test_real_engine_budget_kill` | Exceed budget, verify kill |

---

## 13. Shared Test Fixture

Create `tests/fixtures/args-hash-vectors.json` at the **repo root** level
(not under `apps/shim-python/`) so it can be consumed by all implementations
(Rust, Python, TypeScript):

```
tests/
  fixtures/
    args-hash-vectors.json
```

This file contains all 12 vectors from `specs/args-hash.md` S4 plus the
null-args edge case from S5.1, in the format specified in S7.2:

```json
[
  {
    "id": "simple_flat",
    "input": {"url": "https://example.com", "method": "GET"},
    "canonical": "{\"method\":\"GET\",\"url\":\"https://example.com\"}",
    "sha256": "abacd07d80a52db8cd8d4d149e15a032350e8a15c2c9feb81802c2d535a1f36a"
  },
  ...
]
```

The Python test reads from this fixture file. The Rust and TypeScript
implementations will consume the same fixture in their own PRs.

---

## 14. Files to Create / Modify

| File | Action | Description |
|---|---|---|
| `apps/shim-python/loopstorm/_guard.py` | REWRITE | Full Guard implementation |
| `apps/shim-python/loopstorm/_connection.py` | CREATE | UDS connection management |
| `apps/shim-python/loopstorm/_jcs.py` | CREATE | RFC 8785 canonicalization |
| `apps/shim-python/loopstorm/_args_hash.py` | CREATE | args_hash computation |
| `apps/shim-python/loopstorm/_protocol.py` | CREATE | DecisionRequest/Response + NDJSON |
| `apps/shim-python/loopstorm/_errors.py` | CREATE | Exception hierarchy |
| `apps/shim-python/loopstorm/_openai.py` | CREATE | OpenAI adapter |
| `apps/shim-python/loopstorm/_types.py` | CREATE | Public result dataclasses |
| `apps/shim-python/loopstorm/py.typed` | CREATE | PEP 561 marker (empty file) |
| `apps/shim-python/loopstorm/__init__.py` | REWRITE | Update exports |
| `apps/shim-python/pyproject.toml` | MODIFY | May need minor updates |
| `apps/shim-python/tests/__init__.py` | CREATE | Test package marker |
| `apps/shim-python/tests/conftest.py` | CREATE | Shared test fixtures |
| `apps/shim-python/tests/test_jcs.py` | CREATE | JCS canonicalization tests |
| `apps/shim-python/tests/test_args_hash.py` | CREATE | 12 test vector + edge cases |
| `apps/shim-python/tests/test_protocol.py` | CREATE | Protocol serialization tests |
| `apps/shim-python/tests/test_guard.py` | CREATE | Guard unit tests |
| `apps/shim-python/tests/test_connection.py` | CREATE | Connection tests |
| `apps/shim-python/tests/test_errors.py` | CREATE | Exception hierarchy tests |
| `apps/shim-python/tests/test_openai.py` | CREATE | OpenAI adapter tests |
| `tests/fixtures/args-hash-vectors.json` | CREATE | Shared test vectors |

---

## 15. What NOT to Touch

- `apps/engine/` -- no changes
- `schemas/` -- no changes
- `packages/schemas/` -- no changes
- `VERIFY.md` -- no changes
- `docs/adrs/` -- no changes
- `packages/backend/` -- no changes
- `packages/web/` -- no changes

---

## 16. Acceptance Criteria

All must be true before merge:

- [ ] `pip install -e "apps/shim-python[dev]"` succeeds
- [ ] `pytest apps/shim-python/tests/` passes all tests
- [ ] All 12 args_hash test vectors pass
- [ ] `mypy apps/shim-python/loopstorm/ --strict` passes
- [ ] `ruff check apps/shim-python/` passes
- [ ] Every `.py` file has `# SPDX-License-Identifier: MIT` as line 1
- [ ] Zero third-party runtime dependencies in pyproject.toml `dependencies = []`
- [ ] Guard.wrap() correctly intercepts and gates calls (mocked engine)
- [ ] Guard.check() returns DecisionResult (mocked engine)
- [ ] fail_open=True allows calls when engine is unavailable
- [ ] fail_open=False raises EngineUnavailableError when engine is unavailable
- [ ] OpenAI adapter intercepts tool calls in response (mocked)
- [ ] Cooldown decision sleeps for cooldown_ms then raises CooldownError
- [ ] Kill decision raises RunTerminatedError
- [ ] No changes to schema files, VERIFY.md, or engine code
- [ ] `tests/fixtures/args-hash-vectors.json` created with all 13 vectors
- [ ] CI green (existing jobs unaffected)

---

## 17. Dependencies for Testing

Dev dependencies only (in `[project.optional-dependencies]`):

```toml
dev = ["pytest>=8.3", "pytest-asyncio>=0.24", "mypy>=1.13", "ruff>=0.8"]
```

No changes needed -- these are already in `pyproject.toml`.

---

## 18. Architectural Decisions Resolved by This Brief

### AD-P1-1: Lazy Connection

**Decision**: The UDS connection is lazy (established on first `check()`
call, not in `__init__()`).

**Rationale**: Allows Guard instantiation before engine startup. Matches
the pattern where agent frameworks create clients during import/init, then
start processing later.

### AD-P1-2: Cooldown Raises Instead of Auto-Retrying

**Decision**: On `cooldown` decision, the shim `time.sleep(cooldown_ms /
1000)` and then raises `CooldownError`. It does NOT automatically retry.

**Rationale**: The shim does not own retry logic. Agent frameworks have
their own retry patterns. The shim enforces the pause and informs the
caller.

### AD-P1-3: No Thread Safety in v1

**Decision**: The `Guard` class is not thread-safe. External
synchronization required for multi-threaded use.

**Rationale**: Most agent frameworks are single-threaded or async.
Internal locking is unnecessary complexity for v1. Will be addressed in
v1.1 if demand arises.

### AD-P1-4: UUID v4 Fallback for run_id

**Decision**: Use `uuid.uuid4()` for `run_id` generation in v1 since
Python stdlib does not have `uuid7()` until 3.14+.

**Rationale**: The only property the engine requires is uniqueness, which
UUID v4 provides. The time-ordering benefit of UUID v7 is nice-to-have for
database indexing but not required for correctness. Document the intent to
switch to UUID v7 when stdlib support arrives.

### AD-P1-5: OpenAI Adapter Does Not Import openai

**Decision**: The adapter accesses response objects via duck typing
(attribute access), not via imported types.

**Rationale**: The shim has zero runtime dependencies. Importing `openai`
would create a de facto dependency. Duck typing works with any SDK version
that matches the response shape.

### AD-P1-6: Custom JCS Implementation over json.dumps(sort_keys=True)

**Decision**: Implement a custom `jcs_serialize()` function rather than
relying on `json.dumps(sort_keys=True)`.

**Rationale**: `json.dumps` does not handle negative zero normalization
(`-0.0` -> `"0"`), and its key ordering differs from RFC 8785 for non-BMP
characters. A custom implementation is provably correct against all test
vectors and the RFC.

---

## 19. Sequencing Guidance

Recommended implementation order:

1. `_errors.py` -- exception hierarchy (no deps, foundation for everything)
2. `_jcs.py` + `test_jcs.py` -- JCS canonicalization (the hardest part, test first)
3. `_args_hash.py` + `test_args_hash.py` + `tests/fixtures/args-hash-vectors.json`
4. `_types.py` -- dataclasses
5. `_protocol.py` + `test_protocol.py` -- request/response serialization
6. `_connection.py` + `test_connection.py` -- UDS socket management
7. `_guard.py` + `test_guard.py` -- Guard class orchestration
8. `_openai.py` + `test_openai.py` -- OpenAI adapter
9. `__init__.py` -- exports
10. Final check: mypy strict, ruff, SPDX headers

---

## 20. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| JCS number formatting diverges from spec on edge-case floats | args_hash mismatch -> all calls fail-closed | 12 test vectors + edge-case fuzz testing. NOTE: `json.dumps` fails Vector 4 (number normalization: `1.0` -> `"1.0"` instead of `"1"`). Custom JCS implementation required. |
| Spec errata: Vector 8 hash was incorrect | Cross-implementation mismatch | Fixed in `specs/args-hash.md` on 2026-03-17. Original hash `474fd71a...` was computed against literal control chars (invalid JSON). Correct hash: `75bdf46f...`. |
| Python 3.10 lacks some modern typing features | Type errors in CI | `from __future__ import annotations` on every file |
| Large tool call args cause slow hashing | Latency spike | Document: shim hashes pre-send, engine only sees hash |
| Engine not running during agent startup | All calls fail or proceed unguarded | Lazy connection + clear fail_open docs |
| OpenAI SDK changes response shape | Adapter breaks | Duck typing is resilient; test with mock objects |
