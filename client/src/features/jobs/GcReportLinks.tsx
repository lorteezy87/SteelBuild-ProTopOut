import { useState } from "react";
import { CalendarRange, FileText } from "lucide-react";
import { weekStartOf } from "@shared/lookahead";
import { Panel } from "@/components/brand/Layout";
import { Input } from "@/components/ui/input";
import { useRefData } from "@/lib/ref";

/** Opens the printable 3-week look-ahead and weekly GC report for a chosen week (Monday start). */
export function GcReportLinks({ projectId }: { projectId: number }) {
  const { today } = useRefData();
  const [week, setWeek] = useState(weekStartOf(today));
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStartOf(week) : weekStartOf(today);
  const btn = "inline-flex items-center gap-1.5 rounded-md border border-[var(--tp-rule)] px-3 py-1.5 text-sm hover:bg-[var(--tp-gray-soft)]";
  return (
    <Panel title="Reports for the GC" bodyClassName="flex flex-wrap items-end gap-3 p-3">
      <label className="space-y-1">
        <span className="label-caps block">Week of (Monday)</span>
        <Input type="date" className="w-44" value={week} onChange={e => setWeek(e.target.value)} />
      </label>
      <a className={btn} href={`/print/gc/${projectId}/${monday}`} target="_blank" rel="noreferrer">
        <FileText className="size-4" /> Weekly GC report
      </a>
      <a className={btn} href={`/print/lookahead/${projectId}/${weekStartOf(today)}`} target="_blank" rel="noreferrer">
        <CalendarRange className="size-4" /> 3-week look-ahead
      </a>
      <span className="text-xs text-[var(--tp-muted)]">Opens a print view — use Print / Save PDF.</span>
    </Panel>
  );
}
