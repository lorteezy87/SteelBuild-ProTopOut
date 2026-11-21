import { precipLabel } from "@shared/weather";
import { Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";

/** Delay notice: NWS conditions on the event date and the job's weather-delay calls that day — backup for the claim. */
export function DelayWeather({ projectId, eventDate }: { projectId: number; eventDate: string | null }) {
  const valid = !!eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate);
  const w = trpc.weather.day.useQuery({ projectId, date: eventDate ?? "" }, { enabled: valid, retry: false, staleTime: 10 * 60_000 });
  const reg = trpc.weather.register.useQuery({ projectId }, { enabled: valid });
  const reports = (reg.data?.rows ?? []).filter(r => r.reportDate === eventDate);
  const s = w.data?.summary;
  return (
    <Panel title="Weather on the event date" bodyClassName="space-y-2 p-3 text-sm">
      {!valid ? (
        <p className="text-xs text-muted-foreground">Enter the event date to show that day's weather.</p>
      ) : w.isLoading ? (
        <p className="text-xs text-muted-foreground">Looking up weather…</p>
      ) : !s ? (
        <p className="text-xs text-muted-foreground">{w.error || w.fetchStatus === "paused" ? "Weather lookup needs a connection." : (w.data?.reason ?? "No weather for this day.")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{fmtDate(eventDate!)} · {s.conditions ?? "Conditions not reported"}</span>
            <Pill tone="gray">{s.source === "forecast" ? "Forecast" : "Observed (NWS)"}</Pill>
            {w.data!.flags.map(f => (
              <Pill key={f} tone="amber">{f}</Pill>
            ))}
          </div>
          <div className="num text-xs text-muted-foreground">
            {s.lowF ?? "?"}–{s.highF ?? "?"} °F · wind {s.maxWindMph ?? "?"} mph · gusts {s.maxGustMph ?? "?"} mph · precip {precipLabel(s)}
          </div>
        </>
      )}
      {valid && (
        <p className="text-xs">
          Daily report:{" "}
          {!reg.data
            ? reg.error || reg.fetchStatus === "paused"
              ? "couldn't be checked (needs a connection)"
              : "checking…"
            : !reports.length
              ? "none for this date"
              : reports.map(r => (r.weatherDelay === "full" ? "full day lost to weather" : r.weatherDelay === "partial" ? "partial day lost to weather" : r.weatherDelay === "none" ? "no weather delay" : "weather delay not recorded")).join("; ")}
        </p>
      )}
    </Panel>
  );
}
