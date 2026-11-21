import { WEATHER_DELAY, type WeatherDelay } from "@shared/weather";
import { ErrorState, Loading, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { fmtDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";

/** Weather-delay register: days the PM marked lost to weather, with stored NWS conditions, against the contract allowance. */
export function WeatherDays({ projectId, onOpen }: { projectId: number; onOpen: (reportId: number) => void }) {
  const q = trpc.weather.register.useQuery({ projectId });
  const c = q.data?.counts;
  const lost = (q.data?.rows ?? []).filter(r => r.weatherDelay === "full" || r.weatherDelay === "partial");
  return (
    <Panel
      title="Weather days"
      className="mt-4"
      actions={
        c && (
          <span className="num text-xs text-muted-foreground">
            {c.full} full · {c.partial} partial
            {q.data!.allowed != null ? ` · ${q.data!.allowed} allowed` : " · allowance not entered on the job"}
            {c.unrecorded ? ` · ${c.unrecorded} report${c.unrecorded === 1 ? "" : "s"} with no weather call` : ""}
          </span>
        )
      }
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !lost.length ? (
        <p className="p-3 text-sm text-muted-foreground">No days marked lost to weather. Mark them on each daily report under Weather delay.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Delay</th>
                <th>Conditions (NWS)</th>
                <th>Over limits</th>
                <th>Report weather</th>
              </tr>
            </thead>
            <tbody>
              {lost.map(r => (
                <tr key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
                  <td className="num">{fmtDate(r.reportDate)}</td>
                  <td>
                    <Pill tone={r.weatherDelay === "full" ? "red" : "amber"}>{WEATHER_DELAY[r.weatherDelay as WeatherDelay]}</Pill>
                  </td>
                  <td className="num text-xs">
                    {r.summary
                      ? `${r.summary.conditions ?? "—"} · ${r.summary.lowF ?? "?"}–${r.summary.highF ?? "?"} °F · gusts ${r.summary.maxGustMph ?? "?"} mph · precip ${r.summary.precipIn == null ? "?" : r.summary.precipIn.toFixed(2)} in`
                      : "Not stored"}
                  </td>
                  <td className="text-xs">{r.flags.join("; ") || (r.summary ? "None" : "—")}</td>
                  <td className="text-xs">{r.weather || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
