// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test";
import { validateConfig } from "../src/config.js";

describe("validateConfig", () => {
  const minimal = {
    schema_version: 1,
    transport: { type: "stdio" },
    upstreams: [{ id: "fs", transport: { type: "stdio", command: "echo" } }],
  };

  test("accepts minimal valid config", () => {
    const cfg = validateConfig(minimal);
    expect(cfg.schema_version).toBe(1);
    expect(cfg.transport.type).toBe("stdio");
    expect(cfg.upstreams).toHaveLength(1);
    expect(cfg.upstreams[0]?.id).toBe("fs");
  });

  test("rejects wrong schema_version", () => {
    expect(() => validateConfig({ ...minimal, schema_version: 2 })).toThrow("schema_version");
  });

  test("rejects missing transport.type", () => {
    expect(() => validateConfig({ ...minimal, transport: {} })).toThrow("transport.type");
  });

  test("rejects invalid transport.type", () => {
    expect(() => validateConfig({ ...minimal, transport: { type: "websocket" } })).toThrow(
      "Invalid transport.type"
    );
  });

  test("rejects non-loopback host", () => {
    expect(() =>
      validateConfig({
        ...minimal,
        transport: { type: "http", host: "0.0.0.0" },
      })
    ).toThrow("Non-loopback");
  });

  test("accepts loopback hosts", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      const cfg = validateConfig({
        ...minimal,
        transport: { type: "http", host },
      });
      expect(cfg.transport.host).toBe(host);
    }
  });

  test("rejects empty upstreams", () => {
    expect(() => validateConfig({ ...minimal, upstreams: [] })).toThrow("At least one upstream");
  });

  test("rejects upstream missing id", () => {
    expect(() =>
      validateConfig({
        ...minimal,
        upstreams: [{ transport: { type: "stdio", command: "echo" } }],
      })
    ).toThrow("upstreams[0].id");
  });

  test("rejects stdio upstream missing command", () => {
    expect(() =>
      validateConfig({
        ...minimal,
        upstreams: [{ id: "x", transport: { type: "stdio" } }],
      })
    ).toThrow("command is required");
  });

  test("rejects http upstream missing url", () => {
    expect(() =>
      validateConfig({
        ...minimal,
        upstreams: [{ id: "x", transport: { type: "http" } }],
      })
    ).toThrow("url is required");
  });

  test("defaults engine_socket to platform path", () => {
    const cfg = validateConfig(minimal);
    expect(cfg.engine_socket).toBeTruthy();
  });

  test("defaults port to 3100", () => {
    const cfg = validateConfig({
      ...minimal,
      transport: { type: "http", host: "127.0.0.1" },
    });
    expect(cfg.transport.port).toBe(3100);
  });

  test("passes optional agent fields through", () => {
    const cfg = validateConfig({
      ...minimal,
      agent_name: "my-agent",
      agent_role: "worker",
      environment: "staging",
    });
    expect(cfg.agent_name).toBe("my-agent");
    expect(cfg.agent_role).toBe("worker");
    expect(cfg.environment).toBe("staging");
  });

  test("prefix defaults to false", () => {
    const cfg = validateConfig(minimal);
    expect(cfg.upstreams[0]?.prefix).toBe(false);
  });

  test("prefix can be set to true", () => {
    const cfg = validateConfig({
      ...minimal,
      upstreams: [{ id: "gh", transport: { type: "stdio", command: "echo" }, prefix: true }],
    });
    expect(cfg.upstreams[0]?.prefix).toBe(true);
  });
});
