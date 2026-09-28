import type { Express } from "express";

export function registerHealthz(app: Express, getUptime: () => number = () => process.uptime()) {
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", uptime: getUptime() });
  });
}