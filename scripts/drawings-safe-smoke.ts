/**
 * Safe integration check: creates dedicated temporary jobs/users, never demo data,
 * never edits an existing job, and removes only its own fixtures in finally.
 * Explicit invocation: pnpm exec tsx scripts/drawings-safe-smoke.ts --run
 * A tiny verification PDF is uploaded to exercise durable storage. Record cleanup
 * does not physically delete that object (the runtime has no storage delete API).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  drawingRevisions, drawingSheets,
  projects, tasks, users, roleAssignments, securityRoles, wfApps, wfStates, wfItems,
  type User,
  drawingMarks,
  drawingScales, modelReads,
} from "../drizzle/schema";
import { db } from "../server/db";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { orgToday } from "../server/services/calendars";
import { storageGetSignedUrl } from "../server/storage";

const caller = (user: User) => appRouter.createCaller({
  user, quiet: true,
  req: { headers: {} } as TrpcContext["req"],
  res: { cookie() {}, clearCookie() {} } as unknown as TrpcContext["res"],
});
let passed = 0;
function check(name: string, condition: unknown) {
  assert.ok(condition, name);
  passed++;
  console.log(`PASS ${name}`);
}
async function rejects(name: string, fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, pattern);
  passed++;
  console.log(`PASS ${name}`);
}
function verificationPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((value, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${value}\nendobj\n`;
  });
  const start = Buffer.byteLength(body);
  body += "xref\n0 5\n0000000000 65535 f \n";
  body += offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}

async function main() {
  if (!process.argv.includes("--run")) throw new Error("Pass --run to create dedicated verification fixtures.");
  const d = await db();
  const [admin] = await d.select().from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true))).limit(1);
  if (!admin) throw new Error("An existing active admin is required; this script never creates an admin account.");
  const A = caller(admin);
  const marker = `DRAW-CHECK-${randomUUID().slice(0, 8)}`;
  const jobIds: number[] = [];
  const userIds: number[] = [];
  const fixtureSheetIds: number[] = [];
  const today = await orgToday();
  try {
    for (let i = 0; i < 2; i++) {
      const [{ id }] = await d.insert(projects).values({
        code: `${marker}-${i}`, name: `${marker} TEMPORARY verification job`, state: "draft", startDate: today,
      }).$returningId();
      jobIds.push(id);
    }
    const [pid, otherPid] = jobIds;
    const [{ id: seqId }] = await d.insert(tasks).values({ projectId: pid, kind: "sequence", name: "Verification sequence", wbs: "1", startDate: today }).$returningId();
    const [{ id: foreignSeqId }] = await d.insert(tasks).values({ projectId: otherPid, kind: "sequence", name: "Foreign verification sequence" }).$returningId();
    async function testUser(tier: string, roleKey: string) {
      const [{ id }] = await d.insert(users).values({ openId: `local:${marker}-${tier}-${roleKey}`, name: `TEMP ${marker} ${tier}`, role: "user", accessType: tier, loginMethod: "test" }).$returningId();
      userIds.push(id);
      const [role] = await d.select().from(securityRoles).where(eq(securityRoles.key, roleKey)).limit(1);
      assert.ok(role, `Missing role ${roleKey}`);
      await d.insert(roleAssignments).values({ userId: id, roleId: role.id, scopeType: "project", scopeId: pid });
      const [user] = await d.select().from(users).where(eq(users.id, id));
      return caller(user);
    }
    const S = await testUser("team_member", "superintendent");
    const V = await testUser("team_member", "viewer");
    const L = await testUser("app_only", "project_manager");
    check("register is empty on the isolated job", (await A.drawings.register({ projectId: pid })).sheets.length === 0);
    await rejects("Logs-only cannot read drawings", () => L.drawings.register({ projectId: pid }), /Logs and Timesheets/);
    await rejects("viewer cannot edit drawings", () => V.drawings.saveSheet({ projectId: pid, sheetNumber: "E-101", title: "Test" }), /document\.upload/);
    await rejects("superintendent cannot create sets", () => S.drawings.saveSet({ projectId: pid, number: "E-SET-1", name: "Test", kind: "erection" }), /project\.edit/);
    const set = await A.drawings.saveSet({ projectId: pid, number: "E-SET-1", name: "Verification set", kind: "erection" });
    await rejects("duplicate set numbers are rejected", () => A.drawings.saveSet({ projectId: pid, number: "e-set-1", name: "Test", kind: "erection" }), /already exists/);
    const pdf = verificationPdf();
    const sheet = await S.drawings.saveSheet({ projectId: pid, setId: set.id, sheetNumber: "E-101", title: "Verification drawing", sequenceTaskId: seqId, file: { fileName: `${marker}.pdf`, mimeType: "application/pdf", base64: pdf.toString("base64") } });
    fixtureSheetIds.push(sheet.id);
    const second = await A.drawings.saveSheet({ projectId: pid, setId: set.id, sheetNumber: "E-102", title: "Unreleased verification sheet" });
    fixtureSheetIds.push(second.id);
    await rejects("duplicate normalized sheet numbers are rejected", () => A.drawings.saveSheet({ projectId: pid, sheetNumber: "e–101", title: "Duplicate" }), /already exists|Reads as/);
    await rejects("cross-job sequence links are rejected", () => A.drawings.saveSheet({ projectId: pid, sheetNumber: "E-103", title: "Bad link", sequenceTaskId: foreignSeqId }), /sequence on this job/);
    let reg = await A.drawings.register({ projectId: pid });
    const current = () => reg.sheets.find(x => x.id === sheet.id)!;
    const r0 = current().revs[0];
    check("sheet starts with a draft revision", current().status === "DET" && r0.state === "draft");
    // Files live in durable project storage (fileKey); the browser gets the same-origin, access-checked stream URL.
    check("drawing uses durable storage behind the access-checked file URL", !!r0.fileKey && r0.url === `/api/drawings/rev/${r0.id}/pdf`);
    const signed = await storageGetSignedUrl(r0.fileKey!);
    const download = await fetch(signed);
    check("uploaded PDF downloads byte-for-byte", download.ok && Buffer.from(await download.arrayBuffer()).equals(pdf));
    await rejects("draft cannot be issued before sign-off", () => A.drawings.issueRevision({ revisionId: r0.id }), /Sign off/);
    await S.drawings.signOff({ revisionId: r0.id });
    await S.drawings.issueRevision({ revisionId: r0.id });
    reg = await A.drawings.register({ projectId: pid });
    check("issuing submits the drawing for review", current().status === "REV" && current().currentRev === 0 && current().sentDate === today);
    await rejects("issued drawing file cannot be replaced", () => A.drawings.attachFile({ revisionId: r0.id, file: { fileName: "replacement.pdf", mimeType: "application/pdf", base64: pdf.toString("base64") } }), /start a new revision/);
    await A.drawings.action({ id: sheet.id, action: "approve", expectedRevisionId: current().revs.find(r => r.state === "issued")!.id });
    reg = await A.drawings.register({ projectId: pid });
    check("recorded review approval releases the sheet", current().status === "REL");
    const issue = await A.drawings.recordIssue({ setId: set.id, purpose: "For erection", issueDate: today });
    check("erection issue includes only released sheets", issue.recorded === 1 && issue.skipped.some(x => x.sheet === "E-102"));
    await rejects("issued sheet cannot be deleted by uploader only", () => S.drawings.removeSheet({ id: sheet.id }), /only an editor/);
    const [rfiApp] = await d.select().from(wfApps).where(eq(wfApps.key, "rfi"));
    const [start] = await d.select().from(wfStates).where(and(eq(wfStates.appId, rfiApp.id), eq(wfStates.category, "start"))).limit(1);
    const [{ id: rfiId }] = await d.insert(wfItems).values({ appId: rfiApp.id, projectId: pid, number: 1, title: "TEMP drawing hold", stateId: start.id }).$returningId();
    await A.drawings.action({ id: sheet.id, action: "hold", holdRfiId: rfiId, holdReason: "Verification only" });
    await rejects("open RFI blocks hold release", () => A.drawings.action({ id: sheet.id, action: "release" }), /close the RFI/);
    await rejects("holding RFI cannot be deleted", () => A.wf.remove({ id: rfiId }), /hold|drawing/i);
    await d.update(drawingSheets).set({ holdRfiId: 99999999 }).where(eq(drawingSheets.id, sheet.id));
    await rejects("missing holding RFI fails closed", () => A.drawings.action({ id: sheet.id, action: "release" }), /missing|not found|resolve|unavailable/i);
    await d.update(drawingSheets).set({ holdRfiId: rfiId }).where(eq(drawingSheets.id, sheet.id));
    await A.drawings.startRevision({ sheetId: sheet.id });
    reg = await A.drawings.register({ projectId: pid });
    const r1 = current().revs.find(r => r.number === 1)!;
    await A.drawings.signOff({ revisionId: r1.id });
    await A.drawings.issueRevision({ revisionId: r1.id });
    reg = await A.drawings.register({ projectId: pid });
    check("new revision supersedes old while maintaining hold", current().status === "HOLD" && current().holdFrom === "REV" && current().revs.find(r => r.id === r0.id)?.state === "superseded");
    await d.update(wfItems).set({ closedAt: new Date() }).where(eq(wfItems.id, rfiId));
    await A.drawings.action({ id: sheet.id, action: "release" });
    reg = await A.drawings.register({ projectId: pid });
    check("closing own RFI releases hold back to review", current().status === "REV" && current().holdRfiId === null);
    await rejects("stale approval cannot release a newer revision", () => A.drawings.action({ id: sheet.id, action: "approve", expectedRevisionId: r0.id }), /revision|review|changed/i);
    await rejects("approval without an observed revision fails closed", () => A.drawings.action({ id: sheet.id, action: "approve" }), /revision|review|reload/i);
    await A.drawings.action({ id: sheet.id, action: "approve", expectedRevisionId: current().revs.find(r => r.state === "issued")!.id });
    await A.drawings.startRevision({ sheetId: sheet.id });
    reg = await A.drawings.register({ projectId: pid });
    const r2 = current().revs.find(r => r.number === 2)!;
    await A.drawings.signOff({ revisionId: r2.id });
    const race = await Promise.allSettled([A.drawings.issueRevision({ revisionId: r2.id }), A.drawings.issueRevision({ revisionId: r2.id })]);
    check("concurrent double issue has one winner", race.filter(r => r.status === "fulfilled").length === 1);
    const issued = await d.select().from(drawingRevisions).where(and(eq(drawingRevisions.sheetId, sheet.id), eq(drawingRevisions.state, "issued")));
    check("exactly one revision remains current", issued.length === 1 && issued[0].id === r2.id);
    check("history records revision events", (await A.drawings.history({ kind: "drawingSheet", id: sheet.id })).length >= 8);
    // Discarded drafts take their markups with them, and bulk actions act only on the revision the user saw.
    await A.drawings.startRevision({ sheetId: sheet.id });
    reg = await A.drawings.register({ projectId: pid });
    const r3 = current().revs.find(r => r.number === 3)!;
    await A.drawings.saveMark({ sheetId: sheet.id, rev: 3, page: 1, kind: "note", points: [[0.5, 0.5]], note: "Verification markup" });
    check("markup saved on the draft", (await A.drawings.marks({ sheetId: sheet.id })).marks.some(m => m.rev === 3));
    await A.drawings.discardDraft({ revisionId: r3.id });
    check("discarding a draft removes its markups", (await d.select().from(drawingMarks).where(and(eq(drawingMarks.sheetId, sheet.id), eq(drawingMarks.rev, 3)))).length === 0);
    await rejects("markups cannot be saved on a discarded revision", () => A.drawings.saveMark({ sheetId: sheet.id, rev: 3, page: 1, kind: "note", points: [[0.5, 0.5]] }), /no Rev 3/);
    await A.drawings.startRevision({ sheetId: sheet.id });
    reg = await A.drawings.register({ projectId: pid });
    const r3b = current().revs.find(r => r.number === 3 && r.state === "draft")!;
    check("replacement draft reuses the number without old markups", r3b.id !== r3.id && !(await A.drawings.marks({ sheetId: sheet.id })).marks.some(m => m.rev === 3));
    const staleBulk = await A.drawings.bulk({ projectId: pid, items: [{ sheetId: sheet.id, revisionId: r3.id }], step: "signoff" });
    reg = await A.drawings.register({ projectId: pid });
    check("bulk sign-off of a discarded revision is refused and the replacement stays a draft", staleBulk.done === 0 && staleBulk.skipped.length === 1 && current().revs.find(r => r.id === r3b.id)?.state === "draft");
    const goodBulk = await A.drawings.bulk({ projectId: pid, items: [{ sheetId: sheet.id, revisionId: r3b.id }], step: "signoff" });
    check("bulk sign-off of the observed revision succeeds", goodBulk.done === 1 && goodBulk.skipped.length === 0);

    // Bulk edit/review/delete operate exclusively on this run's temporary fixtures.
    const bulk1 = await S.drawings.saveSheet({ projectId: pid, setId: set.id, sequenceTaskId: seqId, sheetNumber: "B-101", title: "TEMP bulk review one" });
    const bulk2 = await S.drawings.saveSheet({ projectId: pid, setId: set.id, sheetNumber: "B-102", title: "TEMP bulk review two" });
    const bulk3 = await S.drawings.saveSheet({ projectId: pid, sheetNumber: "B-103", title: "TEMP bulk submit" });
    const foreign = await A.drawings.saveSheet({ projectId: otherPid, sheetNumber: "B-FOREIGN", title: "TEMP other-job bulk guard" });
    fixtureSheetIds.push(bulk1.id, bulk2.id, bulk3.id, foreign.id);
    const foreignSet = await A.drawings.saveSet({ projectId: otherPid, number: "FOREIGN", name: "TEMP foreign set", kind: "erection" });
    const ids = [bulk1.id, bulk2.id, bulk3.id];
    await rejects("viewer cannot bulk edit", () => V.drawings.bulkEdit({ projectId: pid, sheetIds: ids, patch: { ballInCourt: "GC" } }), /document\.upload/);
    await rejects("viewer cannot bulk review", () => V.drawings.bulkAction({ projectId: pid, action: "hold", items: ids.map(sheetId => ({ sheetId })) }), /document\.upload/);
    await rejects("viewer cannot bulk delete", () => V.drawings.bulkRemove({ projectId: pid, sheetIds: ids, confirm: "DELETE" }), /document\.upload/);
    await rejects("Logs-only cannot bulk edit", () => L.drawings.bulkEdit({ projectId: pid, sheetIds: ids, patch: { ballInCourt: "GC" } }), /Logs and Timesheets/);
    await rejects("bulk edit rejects a foreign-job sheet before any write", () => A.drawings.bulkEdit({ projectId: pid, sheetIds: [bulk1.id, foreign.id], patch: { ballInCourt: "Architect" } }), /Sheet on this job/);
    await rejects("bulk review rejects foreign-job sheets before any write", () => A.drawings.bulkAction({ projectId: pid, action: "hold", items: [{ sheetId: bulk1.id }, { sheetId: foreign.id }] }), /Sheet on this job/);
    await rejects("bulk delete rejects foreign-job sheets before any write", () => A.drawings.bulkRemove({ projectId: pid, sheetIds: [bulk1.id, foreign.id], confirm: "DELETE" }), /Sheet on this job/);
    await rejects("bulk edit validates set job", () => A.drawings.bulkEdit({ projectId: pid, sheetIds: ids, patch: { setId: foreignSet.id } }), /Drawing set on this job/);
    await rejects("bulk edit validates sequence job", () => A.drawings.bulkEdit({ projectId: pid, sheetIds: ids, patch: { sequenceTaskId: foreignSeqId } }), /sequence on this job/);
    await rejects("bulk edit rejects an empty patch", () => A.drawings.bulkEdit({ projectId: pid, sheetIds: ids, patch: {} }), /at least one field/);
    await rejects("bulk edit rejects duplicate sheet IDs", () => A.drawings.bulkEdit({ projectId: pid, sheetIds: [bulk1.id, bulk1.id], patch: { ballInCourt: "GC" } }), /only once/);
    await rejects("bulk delete requires the exact confirmation", () => A.drawings.bulkRemove({ projectId: pid, sheetIds: ids, confirm: "wrong" as "DELETE" }), /DELETE/);
    const oversized = Array.from({ length: 501 }, (_, i) => i + 1);
    await rejects("bulk edit is capped at 500", () => A.drawings.bulkEdit({ projectId: pid, sheetIds: oversized, patch: { ballInCourt: "GC" } }), /500/);
    await rejects("bulk review is capped at 500", () => A.drawings.bulkAction({ projectId: pid, action: "hold", items: oversized.map(sheetId => ({ sheetId })) }), /500/);
    await rejects("bulk delete is capped at 500", () => A.drawings.bulkRemove({ projectId: pid, sheetIds: oversized, confirm: "DELETE" }), /500/);
    reg = await A.drawings.register({ projectId: pid });
    check("ownership failures leave the valid selected sheet unchanged", reg.sheets.find(s => s.id === bulk1.id)?.ballInCourt === "Detailer" && reg.sheets.find(s => s.id === bulk1.id)?.status === "DET");
    const fieldEdit = await S.drawings.bulkEdit({ projectId: pid, sheetIds: ids, patch: { ballInCourt: "EOR" } });
    reg = await A.drawings.register({ projectId: pid });
    const b1 = reg.sheets.find(s => s.id === bulk1.id)!;
    check("bulk patch changes only provided fields for an uploader", fieldEdit.done === 3 && !fieldEdit.skipped.length && b1.ballInCourt === "EOR" && b1.setId === set.id && b1.sequenceTaskId === seqId && b1.title === "TEMP bulk review one" && b1.status === "DET");
    const links = await S.drawings.bulkEdit({ projectId: pid, sheetIds: [bulk2.id, bulk3.id], patch: { setId: set.id, sequenceTaskId: seqId } });
    check("bulk edit accepts set and erection sequence on this job", links.done === 2);
    const clearLinks = await S.drawings.bulkEdit({ projectId: pid, sheetIds: [bulk2.id, bulk3.id], patch: { setId: null, sequenceTaskId: null } });
    reg = await A.drawings.register({ projectId: pid });
    check("explicit null clears links without changing other fields", clearLinks.done === 2 && reg.sheets.filter(s => [bulk2.id, bulk3.id].includes(s.id)).every(s => s.setId === null && s.sequenceTaskId === null && s.ballInCourt === "EOR"));
    const dateEdit = await S.drawings.bulkEdit({ projectId: pid, sheetIds: [sheet.id, bulk1.id], patch: { sentDate: null } });
    check("bulk edit skips incompatible review dates per sheet", dateEdit.done === 1 && dateEdit.skipped[0]?.sheetId === sheet.id && /sent date/.test(dateEdit.skipped[0].why));
    const futureDates = await S.drawings.bulkEdit({ projectId: pid, sheetIds: ids, patch: { sentDate: "9999-01-01" } });
    check("bulk edit rejects future dates without changing sheets", futureDates.done === 0 && futureDates.skipped.length === 3);
    reg = await A.drawings.register({ projectId: pid });
    const revisionItems = reg.sheets.filter(s => ids.includes(s.id)).map(s => ({ sheetId: s.id, revisionId: s.revs[0].id }));
    await A.drawings.bulk({ projectId: pid, items: revisionItems, step: "signoff" });
    await A.drawings.bulk({ projectId: pid, items: revisionItems, step: "issue" });
    reg = await A.drawings.register({ projectId: pid });
    const observed = ids.map(sheetId => ({ sheetId, expectedRevisionId: reg.sheets.find(s => s.id === sheetId)!.revs.find(r => r.state === "issued")!.id }));
    const staleReview = await S.drawings.bulkAction({ projectId: pid, action: "approve", items: [{ sheetId: bulk1.id, expectedRevisionId: r0.id }, { sheetId: bulk2.id }] });
    check("bulk review skips stale and missing observed revision IDs", staleReview.done === 0 && staleReview.skipped.length === 2 && staleReview.skipped.every(s => /revision.*changed/.test(s.why)));
    const approved = await S.drawings.bulkAction({ projectId: pid, action: "approve", items: [observed[0]] });
    const revised = await S.drawings.bulkAction({ projectId: pid, action: "revise", items: [observed[1]] });
    const mixedReview = await S.drawings.bulkAction({ projectId: pid, action: "approve", items: [observed[0], observed[2]] });
    check("bulk approve and revise use the single-sheet rules and skip unavailable actions", approved.done === 1 && revised.done === 1 && mixedReview.done === 1 && mixedReview.skipped[0]?.sheetId === bulk1.id && /not available/.test(mixedReview.skipped[0].why));
    await d.update(drawingSheets).set({ status: "DET", sentDate: null, returnedDate: null }).where(eq(drawingSheets.id, bulk3.id));
    const submitted = await S.drawings.bulkAction({ projectId: pid, action: "submit", items: [{ sheetId: bulk3.id }, { sheetId: second.id }] });
    check("bulk submit succeeds for issued sheets and explains pending drafts", submitted.done === 1 && submitted.skipped[0]?.sheetId === second.id && /Sign off and issue/.test(submitted.skipped[0].why));
    const [{ id: bulkRfi }] = await d.insert(wfItems).values({ appId: rfiApp.id, projectId: pid, number: 2, title: "TEMP bulk hold", stateId: start.id }).$returningId();
    const [{ id: foreignRfi }] = await d.insert(wfItems).values({ appId: rfiApp.id, projectId: otherPid, number: 1, title: "TEMP foreign bulk hold", stateId: start.id }).$returningId();
    const badRfi = await S.drawings.bulkAction({ projectId: pid, action: "hold", items: ids.map(sheetId => ({ sheetId })), holdRfiId: foreignRfi });
    check("bulk hold refuses a foreign-job RFI per sheet", badRfi.done === 0 && badRfi.skipped.length === 3);
    const holdBulk = await S.drawings.bulkAction({ projectId: pid, action: "hold", items: ids.map(sheetId => ({ sheetId })), holdRfiId: bulkRfi, holdReason: "TEMP shared reason" });
    reg = await A.drawings.register({ projectId: pid });
    check("bulk holds record the same RFI and reason on every sheet", holdBulk.done === 3 && reg.sheets.filter(s => ids.includes(s.id)).every(s => s.status === "HOLD" && s.holdRfiId === bulkRfi && s.holdReason === "TEMP shared reason"));
    const heldRelease = await S.drawings.bulkAction({ projectId: pid, action: "release", items: ids.map(sheetId => ({ sheetId })) });
    check("bulk release skips sheets held by an open RFI", heldRelease.done === 0 && heldRelease.skipped.length === 3 && heldRelease.skipped.every(s => /close the RFI/.test(s.why)));
    await d.update(drawingSheets).set({ holdRfiId: 99999999 }).where(eq(drawingSheets.id, bulk1.id));
    const missingRelease = await S.drawings.bulkAction({ projectId: pid, action: "release", items: [{ sheetId: bulk1.id }] });
    check("bulk release fails closed when its holding RFI is missing", missingRelease.done === 0 && /missing/.test(missingRelease.skipped[0]?.why));
    await d.update(drawingSheets).set({ holdRfiId: bulkRfi }).where(eq(drawingSheets.id, bulk1.id));
    await d.update(wfItems).set({ closedAt: new Date() }).where(eq(wfItems.id, bulkRfi));
    const releasedBulk = await S.drawings.bulkAction({ projectId: pid, action: "release", items: ids.map(sheetId => ({ sheetId })) });
    reg = await A.drawings.register({ projectId: pid });
    check("bulk release restores each sheet's prior status", releasedBulk.done === 3 && reg.sheets.find(s => s.id === bulk1.id)?.status === "REL" && reg.sheets.find(s => s.id === bulk2.id)?.status === "RR" && reg.sheets.find(s => s.id === bulk3.id)?.status === "REV");
    check("bulk actions emit the same per-sheet activity summaries", (await A.drawings.history({ kind: "drawingSheet", id: bulk1.id })).some(h => h.action === "hold" && h.summary.includes("TEMP shared reason")));
    const bulkIssue = await A.drawings.recordIssue({ setId: set.id, purpose: "For erection", issueDate: today });
    check("a temporary bulk-approved sheet can be recorded on a set issue", bulkIssue.recorded === 1);
    await A.drawings.saveMark({ sheetId: bulk2.id, rev: 0, page: 1, kind: "note", points: [[0.5, 0.5]], note: "TEMP delete verification" });
    await A.drawings.setScale({ sheetId: bulk2.id, rev: 0, page: 1, feetPerWidth: 200 });
    await d.insert(modelReads).values({ projectId: pid, sheetId: bulk2.id, rev: 0, page: 1, data: { verification: marker } });
    const removeBulk = await S.drawings.bulkRemove({ projectId: pid, sheetIds: [sheet.id, bulk2.id], confirm: "DELETE" });
    check("bulk delete allows unissued-in-set sheets but skips editor-only issue evidence", removeBulk.done === 1 && removeBulk.skipped[0]?.sheetId === sheet.id && /only an editor/.test(removeBulk.skipped[0].why));
    check("bulk delete removes revisions, marks, scales and model reads", (await d.select().from(drawingRevisions).where(eq(drawingRevisions.sheetId, bulk2.id))).length === 0 && (await d.select().from(drawingMarks).where(eq(drawingMarks.sheetId, bulk2.id))).length === 0 && (await d.select().from(drawingScales).where(eq(drawingScales.sheetId, bulk2.id))).length === 0 && (await d.select().from(modelReads).where(eq(modelReads.sheetId, bulk2.id))).length === 0);
    const adminDelete = await A.drawings.bulkRemove({ projectId: pid, sheetIds: [bulk1.id, bulk3.id], confirm: "DELETE" });
    check("bulk delete removes remaining selected fixtures", adminDelete.done === 2 && !(await A.drawings.register({ projectId: pid })).sheets.some(s => ids.includes(s.id)));
    check("editor bulk delete retains historical set issue evidence", (await A.drawings.register({ projectId: pid })).issues.some(i => (i.sheets ?? []).some(s => s.sheetId === bulk1.id)));
    await A.tasks.delete({ id: seqId });
    reg = await A.drawings.register({ projectId: pid });
    check("deleting own sequence unlinks its drawings", current().sequenceTaskId === null);
    await A.drawings.removeSet({ id: set.id });
    reg = await A.drawings.register({ projectId: pid });
    check("deleting own set preserves sheets but removes issues", current().setId === null && reg.issues.length === 0 && reg.sheets.some(x => x.id === second.id));
    console.log(`SUMMARY ${passed} checks passed`);
  } finally {
    for (const id of jobIds) {
      const [project] = await d.select().from(projects).where(eq(projects.id, id));
      if (!project) continue;
      assert.ok(project.code?.startsWith(marker), "Cleanup refused: job is not this run's fixture");
      await A.projects.delete({ id, confirm: project.code! });
    }
    if (userIds.length) {
      await d.delete(roleAssignments).where(inArray(roleAssignments.userId, userIds));
      await d.delete(users).where(inArray(users.id, userIds));
    }
    if (jobIds.length) {
      const remaining = await d.select().from(drawingSheets).where(inArray(drawingSheets.projectId, jobIds));
      assert.equal(remaining.length, 0, "Temporary drawing fixtures remain");
      assert.equal((await d.select().from(projects).where(inArray(projects.id, jobIds))).length, 0, "Temporary jobs remain");
      assert.equal((await d.select().from(tasks).where(inArray(tasks.projectId, jobIds))).length, 0, "Temporary tasks remain");
      assert.equal((await d.select().from(wfItems).where(inArray(wfItems.projectId, jobIds))).length, 0, "Temporary RFIs remain");
      assert.equal((await d.select().from(modelReads).where(inArray(modelReads.projectId, jobIds))).length, 0, "Temporary model reads remain");
    }
    if (fixtureSheetIds.length) {
      assert.equal((await d.select().from(drawingRevisions).where(inArray(drawingRevisions.sheetId, fixtureSheetIds))).length, 0, "Temporary revisions remain");
      assert.equal((await d.select().from(drawingMarks).where(inArray(drawingMarks.sheetId, fixtureSheetIds))).length, 0, "Temporary marks remain");
      assert.equal((await d.select().from(drawingScales).where(inArray(drawingScales.sheetId, fixtureSheetIds))).length, 0, "Temporary scales remain");
    }
    if (userIds.length) {
      assert.equal((await d.select().from(users).where(inArray(users.id, userIds))).length, 0, "Temporary users remain");
      assert.equal((await d.select().from(roleAssignments).where(inArray(roleAssignments.userId, userIds))).length, 0, "Temporary assignments remain");
    }
    console.log(`CLEANUP ${marker}: dedicated jobs ${jobIds.join(", ")}, users ${userIds.join(", ")} and all drawing/RFI/sequence fixtures confirmed gone; existing jobs were not edited`);
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
