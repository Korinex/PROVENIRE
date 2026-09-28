import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function addHelmetIfAvailable(app: express.Express) {
  try {
    const { default: helmet } = await import("helmet");
    app.use(
      helmet({
        contentSecurityPolicy: false,
      })
    );
  } catch {
    console.warn("[Security] helmet is not installed; skipping security middleware.");
  }
}

export function assertRequiredEnv() {
  if (process.env.NODE_ENV === "test") return;
  const required = ["JWT_SECRET"] as const;
  const missing = required.filter(key => !process.env[key] || !process.env[key]!.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

export async function startServer(portOverride?: number) {
  assertRequiredEnv();
  const app = express();
  await addHelmetIfAvailable(app);
  const server = createServer(app);
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = portOverride ?? parseInt(process.env.PORT || "3000");
  const port = portOverride ?? (await findAvailablePort(preferredPort));

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => {
      console.log(`Server running on http://localhost:${port}/`);
      resolve();
    });
    server.on("error", reject);
  });

  return server;
}

if (process.env.NODE_ENV !== "test") {
  startServer().catch(console.error);
}
