/**
 * Drawing files served from this app's own origin: GET /api/drawings/rev/:id/pdf | preview.
 * Same-origin, authenticated streaming avoids cross-origin storage CORS requirements.
 */
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { drawingRevisions, drawingSheets, type User } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { db } from "./db";
import { requireJobModule } from "./security/guard";
import { storageGetSignedUrl } from "./storage";
import { drawingEtagMatches, drawingFileEtag, streamDrawingBody } from "./drawingFileResponse";

export const revFileUrl = (revId: number, kind: "pdf" | "preview") => `/api/drawings/rev/${revId}/${kind}`;

export function registerDrawingFiles(app: Express) {
  app.get("/api/drawings/rev/:id/:kind", async (req: Request, res: Response) => {
    res.set("X-Content-Type-Options", "nosniff");
    const id = Number(req.params.id);
    const kind = req.params.kind;
    if (!Number.isInteger(id) || id <= 0 || (kind !== "pdf" && kind !== "preview")) return void res.status(400).send("Bad request");
    let user: User;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      return void res.status(401).send("Sign in to view drawings");
    }
    // Same rule as the tRPC protected middleware: deactivated and passive users get nothing.
    if (!user.isActive || user.accessType === "passive") return void res.status(403).send("Your account does not have access");
    if (res.destroyed) return;
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once("close", onClose);
    try {
      const d = await db();
      const [r] = await d.select().from(drawingRevisions).where(eq(drawingRevisions.id, id)).limit(1);
      if (!r) return void res.status(404).send("Not found");
      const [x] = await d.select({ projectId: drawingSheets.projectId, sheetNumber: drawingSheets.sheetNumber }).from(drawingSheets).where(eq(drawingSheets.id, r.sheetId)).limit(1);
      if (!x) return void res.status(404).send("Not found");
      try {
        await requireJobModule({ user, req }, x.projectId);
      } catch {
        return void res.status(403).send("You can't view drawings on this job");
      }
      const key = kind === "pdf" ? r.fileKey : r.previewKey;
      if (!key) return void res.status(404).send("No drawing on this revision");
      const etag = drawingFileEtag(key, kind);
      res.set({ "Cache-Control": "private, no-cache", ETag: etag });
      // Never let a conditional request bypass authentication or job-access checks.
      if (drawingEtagMatches(req.get("If-None-Match"), etag)) return void res.status(304).end();
      controller.signal.throwIfAborted();
      const up = await fetch(await storageGetSignedUrl(key), { signal: controller.signal });
      if (!up.ok || !up.body) {
        controller.abort();
        return void res.status(502).send("Storage backend error");
      }
      const contentLength = up.headers.get("content-length");
      if (contentLength) res.set("Content-Length", contentLength);
      const filename = kind === "pdf" ? r.fileName || `${x.sheetNumber}.pdf` : `${x.sheetNumber}-R${r.number}.jpg`;
      await streamDrawingBody(up.body, res, kind, filename, controller.signal);
    } catch (e) {
      const disconnected = controller.signal.aborted || res.destroyed;
      controller.abort();
      if (disconnected) return;
      console.error("[drawings] file failed:", e instanceof Error ? e.message : e);
      if (res.headersSent) res.destroy(e instanceof Error ? e : undefined);
      else {
        // Discard any partial file headers before returning a textual error response.
        for (const header of ["Content-Length", "Content-Disposition", "Content-Type", "Content-Security-Policy", "ETag"]) res.removeHeader(header);
        res.status(502).send("Could not load the drawing");
      }
    } finally {
      res.off("close", onClose);
    }
  });
}
