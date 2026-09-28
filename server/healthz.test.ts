import express from "express";
import { describe, expect, it } from "vitest";
import { registerHealthz } from "./_core/health";

describe("GET /healthz", () => {
  it("returns status and uptime before later middleware", async () => {
    const app = express();
    registerHealthz(app, () => 12.5);
    app.use((_req, res) => res.status(401).end());
    const server = app.listen(0, "127.0.0.1");

    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");

      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", uptime: 12.5 });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});