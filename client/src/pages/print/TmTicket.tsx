import { TM_LINE_KINDS, TM_KIND_KEYS, lineAmount } from "@shared/tm";
import { ErrorState, Loading } from "@/components/brand/Layout";
import { fmtDate, fmtMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { PrintShell } from "./PrintShell";

const money = (n: number) => fmtMoney(n, { cents: true });

/** Printable T&M ticket: work, lines by kind, markup, total and the GC's on-screen signature. */
export default function TmTicket({ params }: { params: { ticketId: string } }) {
  const q = trpc.tm.get.useQuery({ id: Number(params.ticketId) });
  if (q.isLoading) return <Loading label="Loading ticket…" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Ticket not found")} />;
  const { ticket: t, lines, totals, co } = q.data;
  return (
    <PrintShell title={`T&M ticket ${t.label}`} subtitle={`Work date ${fmtDate(t.ticketDate)}`} projectId={t.projectId}>
      {t.status === "void" && <div className="mb-3 border-2 border-red-700 p-2 font-bold text-red-800">VOID — {t.voidReason}</div>}
      {t.status === "draft" && <div className="mb-3 border border-neutral-400 p-2 font-semibold">DRAFT — not signed</div>}
      <table className="mb-3">
        <tbody>
          <tr><th className="w-40">Change order</th><td>{co?.label ?? "Not linked"}</td></tr>
          <tr><th>Work performed</th><td className="whitespace-pre-wrap">{t.description || "—"}</td></tr>
        </tbody>
      </table>
      {TM_KIND_KEYS.map(k => {
        const ls = lines.filter(l => l.kind === k);
        if (!ls.length) return null;
        return (
          <div key={k} className="avoid-break">
            <h2>{TM_LINE_KINDS[k]}</h2>
            <table>
              <thead>
                <tr><th>Description</th><th className="right">Qty</th><th>Unit</th><th className="right">Rate</th>{k === "labor" && <><th className="right">OT qty</th><th className="right">OT rate</th></>}<th className="right">Amount</th></tr>
              </thead>
              <tbody>
                {ls.map(l => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="right">{l.qty}</td>
                    <td>{l.unit}</td>
                    <td className="right">{money(l.rate)}</td>
                    {k === "labor" && <><td className="right">{l.otQty ?? "—"}</td><td className="right">{l.otRate == null ? "—" : money(l.otRate)}</td></>}
                    <td className="right">{money(lineAmount(l))}</td>
                  </tr>
                ))}
                <tr><td colSpan={k === "labor" ? 6 : 4} className="right">Subtotal{totals.byKind[k].markup ? ` + ${t.markup[k]} % markup` : ""}</td><td className="right font-semibold">{money(totals.byKind[k].total)}</td></tr>
              </tbody>
            </table>
          </div>
        );
      })}
      <table className="mt-3">
        <tbody><tr><th>Ticket total</th><td className="right text-[14px] font-bold">{money(totals.grandTotal)}</td></tr></tbody>
      </table>
      <h2>Acknowledged by</h2>
      <table className="avoid-break">
        <tbody>
          <tr className="h-20">
            <th className="w-40">Signature</th>
            <td>{t.signatureKey ? <img alt="Signature" src={`/files/${t.signatureKey}`} className="h-16" /> : null}</td>
          </tr>
          <tr><th>Name / title</th><td>{t.signedName ? `${t.signedName}${t.signedTitle ? `, ${t.signedTitle}` : ""}` : ""}</td></tr>
          <tr><th>Date</th><td>{t.signedAt ? new Date(t.signedAt).toLocaleString("en-US") : ""}</td></tr>
        </tbody>
      </table>
      <p className="mt-3 text-[10px] text-neutral-600">Signature acknowledges the labor, equipment and material listed were used on the work described. Pricing per contract and the linked change order.</p>
    </PrintShell>
  );
}
