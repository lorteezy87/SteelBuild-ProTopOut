/* eslint-disable no-console */
/**
 * End-to-end check of the drawing register through the real tRPC router and database.
 * Run against a throwaway database: DATABASE_URL=... npx tsx scripts/drawings-e2e.ts
 * File storage is stubbed (no network): uploads return a fake /manus-storage/ path.
 */
import { and, eq } from "drizzle-orm";
import { drawingRevisions, drawingSheets, roleAssignments, securityRoles, users, wfItems, type User } from "../drizzle/schema";
import { db } from "../server/db";
import { ensureBootstrap } from "../server/bootstrap";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

process.env.MANUS_API_URL ||= "http://storage.test";
process.env.MANUS_API_KEY ||= "test";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("presign/put")) return new Response(JSON.stringify({ url: "http://storage.test/put" }));
  if (u === "http://storage.test/put" && init?.method === "PUT") return new Response("");
  return realFetch(url, init);
}) as typeof fetch;

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, info?: unknown) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && info !== undefined ? " — " + JSON.stringify(info).slice(0, 400) : ""}`);
};
async function expectErr(name: string, fn: () => Promise<unknown>, re: RegExp) {
  try {
    await fn();
    ok(name, false, "no error");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    ok(name, re.test(m), m);
  }
}

async function userWith(openId: string, name: string, accessType: string, roleKey: string | null, projectId: number) {
  const d = await db();
  let [u] = await d.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!u) {
    await d.insert(users).values({ openId, name, email: `${openId.slice(6)}@example.com`, role: "user", accessType, loginMethod: "test" });
    [u] = await d.select().from(users).where(eq(users.openId, openId)).limit(1);
  }
  if (roleKey) {
    const [r] = await d.select().from(securityRoles).where(eq(securityRoles.key, roleKey)).limit(1);
    const has = await d.select().from(roleAssignments).where(and(eq(roleAssignments.userId, u.id), eq(roleAssignments.scopeId, projectId)));
    if (!has.length) await d.insert(roleAssignments).values({ userId: u.id, roleId: r.id, scopeType: "project", scopeId: projectId });
  }
  return u;
}
const caller = (u: User) =>
  appRouter.createCaller({ req: { headers: {} } as TrpcContext["req"], res: { cookie() {}, clearCookie() {} } as unknown as TrpcContext["res"], user: u, quiet: true } as TrpcContext);
const pdf = (name: string) => ({ fileName: name, mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4 test " + name).toString("base64") });

async function main() {
  await ensureBootstrap();
  const d = await db();
  const openId = "local:smoketest-admin";
  let [admin] = await d.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!admin) {
    await d.insert(users).values({ openId, name: "Smoke Admin", email: "smoke@example.com", role: "admin", accessType: "full", loginMethod: "test" });
    [admin] = await d.select().from(users).where(eq(users.openId, openId)).limit(1);
  }
  const A = caller(admin);
  const demo = await A.admin.loadDemo().catch(() => null);
  const jobs = await A.projects.list({});
  const pid = (demo as { projectIds?: number[] } | null)?.projectIds?.[0] ?? (jobs as { id: number }[])[0].id;
  const pid2 = (jobs as { id: number }[]).find(j => j.id !== pid)!.id;
  console.log("job", pid, "other job", pid2);

  const supt = await userWith("local:e2e-supt", "E2E Super", "team_member", "superintendent", pid);
  const viewer = await userWith("local:e2e-viewer", "E2E Viewer", "team_member", "viewer", pid);
  const logsOnly = await userWith("local:e2e-logs", "E2E Logs", "app_only", "project_manager", pid);
  const S = caller(supt);
  const V = caller(viewer);
  const L = caller(logsOnly);

  let reg = await A.drawings.register({ projectId: pid });
  ok("register loads empty", reg.sheets.length === 0 && reg.canEdit && reg.canUpload, { n: reg.sheets.length });
  const seqs = reg.sequences;
  ok("job has erection sequences", seqs.length > 0, seqs.length);
  const otherSeq = (await A.drawings.register({ projectId: pid2 })).sequences[0];

  /* -------- sets -------- */
  const set1 = await A.drawings.saveSet({ projectId: pid, number: "E-SET-01", name: "Erection Seq 1", kind: "erection" });
  await expectErr("duplicate set number refused (case-insensitive)", () => A.drawings.saveSet({ projectId: pid, number: "e-set-01", name: "x", kind: "erection" }), /already exists/);
  await expectErr("superintendent cannot create sets", () => S.drawings.saveSet({ projectId: pid, number: "E-SET-09", name: "x", kind: "erection" }), /project\.edit/);
  await expectErr("viewer cannot add sheets", () => V.drawings.saveSheet({ projectId: pid, sheetNumber: "V-1", title: "x" }), /document\.upload/);
  await expectErr("logs-only tier cannot open the register", () => L.drawings.register({ projectId: pid }), /Logs and Timesheets/);
  const vreg = await V.drawings.register({ projectId: pid });
  ok("viewer can read, cannot edit/upload", !vreg.canEdit && !vreg.canUpload);

  /* -------- sheets -------- */
  const s1 = await S.drawings.saveSheet({ projectId: pid, setId: set1.id, sheetNumber: "E-101", title: "Seq 1 anchor bolt plan", sequenceTaskId: seqs[0].id, file: pdf("E-101.pdf") });
  const s2 = await A.drawings.saveSheet({ projectId: pid, setId: set1.id, sheetNumber: "E-102", title: "Seq 1 framing", sequenceTaskId: seqs[0].id, startRev: 2 });
  const s3 = await A.drawings.saveSheet({ projectId: pid, setId: set1.id, sheetNumber: "E1-1", title: "Details" });
  await expectErr("duplicate sheet number refused (case, dash style)", () => A.drawings.saveSheet({ projectId: pid, sheetNumber: "e–101", title: "x" }), /already exists/);
  await expectErr("look-alike sheet number refused (space for dash)", () => A.drawings.saveSheet({ projectId: pid, sheetNumber: "e 101", title: "x" }), /Reads as sheet E-101/);
  await expectErr("clashing sheet number refused", () => A.drawings.saveSheet({ projectId: pid, sheetNumber: "E-11", title: "x" }), /Reads as sheet E1-1/);
  await expectErr("sequence from another job refused", () => A.drawings.saveSheet({ projectId: pid, sheetNumber: "E-150", title: "x", sequenceTaskId: otherSeq?.id ?? 999999 }), /sequence on this job/);
  await expectErr("new sheet cannot carry review dates", () => A.drawings.saveSheet({ projectId: pid, sheetNumber: "E-151", title: "x", sentDate: "2026-10-01" }), /detailing/);
  await expectErr("future returned date refused", () => A.drawings.saveSheet({ projectId: pid, id: s3.id, sheetNumber: "E1-1", title: "Details", sentDate: "2026-10-01", returnedDate: "2099-01-01" }), /future/);
  // the same sheet number may exist on another job
  const other = await A.drawings.saveSheet({ projectId: pid2, sheetNumber: "E-101", title: "Other job sheet" });
  ok("same number allowed on another job", !!other.id);

  reg = await A.drawings.register({ projectId: pid });
  const get = (id: number) => reg.sheets.find(x => x.id === id)!;
  ok("new sheet starts DET with Rev 0 draft + drawing", get(s1.id).status === "DET" && get(s1.id).revs.length === 1 && get(s1.id).revs[0].state === "draft" && !!get(s1.id).revs[0].url);
  ok("starting revision honoured", get(s2.id).revs[0].number === 2);
  ok("no current rev before issue", get(s1.id).currentRev === null);

  /* -------- status rules before issue -------- */
  await expectErr("cannot submit before a revision is issued", () => A.drawings.action({ id: s1.id, action: "submit" }), /Sign off and issue Rev 0/);
  await expectErr("cannot approve without an observed issued revision", () => A.drawings.action({ id: s1.id, action: "approve", expectedRevisionId: get(s1.id).revs.find(r => r.state === "issued")?.id }), /reload and review/);
  const r1 = get(s1.id).revs[0];
  await expectErr("cannot issue a draft", () => A.drawings.issueRevision({ revisionId: r1.id }), /Sign off Rev 0/);
  await expectErr("cannot discard the only revision", () => A.drawings.discardDraft({ revisionId: r1.id }), /only revision/);
  await expectErr("cannot start a second pending revision", () => A.drawings.startRevision({ sheetId: s1.id }), /still a draft/);

  /* -------- sign off and issue -------- */
  await S.drawings.signOff({ revisionId: r1.id });
  await expectErr("sign off twice refused", () => S.drawings.signOff({ revisionId: r1.id }), /not a draft/);
  await S.drawings.undoSignOff({ revisionId: r1.id });
  await S.drawings.signOff({ revisionId: r1.id });
  await S.drawings.issueRevision({ revisionId: r1.id });
  reg = await A.drawings.register({ projectId: pid });
  let x1 = get(s1.id);
  ok("issuing Rev 0 sends sheet to review, sent today, GC", x1.status === "REV" && x1.sentDate === reg.today && x1.ballInCourt === "GC" && x1.currentRev === 0, x1);
  await expectErr("undo sign-off after issue refused", () => S.drawings.undoSignOff({ revisionId: r1.id }), /meanwhile/);
  await expectErr("edit cannot clear sent date while in review", () => A.drawings.saveSheet({ projectId: pid, id: s1.id, sheetNumber: "E-101", title: x1.title, setId: set1.id, sentDate: null, returnedDate: null }), /needs its sent date/);
  await expectErr("attach to signed-off/issued revision with a drawing refused", () => A.drawings.attachFile({ revisionId: r1.id, file: pdf("x.pdf") }), /start a new revision/);

  /* -------- review outcomes -------- */
  await A.drawings.action({ id: s1.id, action: "revise", expectedRevisionId: get(s1.id).revs.find(r => r.state === "issued")!.id });
  reg = await A.drawings.register({ projectId: pid });
  x1 = get(s1.id);
  ok("revise & resubmit: RR, returned today, Detailer", x1.status === "RR" && x1.returnedDate === reg.today && x1.ballInCourt === "Detailer");
  await expectErr("RR cannot be approved directly", () => A.drawings.action({ id: s1.id, action: "approve", expectedRevisionId: get(s1.id).revs.find(r => r.state === "issued")!.id }), /not available/);
  const rev1 = await S.drawings.startRevision({ sheetId: s1.id, notes: "Per GC redlines", file: pdf("E-101 R1.pdf") });
  ok("next revision number is 1", rev1.number === 1);
  reg = await A.drawings.register({ projectId: pid });
  const r1b = get(s1.id).revs.find(r => r.number === 1)!;
  await S.drawings.attachFile({ revisionId: r1b.id, file: pdf("E-101 R1 v2.pdf") }); // a draft's drawing can be replaced
  await A.drawings.bulk({ projectId: pid, items: [{ sheetId: s1.id, revisionId: r1b.id }], step: "signoff" });
  const bi = await A.drawings.bulk({ projectId: pid, items: [{ sheetId: s1.id, revisionId: r1b.id }], step: "issue" });
  ok("bulk issue issued 1", bi.done === 1, bi);
  reg = await A.drawings.register({ projectId: pid });
  x1 = get(s1.id);
  ok("Rev 1 issued, Rev 0 superseded, back in review", x1.currentRev === 1 && x1.status === "REV" && x1.revs.find(r => r.number === 0)!.state === "superseded" && x1.returnedDate === null, x1.revs.map(r => [r.number, r.state]));
  await expectErr("superseded revision takes no drawings", () => A.drawings.attachFile({ revisionId: r1.id, file: pdf("x.pdf") }), /superseded/);
  await A.drawings.action({ id: s1.id, action: "approve", expectedRevisionId: get(s1.id).revs.find(r => r.state === "issued")!.id });
  reg = await A.drawings.register({ projectId: pid });
  ok("approve releases", get(s1.id).status === "REL" && get(s1.id).ballInCourt === "—");

  /* -------- holds and RFIs -------- */
  const rfi = reg.openRfis[0];
  ok("job has an open RFI to hold with", !!rfi, reg.openRfis.length);
  await A.drawings.action({ id: s1.id, action: "hold", holdRfiId: rfi.id, holdReason: "Embed conflict at C/4" });
  reg = await A.drawings.register({ projectId: pid });
  x1 = get(s1.id);
  ok("hold remembers REL and RFI", x1.status === "HOLD" && x1.holdFrom === "REL" && x1.holdRfi?.id === rfi.id && x1.holdReason === "Embed conflict at C/4");
  await expectErr("release refused while RFI open", () => A.drawings.action({ id: s1.id, action: "release" }), /close the RFI/);
  // a new revision issued while held keeps the hold and queues review
  await A.drawings.startRevision({ sheetId: s1.id });
  reg = await A.drawings.register({ projectId: pid });
  const r2 = get(s1.id).revs.find(r => r.number === 2)!;
  await A.drawings.signOff({ revisionId: r2.id });
  await A.drawings.issueRevision({ revisionId: r2.id });
  reg = await A.drawings.register({ projectId: pid });
  x1 = get(s1.id);
  ok("issue while held: stays HOLD, will return to REV", x1.status === "HOLD" && x1.holdFrom === "REV" && x1.currentRev === 2);
  await d.update(wfItems).set({ closedAt: new Date() }).where(eq(wfItems.id, rfi.id));
  await A.drawings.action({ id: s1.id, action: "release" });
  reg = await A.drawings.register({ projectId: pid });
  x1 = get(s1.id);
  ok("release after RFI closed returns to review, clears hold", x1.status === "REV" && !x1.holdRfiId && !x1.holdReason && x1.ballInCourt === "GC", x1);
  await d.update(wfItems).set({ closedAt: null }).where(eq(wfItems.id, rfi.id));
  await expectErr("cannot hold with an RFI from another job", async () => {
    const [foreign] = await d.select().from(wfItems).where(eq(wfItems.projectId, pid2)).limit(1);
    return A.drawings.action({ id: s2.id, action: "hold", holdRfiId: foreign?.id ?? 999999 });
  }, /RFI on this job/);
  await A.drawings.action({ id: s1.id, action: "approve", expectedRevisionId: get(s1.id).revs.find(r => r.state === "issued")!.id });

  /* -------- set issues -------- */
  // s2 is DET with a draft only; s3 likewise. Issue s2 so "For approval" can include it.
  reg = await A.drawings.register({ projectId: pid });
  const r22 = get(s2.id).revs[0];
  await A.drawings.signOff({ revisionId: r22.id });
  await A.drawings.issueRevision({ revisionId: r22.id }); // goes to REV
  await expectErr("superintendent cannot record a set issue", () => S.drawings.recordIssue({ setId: set1.id, purpose: "For erection", issueDate: reg.today }), /project\.edit/);
  await expectErr("future issue date refused", () => A.drawings.recordIssue({ setId: set1.id, purpose: "For erection", issueDate: "2099-01-01" }), /future/);
  const iss1 = await A.drawings.recordIssue({ setId: set1.id, purpose: "For erection", issueDate: reg.today, note: "To GC" });
  ok("erection issue takes only released sheets", iss1.number === 1 && iss1.recorded === 1, iss1);
  ok("left-out reasons recorded", iss1.skipped.some(s => s.sheet === "E-102" && /not released/.test(s.why)) && iss1.skipped.some(s => s.sheet === "E1-1" && s.why === "no issued revision"), iss1.skipped);
  const iss2 = await A.drawings.recordIssue({ setId: set1.id, purpose: "For approval", issueDate: reg.today });
  ok("approval issue takes every issued revision; numbers increment", iss2.number === 2 && iss2.recorded === 2, iss2);
  const empty = await A.drawings.saveSet({ projectId: pid, number: "E-SET-02", name: "Empty", kind: "shop" });
  await expectErr("issuing an empty set refused", () => A.drawings.recordIssue({ setId: empty.id, purpose: "For record", issueDate: reg.today }), /Add sheets/);

  /* -------- renumber / delete protection -------- */
  reg = await A.drawings.register({ projectId: pid });
  ok("sheet flagged as sent on a set issue", get(s1.id).inSetIssue === true);
  await expectErr("superintendent cannot renumber an issued sheet", () => S.drawings.saveSheet({ projectId: pid, id: s1.id, sheetNumber: "E-101A", title: get(s1.id).title, setId: set1.id, sentDate: get(s1.id).sentDate, returnedDate: get(s1.id).returnedDate }), /only an editor/);
  await expectErr("superintendent cannot delete an issued sheet", () => S.drawings.removeSheet({ id: s1.id }), /only an editor/);
  const tmp = await S.drawings.saveSheet({ projectId: pid, sheetNumber: "TMP-1", title: "Scratch" });
  await S.drawings.removeSheet({ id: tmp.id });
  const gone = await d.select().from(drawingRevisions).where(eq(drawingRevisions.sheetId, tmp.id));
  ok("deleting a sheet removes its revisions", gone.length === 0);

  /* -------- discard -------- */
  await A.drawings.startRevision({ sheetId: s1.id });
  reg = await A.drawings.register({ projectId: pid });
  const r3 = get(s1.id).revs.find(r => r.number === 3)!;
  await A.drawings.discardDraft({ revisionId: r3.id });
  reg = await A.drawings.register({ projectId: pid });
  ok("discard removes the draft, issued stays current", !get(s1.id).revs.some(r => r.number === 3) && get(s1.id).currentRev === 2);

  /* -------- concurrency: two issues at once -------- */
  await A.drawings.startRevision({ sheetId: s1.id });
  reg = await A.drawings.register({ projectId: pid });
  const r4 = get(s1.id).revs.find(r => r.number === 3)!;
  await A.drawings.signOff({ revisionId: r4.id });
  const both = await Promise.allSettled([A.drawings.issueRevision({ revisionId: r4.id }), A.drawings.issueRevision({ revisionId: r4.id })]);
  ok("double issue: exactly one succeeds", both.filter(b => b.status === "fulfilled").length === 1, both.map(b => b.status));
  const issuedNow = await d.select().from(drawingRevisions).where(and(eq(drawingRevisions.sheetId, s1.id), eq(drawingRevisions.state, "issued")));
  ok("exactly one issued revision", issuedNow.length === 1 && issuedNow[0].number === 3);
  const dupSheets = await Promise.allSettled([A.drawings.saveSheet({ projectId: pid, sheetNumber: "RACE-1", title: "a" }), A.drawings.saveSheet({ projectId: pid, sheetNumber: "race 1", title: "b" })]);
  ok("racing duplicate sheets: one created", dupSheets.filter(b => b.status === "fulfilled").length === 1, dupSheets.map(b => b.status === "rejected" ? String(b.reason?.message) : "ok"));
  const races = await Promise.allSettled([A.drawings.recordIssue({ setId: set1.id, purpose: "For record", issueDate: reg.today }), A.drawings.recordIssue({ setId: set1.id, purpose: "For record", issueDate: reg.today })]);
  const nums = races.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<{ number: number }>).value.number).sort();
  ok("racing set issues get distinct numbers", nums.length === 2 && nums[0] !== nums[1], races.map(r => r.status === "rejected" ? String(r.reason?.message) : (r as PromiseFulfilledResult<{ number: number }>).value.number));

  /* -------- import: explicit revision numbers and revision details -------- */
  const jpg = (name: string) => ({ fileName: name, mimeType: "image/jpeg", base64: Buffer.from("\xff\xd8\xff test " + name).toString("base64") });
  const imp = await S.drawings.saveSheet({
    projectId: pid, sheetNumber: "E-301", title: "Seq 3 framing", startRev: 2, file: pdf("E-301.pdf"), preview: jpg("E-301.jpg"),
    revDescription: "Issued for erection", revDate: "2026-10-01", source: "Read from Set.pdf p4", readVia: "pdf",
  });
  reg = await A.drawings.register({ projectId: pid });
  const ir = get(imp.id).revs[0];
  ok("import keeps the stated revision, page image and revision details", ir.number === 2 && !!ir.url && !!ir.previewUrl && ir.description === "Issued for erection" && ir.revDate === "2026-10-01" && ir.source === "Read from Set.pdf p4" && ir.readVia === "pdf", ir);
  await expectErr("revision date in the future refused", () => S.drawings.saveSheet({ projectId: pid, sheetNumber: "E-302", title: "x", revDate: "2099-01-01" }), /future/);
  await A.drawings.signOff({ revisionId: ir.id });
  await A.drawings.issueRevision({ revisionId: ir.id });
  await expectErr("an imported revision older than the register is refused", () => S.drawings.startRevision({ sheetId: imp.id, number: 2, preview: jpg("x.jpg") }), /not newer/);
  const r5 = await S.drawings.startRevision({ sheetId: imp.id, number: 5, preview: jpg("E-301 R5.jpg"), revDescription: "Revised per RFI-003", source: "Read from Set B.pdf p1", readVia: "ai" });
  ok("an imported revision keeps its own number (R2 → R5)", r5.number === 5);
  await expectErr("a second pending revision from an import is refused", () => S.drawings.startRevision({ sheetId: imp.id, number: 6 }), /still a draft/);

  /* -------- title-block boxes -------- */
  const tb0 = await V.drawings.titleBlock({ projectId: pid });
  ok("title block starts at the default boxes", !tb0.saved && tb0.boxes.sheet.x === 0.88);
  const boxes = { sheet: { x: 0.84, y: 0.9, w: 0.14, h: 0.04 }, title: { x: 0.84, y: 0.85, w: 0.14, h: 0.03 }, rev: { x: 0.84, y: 0.71, w: 0.14, h: 0.06 } };
  await expectErr("viewer cannot save title-block boxes", () => V.drawings.saveTitleBlock({ projectId: pid, boxes }), /document\.upload/);
  await expectErr("a box running off the page is refused", () => S.drawings.saveTitleBlock({ projectId: pid, boxes: { ...boxes, rev: { x: 0.9, y: 0.7, w: 0.2, h: 0.1 } } }), /off the page/);
  await S.drawings.saveTitleBlock({ projectId: pid, boxes });
  await S.drawings.saveTitleBlock({ projectId: pid, boxes });
  const tb1 = await V.drawings.titleBlock({ projectId: pid });
  ok("title-block boxes saved per job (and saved again in place)", tb1.saved && tb1.boxes.sheet.x === 0.84);

  /* -------- markups and scales -------- */
  const m1 = await S.drawings.saveMark({ sheetId: imp.id, rev: 2, page: 1, kind: "cloud", points: [[0.1, 0.1], [0.2, 0.2]], color: "#E8590C", note: "Check embed" });
  const m2 = await S.drawings.saveMark({ sheetId: imp.id, rev: 2, page: 1, kind: "note", points: [[0.5, 0.5]], color: "#2563EB", note: "Field verify" });
  const m3 = await A.drawings.saveMark({ sheetId: imp.id, rev: 2, page: 1, kind: "length", points: [[0.1, 0.5], [0.4, 0.5]], color: "#16A34A" });
  ok("markups numbered N1, N2; lengths unnumbered", m1.label === "N1" && m2.label === "N2" && m3.label === null, [m1, m2, m3]);
  await expectErr("markup on a revision the sheet doesn't have", () => S.drawings.saveMark({ sheetId: imp.id, rev: 9, kind: "note", points: [[0.5, 0.5]], color: "#E8590C" }), /no Rev 9/);
  await expectErr("two-point markup needs two points", () => S.drawings.saveMark({ sheetId: imp.id, rev: 2, kind: "arrow", points: [[0.5, 0.5]], color: "#E8590C" }), /two points/);
  await expectErr("viewer cannot add markups", () => V.drawings.saveMark({ sheetId: imp.id, rev: 2, kind: "note", points: [[0.5, 0.5]], color: "#E8590C" }), /document\.upload/);
  await expectErr("superintendent cannot change an admin's markup", () => S.drawings.removeMark({ id: m3.id }), /author or an editor/);
  await A.drawings.saveMark({ id: m1.id, sheetId: imp.id, rev: 2, page: 1, kind: "cloud", points: [[0.1, 0.1], [0.3, 0.3]], color: "#DC2626", note: "Check embed — moved" });
  await S.drawings.removeMark({ id: m2.id });
  await S.drawings.setScale({ sheetId: imp.id, rev: 2, page: 1, feetPerWidth: 288, label: '1/8" = 1\'-0"' });
  await S.drawings.setScale({ sheetId: imp.id, rev: 2, page: 1, feetPerWidth: 144, label: '1/4" = 1\'-0"' });
  const mk = await V.drawings.marks({ sheetId: imp.id });
  ok("editor changed a markup; author removed theirs; scale set once per page", mk.marks.length === 2 && mk.marks.find(m => m.id === m1.id)?.color === "#DC2626" && mk.scales.length === 1 && mk.scales[0].feetPerWidth === 144 && !mk.canMark, mk);

  /* -------- framing reads -------- */
  const data = { w: 2592, h: 1728, ppf: 9, sl: '1/8"=1\'-0"', lvl: "L2", lvlBy: "read" as const, tos: 120.5, tosBy: "hand" as const, grids: [{ n: "A", a: [0, 100, 2000, 100] as [number, number, number, number] }],
    pcs: [{ id: "p1", k: "beam" as const, mark: "B1", size: "W16X26", a: [100, 100, 500, 100] as [number, number, number, number], len: 22.5, ends: [], via: "" as const, st: "auto" as const }], cols: [], left: [], aside: [] };
  await expectErr("superintendent cannot save framing (editors only)", () => S.model.saveRead({ sheetId: imp.id, rev: 2, page: 1, data, expected: { id: null, version: 0 }, fresh: true }), /project\.edit/);
  const fr = await A.model.saveRead({ sheetId: imp.id, rev: 2, page: 1, readerVersion: 7, data, expected: { id: null, version: 0 }, fresh: true });
  ok("first framing read is version 1", fr.version === 1);
  await expectErr("a stale framing save is refused", () => A.model.saveRead({ sheetId: imp.id, rev: 2, page: 1, data, expected: { id: null, version: 0 } }), /changed|meanwhile|reload/i);
  await expectErr("duplicate piece ids refused", () => A.model.saveRead({ sheetId: imp.id, rev: 2, page: 1, data: { ...data, pcs: [data.pcs[0], data.pcs[0]] }, expected: { id: fr.id, version: 1 } }), /listed twice/);
  const fr2 = await A.model.saveRead({ sheetId: imp.id, rev: 2, page: 1, data: { ...data, pcs: [{ ...data.pcs[0], st: "ok" as const }] }, expected: { id: fr.id, version: 1 }, summary: "accepted 1 piece" });
  const mj = await V.model.job({ projectId: pid });
  ok("framing review saved as version 2 and readable by viewers", fr2.version === 2 && mj.reads.length === 1 && mj.reads[0].data.pcs[0].st === "ok" && !mj.canEdit);
  await A.model.saveSettings({ projectId: pid, data: { allow: 10, base: 100, jw: [{ mark: "J1", lb: 250 }] }, expectedVersion: 0 });
  await expectErr("stale settings save refused", () => A.model.saveSettings({ projectId: pid, data: { allow: 5, base: null, jw: [] }, expectedVersion: 0 }), /meanwhile/);
  await A.drawings.removeSheet({ id: imp.id });
  const left = await V.model.job({ projectId: pid });
  const mk2 = await d.select().from(drawingRevisions).where(eq(drawingRevisions.sheetId, imp.id));
  ok("deleting a sheet removes its markups' sheet rows, scales and framing reads", left.reads.length === 0 && mk2.length === 0);

  /* -------- history, set delete, sequence delete, job delete -------- */
  const h = await A.drawings.history({ kind: "drawingSheet", id: s1.id });
  ok("sheet history recorded", h.length >= 10 && h.some(e => /issued E-101 Rev 1/.test(e.summary)), h.length);
  await A.drawings.removeSet({ id: set1.id });
  reg = await A.drawings.register({ projectId: pid });
  ok("deleting a set keeps its sheets, unassigned, and drops its issues", get(s1.id).setId === null && reg.issues.every(i => i.setId !== set1.id));
  const seqTask = seqs[0].id;
  await A.tasks.delete({ id: seqTask });
  const [after] = await d.select().from(drawingSheets).where(eq(drawingSheets.id, s1.id));
  ok("deleting a sequence unlinks its sheets", after.sequenceTaskId === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
