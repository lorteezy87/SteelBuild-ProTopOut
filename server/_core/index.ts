import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { applyOwnerPasswordReset, registerLocalAuthRoutes } from "./localAuth";
import { registerStorageRoute } from "../storageR2";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startJobs } from "../jobs";
import { registerDrawingFiles } from "../drawingFiles";

async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  registerLocalAuthRoutes(app);
  await applyOwnerPasswordReset().catch(e => console.error("[auth] password reset failed:", e instanceof Error ? e.message : e));
  registerStorageRoute(app);
  // Drawing files (PDF / page image) streamed same-origin for the sheet viewer
  registerDrawingFiles(app);
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

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
    startJobs();
  });
}

startServer().catch(error => { console.error(error); process.exit(1); });
