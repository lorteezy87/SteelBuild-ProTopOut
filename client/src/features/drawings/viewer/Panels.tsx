/** The viewer's side panel tabs: sheets, links, markups and "Search all". */
import { normSheet } from "@shared/drawings";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";
import type { Sheet } from "../model";
import type { Link } from "./callouts";
import { KIND_NAMES, type Mark } from "./marks";
import { viewRev } from "./revs";
import { SEARCH_RESULT_CAP, type SearchHit } from "./search";

export function Row({ on, onClick, a, b, disabled }: { on?: boolean; onClick: () => void; a: ReactNode; b?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={on ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-0.5 border-l-[3px] px-3 py-1.5 text-left",
        on ? "border-[var(--ks-accent)] bg-[var(--ks-accent-soft)]" : "border-transparent hover:bg-[var(--ks-gray-soft)]",
        disabled && "cursor-default opacity-50 hover:bg-transparent"
      )}
    >
      <span className="num text-[12px] font-semibold leading-tight text-[var(--ks-ink)]">{a}</span>
      {b != null && <span className="text-[12px] leading-snug text-[var(--ks-ink-2)]">{b}</span>}
    </button>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="px-3 py-3 text-[12px] leading-relaxed text-[var(--ks-ink-2)]">{children}</p>;

export function SheetsPanel({ sheets, currentId, onOpen }: { sheets: Sheet[]; currentId: number; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState("");
  const fl = filter.trim().toLowerCase(),
    fln = normSheet(fl);
  const shown = sheets.filter(q => !fl || `${q.sheetNumber} ${q.title}`.toLowerCase().includes(fl) || (!!fln && normSheet(q.sheetNumber).includes(fln)));
  return (
    <>
      <div className="p-2">
        <input
          aria-label="Filter sheets"
          placeholder="Filter sheets"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="h-8 w-full rounded-[3px] border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-2 text-[12px] outline-none focus:border-[var(--ks-accent)]"
        />
      </div>
      {shown.map(q => {
        const vr = viewRev(q);
        return (
          <Row
            key={q.id}
            on={q.id === currentId}
            onClick={() => onOpen(q.id)}
            disabled={!vr}
            a={q.sheetNumber}
            b={`${q.title || ""}${vr ? ` · Rev ${vr.number}${vr.url ? "" : " · preview only"}` : " · no drawing"}`}
          />
        );
      })}
      {!shown.length && <Hint>No sheets match.</Hint>}
    </>
  );
}

export function LinksPanel({
  loading,
  hasText,
  links,
  sheetNumber,
  onFollow,
  onShow,
}: {
  loading: boolean;
  hasText: boolean;
  links: Link<number>[];
  sheetNumber: string;
  onFollow: (l: Link<number>) => void;
  onShow: (l: Link<number>) => void;
}) {
  if (loading) return null;
  if (!hasText)
    return <Hint>Links come from the PDF's text. This sheet has none to read (a preview image or a scan), so its links are unknown, not zero.</Hint>;
  if (!links.length)
    return <Hint>No callouts on this sheet point to sheets in this job's register. Callouts to sheets outside the register aren't linked.</Hint>;
  const groups = [...new Set(links.map(l => l.sid))].map(sid => links.filter(l => l.sid === sid));
  return (
    <>
      {groups.map(ls => (
        <div key={ls[0].sid} className="border-b border-[var(--ks-rule)] py-1">
          <div className="label-caps px-3 pb-0.5 pt-1.5">
            To {ls[0].sheet}
            {ls[0].same ? " (this sheet)" : ""}
          </div>
          {ls.map((l, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-0.5">
              <button
                type="button"
                onClick={() => onFollow(l)}
                className="num flex-1 truncate text-left text-[12px] font-medium text-[var(--ks-ink)] underline underline-offset-[3px] hover:text-[var(--ks-accent-ink)]"
              >
                {l.detail ? `${l.kind === "bubble" ? "Bubble" : "Detail"} ${l.detail} / ${l.sheet}` : l.text}
              </button>
              <button
                type="button"
                aria-label={`Show this callout on ${sheetNumber}`}
                onClick={() => onShow(l)}
                className="text-[11px] text-[var(--ks-ink-2)] hover:text-[var(--ks-ink)]"
              >
                show
              </button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export function MarksPanel({
  marks,
  sel,
  page,
  pages,
  who,
  canMark,
  onPick,
}: {
  marks: Mark[];
  sel: number | null;
  page: number;
  pages: number;
  who: (id: number | null) => string;
  canMark: boolean;
  onPick: (m: Mark) => void;
}) {
  if (!marks.length) return <Hint>No markups yet.{canMark ? " Pick a tool in the toolbar and drag on the sheet." : ""}</Hint>;
  return (
    <>
      {[...marks].reverse().map(m => (
        <Row
          key={m.id}
          on={sel === m.id}
          onClick={() => onPick(m)}
          a={`${m.label ? m.label + " · " : ""}${KIND_NAMES[m.kind] ?? m.kind} · Rev ${m.rev}${pages > 1 || m.page !== page ? ` p${m.page}` : ""}`}
          b={`${m.note || "No note"} — ${who(m.createdBy)}`}
        />
      ))}
    </>
  );
}

export type SearchAll = { q: string; running: boolean; done: number; total: number; res: SearchHit[]; skipped: number; failed: number; ran: boolean };
export const SEARCH_IDLE: SearchAll = { q: "", running: false, done: 0, total: 0, res: [], skipped: 0, failed: 0, ran: false };

export function SearchAllPanel({
  all,
  onQ,
  onRun,
  onStop,
  onOpen,
  at,
}: {
  all: SearchAll;
  onQ: (q: string) => void;
  onRun: () => void;
  onStop: () => void;
  onOpen: (h: SearchHit) => void;
  at: { sheetId: number; page: number };
}) {
  const n = all.res.length;
  return (
    <div className="flex flex-col">
      <form
        role="search"
        onSubmit={e => {
          e.preventDefault();
          onRun();
        }}
        className="flex gap-1.5 p-2"
      >
        <input
          aria-label="Search every sheet in this job"
          placeholder="Text on any sheet"
          value={all.q}
          onChange={e => onQ(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-[3px] border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-2 text-[12px] outline-none focus:border-[var(--ks-accent)]"
        />
        {all.running ? (
          <button type="button" onClick={onStop} className="h-8 rounded-[3px] border border-[var(--ks-rule)] px-2.5 text-[12px] font-medium">
            Stop
          </button>
        ) : (
          <button type="submit" className="h-8 rounded-[3px] bg-[var(--ks-solid)] px-2.5 text-[12px] font-semibold text-white">
            Search
          </button>
        )}
      </form>
      {all.ran && (
        <p role="status" className="px-3 pb-2 text-[12px] leading-snug text-[var(--ks-ink-2)]">
          {all.running ? `Searching ${all.done} of ${all.total} sheets… ` : `Searched ${all.done} of ${all.total} sheets with a PDF. `}
          {n} match{n === 1 ? "" : "es"}
          {n >= SEARCH_RESULT_CAP ? ` (first ${SEARCH_RESULT_CAP})` : ""}.
          {all.skipped
            ? ` ${all.skipped} sheet${all.skipped === 1 ? " has" : "s have"} only a preview image and ${all.skipped === 1 ? "was" : "were"} not searched.`
            : ""}
          {all.failed ? ` ${all.failed} couldn't be opened.` : ""}
        </p>
      )}
      {all.res.map((h, i) => (
        <Row
          key={i}
          on={h.sheetId === at.sheetId && h.page === at.page}
          onClick={() => onOpen(h)}
          a={`${h.sheet}${h.page > 1 ? ` p${h.page}` : ""} · Rev ${h.rev}`}
          b={h.snip}
        />
      ))}
    </div>
  );
}
