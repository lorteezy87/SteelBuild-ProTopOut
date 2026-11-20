import { useState } from "react";
import { useLocation } from "wouter";
import { Plus, Target } from "lucide-react";
import { SimpleSelect } from "@/components/ks/Controls";
import { CfValue } from "@/components/ks/CustomFields";
import {
  EmptyState,
  ErrorState,
  Kpi,
  Loading,
  PageHeader,
  Panel,
} from "@/components/ks/Layout";
import { StateChip } from "@/components/ks/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogItemDrawer } from "@/features/logs/LogItemDrawer";
import { NewLogDrawer } from "@/features/logs/NewLogDrawer";
import { fmtDateShort, fmtMoney, fmtNum, fmtPct, fmtTons } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import type { LogItem } from "@/features/logs/model";

// Used only if the configured app has no server-computed score.
function fallbackScore(item: LogItem) {
  const num = (key: string) => {
    const value = Number(item.customFields[key]);
    return Number.isFinite(value) ? value : 0;
  };
  return (
    Math.round(
      (num("win_probability") * 0.4 +
        num("strategic_fit") * 6 +
        (5 - num("risk_rating")) * 4 +
        Math.min(num("est_margin_pct"), 30) * 0.5) *
        10
    ) / 10
  );
}

export default function Bids({ params = {} }: { params?: { id?: string } }) {
  const { canGlobal, isLoading: refLoading } = useRefData();
  const allowed = canGlobal("bid.manage");
  const q = trpc.wf.list.useQuery(
    { appKey: "bid", includeClosed: true },
    { enabled: allowed }
  );
  const app = trpc.wf.app.useQuery({ key: "bid" }, { enabled: allowed });
  const [, navigate] = useLocation();
  const [category, setCategory] = useState("open");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  if (refLoading) return <Loading />;
  if (!allowed)
    return (
      <EmptyState
        title="Bid pipeline restricted."
        body="You need bid management privileges to view and manage intake."
      />
    );
  const items = q.data?.items ?? [];
  const stateFor = (item: LogItem) =>
    q.data?.states.find(s => s.id === item.stateId);
  const open = items.filter(i => stateFor(i)?.category !== "end");
  const value = (i: LogItem) =>
    typeof i.customFields.est_value === "number" ? i.customFields.est_value : 0;
  const rows = items
    .filter(
      i =>
        (category === "all" ||
          (category === "closed"
            ? stateFor(i)?.category === "end"
            : stateFor(i)?.category !== "end")) &&
        `${i.label} ${i.title} ${i.customFields.gc_name ?? ""} ${i.customFields.location ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())
    )
    .sort(
      (a, b) =>
        (b.score ?? fallbackScore(b)) - (a.score ?? fallbackScore(a)) ||
        b.number - a.number
    );
  const id = params.id && /^\d+$/.test(params.id) ? Number(params.id) : null;
  const number = (i: LogItem, key: string) =>
    typeof i.customFields[key] === "number"
      ? (i.customFields[key] as number)
      : null;
  return (
    <>
      <PageHeader
        eyebrow="Intake · fabrication by others"
        title="Bid pipeline"
        subtitle="Rank opportunities. Move an awarded bid into a draft erection job."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New bid
          </Button>
        }
      />
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Open bids" value={open.length} />
          <Kpi
            label="Pipeline value"
            value={fmtMoney(
              open.reduce((s, i) => s + value(i), 0),
              { compact: true }
            )}
          />
          <Kpi
            label="Probability-weighted value"
            value={fmtMoney(
              open.reduce(
                (s, i) =>
                  s +
                  (value(i) *
                    Math.max(
                      0,
                      Math.min(100, number(i, "win_probability") ?? 0)
                    )) /
                    100,
                0
              ),
              { compact: true }
            )}
            sub="Contract value × win probability."
          />
          <Kpi
            label="Awarded"
            value={open.filter(i => stateFor(i)?.name === "Awarded").length}
            tone="green"
            sub="Open an awarded bid to convert to job."
          />
        </div>
        <Panel
          title="Ranked opportunities"
          actions={
            <div className="w-40">
              <SimpleSelect
                value={category}
                onChange={v => setCategory(v ?? "open")}
                options={{
                  open: "Open bids",
                  closed: "Closed bids",
                  all: "All bids",
                }}
              />
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ks-rule)] p-3">
            <Input
              aria-label="Search bids"
              className="max-w-xs bg-[var(--ks-paper)]"
              placeholder="Bid, GC, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <details className="min-w-0 text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                Weighted score · highest first
              </summary>
              <div className="mt-2 max-w-2xl">
                <p>
                  Uses the configured server score when available. Fallback: 0.4
                  × win probability (%) + 6 × strategic fit (1–5) + 4 × (5 −
                  risk rating) + 0.5 × min(margin %, 30), rounded to 1 decimal.
                  Contract value is shown separately; it does not dominate the
                  score.
                </p>
                {app.data?.app.scoreFormula && (
                  <code className="mt-1 block whitespace-normal">
                    Configured: {app.data.app.scoreFormula}
                  </code>
                )}
              </div>
            </details>
          </div>
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : !rows.length ? (
            <EmptyState
              icon={<Target className="size-6" />}
              title="No bids match."
              body="Create a bid with the GC, estimated tons, value and win probability."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ks-table whitespace-nowrap">
                <thead>
                  <tr>
                    {[
                      "Rank",
                      "Score",
                      "Bid",
                      "Opportunity",
                      "GC",
                      "Job type",
                      "Location",
                      "Est. tons",
                      "Est. value",
                      "Margin %",
                      "Win %",
                      "Bid due",
                      "State",
                    ].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i, rank) => {
                    const state = stateFor(i);
                    const typeDef = q.data?.fieldDefs.find(
                      d => d.key === "project_type"
                    );
                    return (
                      <tr
                        key={i.id}
                        className={
                          id === i.id ? "is-selected" : "cursor-pointer"
                        }
                        onClick={() => navigate(`/bids/${i.id}`)}
                      >
                        <td className="num">{rank + 1}</td>
                        <td className="num font-semibold">
                          {fmtNum(i.score ?? fallbackScore(i), 1)}
                          {i.score === null && (
                            <span
                              title="Fallback score"
                              className="text-muted-foreground"
                            >
                              *
                            </span>
                          )}
                        </td>
                        <td className="num">
                          <button
                            className="text-[var(--ks-accent-ink)]"
                            onClick={() => navigate(`/bids/${i.id}`)}
                          >
                            {i.label}
                          </button>
                        </td>
                        <td className="max-w-64 truncate" title={i.title}>
                          {i.title}
                        </td>
                        <td>{String(i.customFields.gc_name ?? "—")}</td>
                        <td>
                          {typeDef ? (
                            <CfValue
                              def={typeDef}
                              value={i.customFields.project_type}
                            />
                          ) : (
                            String(i.customFields.project_type ?? "—")
                          )}
                        </td>
                        <td>{String(i.customFields.location ?? "—")}</td>
                        <td className="right num">
                          {fmtTons(number(i, "est_tons"))}
                        </td>
                        <td className="right num">
                          {fmtMoney(number(i, "est_value"))}
                        </td>
                        <td className="right num">
                          {fmtPct(number(i, "est_margin_pct"), 1)}
                        </td>
                        <td className="right num">
                          {fmtPct(number(i, "win_probability"))}
                        </td>
                        <td className="num">{fmtDateShort(i.dueDate)}</td>
                        <td>
                          <StateChip
                            name={state?.name ?? "—"}
                            category={state?.category}
                            color={state?.color}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {id && (
        <LogItemDrawer
          key={id}
          id={id}
          appKey="bid"
          onClose={() => navigate("/bids")}
        />
      )}
      {params.id && !id && (
        <ErrorState error={{ message: "Invalid bid id." }} />
      )}
      {creating && (
        <NewLogDrawer
          appKey="bid"
          onClose={() => setCreating(false)}
          onCreated={rid => {
            setCreating(false);
            navigate(`/bids/${rid}`);
          }}
        />
      )}
    </>
  );
}
