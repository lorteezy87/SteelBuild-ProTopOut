import { CloudSun } from "lucide-react";
import { precipLabel, WEATHER_DELAY, weatherText, type WeatherDelay } from "@shared/weather";
import { SimpleSelect } from "@/components/brand/Controls";
import { Field, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

/** NWS conditions for the report's day, threshold flags, and the PM's weather-delay call. */
export function WeatherPanel({
  projectId,
  date,
  editable,
  weatherDelay,
  onWeatherDelay,
  onFill,
}: {
  projectId: number;
  date: string;
  editable: boolean;
  weatherDelay: WeatherDelay | null;
  onWeatherDelay: (v: WeatherDelay | null) => void;
  onFill: (t: { weather: string; temperature: string }) => void;
}) {
  const q = trpc.weather.day.useQuery({ projectId, date }, { enabled: /^\d{4}-\d{2}-\d{2}$/.test(date), staleTime: 10 * 60_000, retry: false });
  const s = q.data?.summary;
  const unit = (v: number | null, u: string) => (v == null ? "not reported" : `${v}${u}`);
  return (
    <Panel title="Weather (National Weather Service)" bodyClassName="space-y-3 p-3">
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Looking up weather…</p>
      ) : q.error || (!q.data && q.fetchStatus === "paused") ? (
        <p className="text-xs text-muted-foreground">Weather lookup needs a connection. Enter conditions by hand.</p>
      ) : !s ? (
        <p className="text-xs text-muted-foreground">{q.data?.reason ?? "No weather for this day."}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <CloudSun className="size-4" />
            <span className="font-medium">{s.conditions ?? "Conditions not reported"}</span>
            <Pill tone="gray">{s.source === "forecast" ? "Forecast" : "Observed"}</Pill>
            {q.data!.flags.map(f => (
              <Pill key={f} tone="amber">{f}</Pill>
            ))}
          </div>
          <div className="num text-xs text-muted-foreground">
            High {unit(s.highF, " °F")} · Low {unit(s.lowF, " °F")} · Wind {unit(s.maxWindMph, " mph")} · Gusts {unit(s.maxGustMph, " mph")} ·{" "}
            {s.source === "forecast" ? `Precip chance ${unit(s.precipChancePct, "%")}` : `Precip ${precipLabel(s)}`}
          </div>
          {editable && (
            <Button size="sm" variant="outline" onClick={() => onFill(weatherText(s))}>
              Fill weather and temperature
            </Button>
          )}
        </div>
      )}
      <Field label="Weather delay">
        <div className="w-56">
          <SimpleSelect
            value={weatherDelay}
            allowNone
            noneLabel="Not recorded"
            disabled={!editable}
            options={WEATHER_DELAY}
            onChange={v => onWeatherDelay((v as WeatherDelay | null) ?? null)}
          />
        </div>
      </Field>
    </Panel>
  );
}
