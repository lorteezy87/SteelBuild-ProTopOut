/** Day-by-day bars for a 3-week look-ahead (shared by the look-ahead and the weekly GC report). */
type LA = { weeks: { start: string; end: string }[]; rows: { id: number; name: string; kind: string; startDate: string; finishDate: string; status: string; percentComplete: number; days: boolean[] }[]; undated: number };

const DOW = ["M", "T", "W", "T", "F", "S", "S"];
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

export function LookaheadGrid({ la }: { la: LA }) {
  if (!la.rows.length)
    return <p className="italic text-neutral-600">No dated tasks in these three weeks.{la.undated ? ` ${la.undated} task(s) have no dates.` : ""}</p>;
  return (
    <>
      <table className="text-[10px]">
        <thead>
          <tr>
            <th rowSpan={2} className="w-56">Activity</th>
            <th rowSpan={2} className="w-20">Start–finish</th>
            {la.weeks.map(w => (
              <th key={w.start} colSpan={7} className="text-center">
                Week of {md(w.start)}
              </th>
            ))}
          </tr>
          <tr>
            {la.weeks.flatMap(w => DOW.map((d, i) => <th key={w.start + i} className="!px-0 text-center">{d}</th>))}
          </tr>
        </thead>
        <tbody>
          {la.rows.map(r => (
            <tr key={r.id} className="avoid-break">
              <td className={r.kind === "sequence" ? "font-bold" : ""}>{r.name}</td>
              <td className="whitespace-nowrap">{md(r.startDate)}–{md(r.finishDate)}</td>
              {r.days.map((on, i) => (
                <td key={i} className="!p-0" style={{ background: on ? (r.kind === "sequence" ? "#333" : "#9a9a9a") : i % 7 >= 5 ? "#f5f5f5" : undefined }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {la.undated > 0 && <p className="mt-1 text-[10px] text-neutral-600">{la.undated} task(s) without start and finish dates are not shown.</p>}
    </>
  );
}
