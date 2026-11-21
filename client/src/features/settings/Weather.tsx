import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_WEATHER_THRESHOLDS, type WeatherThresholds } from "@shared/weather";
import { ErrorState, Field, Loading, Panel } from "@/components/brand/Layout";
import { NumberInput } from "@/components/brand/Controls";
import { Button } from "@/components/ui/button";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";

const FIELDS: { key: keyof WeatherThresholds; label: string; step: number }[] = [
  { key: "gustMph", label: "Wind gusts at or above (mph)", step: 1 },
  { key: "windMph", label: "Sustained wind at or above (mph)", step: 1 },
  { key: "precipIn", label: "Precipitation at or above (in)", step: 0.01 },
  { key: "lowF", label: "Low at or below (°F)", step: 1 },
  { key: "highF", label: "High at or above (°F)", step: 1 },
];

/** Settings → Weather: the limits that flag a day on daily reports, delay notices and Today. Flags only — the PM marks lost days. */
export default function Weather() {
  const q = trpc.weather.thresholds.useQuery();
  const utils = trpc.useUtils();
  const [t, setT] = useState<WeatherThresholds | null>(null);
  useEffect(() => {
    if (q.data && !t) setT(q.data);
  }, [q.data, t]);
  const save = trpc.weather.setThresholds.useMutation({
    onSuccess: async () => {
      await utils.weather.invalidate();
      toast.success("Weather limits saved");
    },
    onError: e => toast.error(errMsg(e)),
  });
  if (q.isLoading || !t) return q.error ? <ErrorState error={q.error} /> : <Loading />;
  return (
    <Panel title="Weather limits" bodyClassName="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        A day at or past any limit is flagged on the daily report, the delay notice and Today. Use your crane's wind limit and your contract's weather terms. Flags never mark a weather day — you do, on each daily report.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(f => (
          <Field key={f.key} label={f.label}>
            <NumberInput step={f.step} value={t[f.key]} onChange={v => setT({ ...t, [f.key]: v ?? DEFAULT_WEATHER_THRESHOLDS[f.key] })} />
          </Field>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(t)}>
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={() => setT(DEFAULT_WEATHER_THRESHOLDS)}>
          Reset to defaults
        </Button>
      </div>
    </Panel>
  );
}
