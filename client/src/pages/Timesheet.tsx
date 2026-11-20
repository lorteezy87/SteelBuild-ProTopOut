import { ErrorState, Loading, PageHeader } from "@/components/brand/Layout";
import { TimesheetEditor } from "@/features/time/TimesheetEditor";
import { WeekPicker } from "@/features/time/shared";
import { weekStart } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";

export default function Timesheet() {
  const { today, ref } = useRefData();
  const [selectedWeek, setWeek] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = selectedWeek ?? weekStart(today);
  const query = trpc.time.week.useQuery(
    { weekStart: start },
    { enabled: !!ref, refetchOnWindowFocus: false }
  );
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  function changeWeek(value: string) {
    if (value === start || busy) return;
    if (dirty && !window.confirm("Discard unsaved timesheet changes?")) return;
    setDirty(false);
    setWeek(value);
  }
  return (
    <>
      <PageHeader
        eyebrow="Crew hours"
        title="Weekly timesheet"
        subtitle="Monday–Sunday · Saved and rejected time is editable. Approved field-report hours are read-only."
        actions={
          <WeekPicker
            value={start}
            today={today}
            onChange={changeWeek}
            disabled={busy}
          />
        }
      />
      {query.isLoading || !ref ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : query.data ? (
        <TimesheetEditor
          key={`${start}:${query.dataUpdatedAt}`}
          data={query.data}
          start={start}
          onDirty={setDirty}
          onBusy={setBusy}
        />
      ) : null}
    </>
  );
}
