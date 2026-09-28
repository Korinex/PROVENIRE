import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "./_core/index";
import http from "node:http";

const ports: number[] = [];

afterEach(() => {
  ports.splice(0, ports.length);
});

describe("health endpoint", () => {
  it("returns ok with uptime", async () => {
    const server = await startServer(3199);
    ports.push(3199);
    const res = await fetch("http://localhost:3199/healthz");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    server.close();
  });
});
