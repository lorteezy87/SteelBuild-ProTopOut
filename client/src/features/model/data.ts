/**
 * The Model's data in the browser: the register and the job's reads as the pure rules want them, the saves (every one
 * with the version it started from), and reading a sheet revision's framing. Reading runs in the browser — the
 * revision's PDF is opened with pdf.js, each page's line work and text taken (pageGeometry) and read (reader.ts);
 * nothing leaves the page but the result. Ported from SteelBuild src/modules/model/read.jsx.
 */
import { useCallback, useMemo } from "react";
import { TRPCClientError } from "@trpc/client";
import { toast } from "sonner";
import type { PDFPageProxy } from "pdfjs-dist";
import type { RouterOutputs } from "@/lib/ref";
import { useRefData } from "@/lib/ref";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { openPdfUrl, pageGeometry } from "../drawings/pdf";
import type { Register } from "../drawings/model";
import { MD, PAGES, plural, type ReadData, type ReadRec, type RevLite, type Settings, type SheetLite } from "./domain";
import { READER_VERSION, read } from "./reader";
import { MS } from "./space";

export type JobModel = RouterOutputs["model"]["job"];
type ServerRead = JobModel["reads"][number];

/** The register's sheets as the rules want them: revisions with their PDF and preview image, the sequence as text. */
export function sheetsOf(reg: Pick<Register, "sheets"> | null | undefined): SheetLite[] {
  return (reg?.sheets ?? []).map(x => ({
    id: x.id,
    sheet: x.sheetNumber,
    title: x.title,
    seq: x.sequenceTaskId != null ? String(x.sequenceTaskId) : "",
    revs: x.revs.map(r => {
      const image = /^image\//i.test(r.mimeType || "") || /\.(png|jpe?g|webp)$/i.test(r.fileName || "");
      return { n: r.number, state: r.state, pdf: r.url && !image ? r.url : null, img: r.previewUrl || (r.url && image ? r.url : null) };
    }),
  }));
}
export const recOf = (r: ServerRead): ReadRec => ({
  ...(r.data as ReadData),
  key: MD.idOf(r.sheetId, r.rev, r.page),
  id: r.id,
  sid: r.sheetId,
  rev: r.rev,
  pg: r.page,
  v: r.readerVersion,
  version: r.version,
  by: r.readBy ?? null,
  at: r.readAt ? new Date(r.readAt as unknown as string).toISOString() : "",
});
/** A read's own data, without where it belongs. */
export const dataOf = (r: ReadRec): ReadData => ({
  w: r.w,
  h: r.h,
  ppf: r.ppf,
  sl: r.sl,
  lvl: r.lvl,
  lvlBy: r.lvlBy,
  tos: r.tos,
  tosBy: r.tosBy,
  grids: r.grids,
  pcs: r.pcs,
  cols: r.cols,
  left: r.left,
  aside: r.aside,
});
export const seqNames = (reg: Pick<Register, "sequences"> | null | undefined) => new Map((reg?.sequences ?? []).map(s => [String(s.id), s.name]));

const isConflict = (e: unknown) => e instanceof TRPCClientError && (e.data as { code?: string } | undefined)?.code === "CONFLICT";

/** The job's register, reads and settings, cleaned for the rules, and the saves. */
export function useModel(projectId: number) {
  const reg = trpc.drawings.register.useQuery({ projectId });
  const job = trpc.model.job.useQuery({ projectId });
  const { ref } = useRefData();
  const utils = trpc.useUtils();
  const saveM = trpc.model.saveRead.useMutation({ retry: false });
  const removeM = trpc.model.removeRead.useMutation({ retry: false });
  const settingsM = trpc.model.saveSettings.useMutation({ retry: false });

  const sheets = useMemo(() => sheetsOf(reg.data), [reg.data]);
  const recs = useMemo(() => (job.data?.reads ?? []).map(recOf), [job.data]);
  const cfg: Settings = useMemo(() => (job.data ? MD.cleanSettings(job.data.settings.data) : MD.noSettings()), [job.data]);
  const seqName = useMemo(() => seqNames(reg.data), [reg.data]);
  const refresh = useCallback(() => utils.model.job.invalidate({ projectId }), [utils, projectId]);

  /**
   * Save a read's data. base: the read it changes (its version is what the server must still have), or where a new one
   * goes. A conflict (someone saved meanwhile) reloads and says so; returns whether it saved.
   */
  const save = useCallback(
    async (base: { sid: number; rev: number; pg: number; id?: number | null; version: number; v?: number }, data: ReadData, summary: string, opts: { fresh?: boolean; quiet?: boolean } = {}) => {
      try {
        await saveM.mutateAsync({
          sheetId: base.sid,
          rev: base.rev,
          page: base.pg,
          readerVersion: opts.fresh ? READER_VERSION : base.v ?? 0,
          data: MD.clean(data),
          expected: { id: base.id ?? null, version: base.version },
          summary: summary.slice(0, 300),
          fresh: !!opts.fresh,
        });
        await refresh();
        return true;
      } catch (e) {
        if (isConflict(e)) {
          await refresh();
          toast.error("Someone changed this sheet’s framing meanwhile. It has been reloaded — make your change again.");
        } else if (!opts.quiet) toast.error(errMsg(e));
        if (opts.quiet) throw e;
        return false;
      }
    },
    [saveM, refresh]
  );
  const remove = useCallback(async (read: { id: number; version: number }) => {
    try {
      await removeM.mutateAsync(read);
      await refresh();
    } catch (e) {
      if (isConflict(e)) {
        await refresh();
        toast.error("Someone changed this sheet’s framing meanwhile. It has been reloaded — nothing cleared.");
      } else toast.error(errMsg(e));
      throw e; // Stop page cleanup; never retry a stale deletion against the refreshed record.
    }
  }, [removeM, refresh]);
  const saveSettings = useCallback(
    async (data: Settings, expectedVersion: number) => {
      try {
        await settingsM.mutateAsync({ projectId, data: MD.cleanSettings(data), expectedVersion });
        await refresh();
        return true;
      } catch (e) {
        if (isConflict(e)) {
          await refresh();
          toast.error("Someone changed these settings meanwhile. They have been reloaded — make your change again.");
        } else toast.error(errMsg(e));
        return false;
      }
    },
    [settingsM, projectId, refresh]
  );

  return {
    reg,
    job,
    sheets,
    recs,
    cfg,
    seqName,
    canEdit: !!job.data?.canEdit,
    me: ref?.me.id,
    save,
    remove,
    saveSettings,
    refresh,
    loading: reg.isLoading || job.isLoading,
    error: reg.error || job.error,
  };
}
export type ModelApi = ReturnType<typeof useModel>;

/** The pages of a read, as the reader gives them, ready to save. */
export type PageRead = { pg: number; data: ReadData; pieces: number };

/** Read one PDF page: its line work and text, the reader's pieces, the level and elevation (hand values on old kept). */
export async function readPage(page: PDFPageProxy, pg: number, title: string, old: ReadRec | null | undefined): Promise<PageRead | null> {
  const geo = await pageGeometry(page);
  if (!geo.text.length) return null; // a scan: no text to read
  const out = read(geo, pg);
  const data = MD.clean({ ...MD.fromRead(out, geo), ...MS.levelFields(geo.text, title, old) });
  return { pg, data, pieces: data.pcs.length };
}

/** The read of the same page of the sheet's newest revision read before (its level set by hand carries over). */
export const oldRead = (recs: ReadRec[], sid: number, pg: number) => recs.filter(y => y.sid === sid && y.pg === pg).sort((a, b) => b.rev - a.rev)[0] || null;
/** How many pieces on this sheet revision were already reviewed (reading again replaces them). */
export const reviewedOn = (recs: ReadRec[], sid: number, rev: number) => recs.filter(y => y.sid === sid && y.rev === rev).reduce((a, y) => a + y.pcs.filter(p => p.st !== "auto").length, 0);

/**
 * Read one sheet revision (its PDF, up to PAGES pages) and save each page's read. A page read before and not this time
 * (fewer pages now) is removed. → { ok, pieces, why, scans }.
 */
export async function readSheet(api: Pick<ModelApi, "save" | "remove" | "recs">, x: SheetLite, rev: RevLite): Promise<{ ok: boolean; pieces: number; why: string; scans: number[] }> {
  if (!rev.pdf) return { ok: false, pieces: 0, why: x.sheet + " Rev " + rev.n + " has only a preview image. Attach its PDF to read the framing.", scans: [] };
  let doc: Awaited<ReturnType<typeof openPdfUrl>> | null = null;
  const pages: PageRead[] = [],
    scans: number[] = [];
  try {
    try {
      doc = await openPdfUrl(rev.pdf);
    } catch {
      return { ok: false, pieces: 0, why: "The drawing for " + x.sheet + " Rev " + rev.n + " couldn’t be opened.", scans: [] };
    }
    for (let pg = 1; pg <= Math.min(doc.numPages || 1, PAGES); pg++) {
      const page = await doc.getPage(pg);
      try {
        const r = await readPage(page, pg, x.title, oldRead(api.recs, x.id, pg));
        if (r) pages.push(r);
        else scans.push(pg);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    if (doc) void doc.destroy();
  }
  if (!pages.length)
    return { ok: false, pieces: 0, why: x.sheet + " Rev " + rev.n + ": no text in the drawing (a scan or an image), so its framing can’t be read. Pieces can be drawn by hand in the viewer.", scans };
  for (const p of pages) {
    const cur = api.recs.find(y => y.key === MD.idOf(x.id, rev.n, p.pg));
    await api.save(
      { sid: x.id, rev: rev.n, pg: p.pg, id: cur?.id ?? null, version: cur?.version ?? 0 },
      p.data,
      "read framing of " + x.sheet + ": " + plural(p.pieces, "piece") + (p.data.left.length ? ", " + plural(p.data.left.length, "label") + " not placed" : ""),
      { fresh: true, quiet: true }
    );
  }
  for (const y of api.recs.filter(y => y.sid === x.id && y.rev === rev.n && y.id != null && !pages.some(p => p.pg === y.pg))) await api.remove({ id: y.id!, version: y.version });
  return { ok: true, pieces: pages.reduce((a, p) => a + p.pieces, 0), why: "", scans };
}
