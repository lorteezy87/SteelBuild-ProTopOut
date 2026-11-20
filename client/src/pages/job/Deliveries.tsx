import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/brand/Controls";
import {
  EmptyState,
  ErrorState,
  Kpi,
  Loading,
  PageHeader,
  Panel,
} from "@/components/brand/Layout";
import { DeliveryRiskBadge, Pill } from "@/components/brand/Status";
import { DeliveryDrawer } from "@/features/deliveries/DeliveryDrawer";
import { errMsg, fmtDateShort, fmtNum, fmtTons } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { DELIVERY_STATUSES } from "@shared/domain";
import { useJob, useJobInvalidate } from "./JobContext";

export default function Deliveries() {
  const { projectId, params, can } = useJob();
  const { today } = useRefData();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const invalidateJob = useJobInvalidate();
  const query = trpc.deliveries.list.useQuery({ projectId });
  const routeLoad =
    params.a && /^\d+$/.test(params.a) ? Number(params.a) : null;
  const [selected, setSelected] = useState<number | "new" | null>(routeLoad);
  useEffect(() => {
    setSelected(routeLoad);
  }, [routeLoad]);
  const [sequence, setSequence] = useState("all");
  const [risk, setRisk] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ id: number; label: string } | null>(
    null
  );
  const refresh = () => {
    void utils.deliveries.list.invalidate({ projectId });
    void invalidateJob(projectId);
    void utils.wf.summary.invalidate({ projectId });
  };
  const update = trpc.deliveries.upsert.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Load updated.");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const delay = trpc.deliveries.createDelayNotice.useMutation({
    onSuccess: result => {
      setNotice(result);
      refresh();
      void utils.wf.list.invalidate();
      toast.success(`${result.label} created.`, {
        action: {
          label: "Open notice",
          onClick: () => navigate(`/jobs/${projectId}/logs/delay/${result.id}`),
        },
      });
    },
    onError: e => toast.error(errMsg(e)),
  });
  const loads = query.data ?? [];
  const received = loads.filter(
    d =>
      !!d.receivedDate ||
      ["received", "received_short", "damaged"].includes(d.status)
  );
  const sequences = Array.from(
    new Map(
      loads.filter(d => d.sequence).map(d => [d.sequence!.id, d.sequence!])
    ).values()
  );
  const rows = loads.filter(
    d =>
      (sequence === "all" ||
        (sequence === "none"
          ? !d.sequenceTaskId
          : String(d.sequenceTaskId) === sequence)) &&
      (risk === "all" || d.risk === risk) &&
      `${d.loadNumber} ${d.fabricatorName ?? ""} ${d.ticketNumber ?? ""} ${d.shortageNotes ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  return (
    <>
      <PageHeader
        title="Fabricator deliveries"
        subtitle="Track loads against the erection sequence need dates. Fabrication by others."
        actions={
          can("delivery.edit") && (
            <Button size="sm" onClick={() => setSelected("new")}>
              <Plus className="size-4" /> New load
            </Button>
          )
        }
      />
      <div className="space-y-4 p-5">
        {notice && (
          <div className="flex items-center gap-3 border border-[var(--tp-rule)] bg-[var(--tp-paper)] px-3 py-2">
            Delay notice created.
            <Link
              className="font-medium text-[var(--tp-accent-ink)] underline"
              href={`/jobs/${projectId}/logs/delay/${notice.id}`}
            >
              {notice.label} → Open notice
            </Link>
            <button
              className="ml-auto text-xs"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notice link"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Loads late"
            value={loads.filter(d => d.risk === "late").length}
            tone="red"
          />
          <Kpi
            label="At risk"
            value={loads.filter(d => d.risk === "at_risk").length}
            tone="amber"
          />
          <Kpi
            label="Received"
            value={received.length}
            sub={`${loads.length} loads planned`}
            tone="green"
          />
          <Kpi
            label="Tons received / planned"
            value={`${fmtNum(
              received.reduce((s, d) => s + d.tons, 0),
              1
            )} / ${fmtNum(
              loads.reduce((s, d) => s + d.tons, 0),
              1
            )}`}
            sub="Load tonnage; shortages are noted separately."
          />
        </div>
        <Panel
          title="Load register"
          actions={<span className="num text-xs">{rows.length} loads</span>}
        >
          <div className="flex flex-wrap gap-2 border-b border-[var(--tp-rule)] p-3">
            <div className="w-64">
              <SimpleSelect
                value={sequence}
                onChange={v => setSequence(v ?? "all")}
                options={[
                  { value: "all", label: "All sequences" },
                  { value: "none", label: "Unassigned sequence" },
                  ...sequences.map(s => ({
                    value: String(s.id),
                    label: s.name,
                  })),
                ]}
              />
            </div>
            <div className="w-40">
              <SimpleSelect
                value={risk}
                onChange={v => setRisk(v ?? "all")}
                options={{
                  all: "All risk",
                  late: "Late",
                  at_risk: "At risk",
                  received: "Received",
                  ok: "OK",
                }}
              />
            </div>
            <Input
              aria-label="Search loads"
              placeholder="Load, fabricator, ticket, notes…"
              className="max-w-xs bg-[var(--tp-paper)]"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {query.isLoading ? (
            <Loading />
          ) : query.error ? (
            <ErrorState error={query.error} />
          ) : !rows.length ? (
            <EmptyState
              icon={<Truck className="size-6" />}
              title={
                loads.length ? "No matching loads." : "No loads scheduled."
              }
              body={
                loads.length
                  ? "Clear the filters to show all loads."
                  : "Add the fabricator's loads and tie each one to an erection sequence."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="tp-table whitespace-nowrap">
                <thead>
                  <tr>
                    {[
                      "Load #",
                      "Sequence",
                      "Fabricator",
                      "Need on site",
                      "Promised",
                      "Shipped",
                      "Received",
                      "Tons",
                      "Pieces",
                      "Ticket #",
                      "Status",
                      "Risk",
                      "Notes",
                      "Actions",
                    ].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(d => (
                    <tr
                      key={d.id}
                      className={
                        selected === d.id ? "is-selected" : "cursor-pointer"
                      }
                      onClick={() => setSelected(d.id)}
                    >
                      <td
                        className={`num font-medium ${d.risk === "late" ? "hazard" : ""}`}
                      >
                        <button
                          className="text-[var(--tp-accent-ink)]"
                          onClick={() => setSelected(d.id)}
                        >
                          {d.loadNumber}
                        </button>
                      </td>
                      <td>{d.sequence?.name ?? "—"}</td>
                      <td>{d.fabricatorName ?? "—"}</td>
                      {[
                        d.needDate,
                        d.promisedDate,
                        d.shippedDate,
                        d.receivedDate,
                      ].map((date, i) => (
                        <td key={i} className="num">
                          {fmtDateShort(date)}
                        </td>
                      ))}
                      <td className="right num">{fmtTons(d.tons)}</td>
                      <td className="right num">{fmtNum(d.pieces)}</td>
                      <td className="num">{d.ticketNumber ?? "—"}</td>
                      <td>
                        <Pill
                          tone={
                            d.status === "received_short" ||
                            d.status === "damaged"
                              ? "amber"
                              : "gray"
                          }
                        >
                          {DELIVERY_STATUSES[
                            d.status as keyof typeof DELIVERY_STATUSES
                          ] ?? d.status}
                        </Pill>
                      </td>
                      <td>
                        <DeliveryRiskBadge value={d.risk} />
                      </td>
                      <td
                        className="max-w-48 truncate"
                        title={d.shortageNotes ?? d.description ?? ""}
                      >
                        {d.shortageNotes || d.description || "—"}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {can("delivery.edit") && d.status === "scheduled" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={update.isPending}
                              onClick={() =>
                                update.mutate({
                                  id: d.id,
                                  projectId,
                                  loadNumber: d.loadNumber,
                                  shippedDate: today,
                                  status: "shipped",
                                })
                              }
                            >
                              Mark shipped
                            </Button>
                          )}
                          {can("delivery.edit") &&
                            ["scheduled", "shipped"].includes(d.status) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={update.isPending}
                                onClick={() =>
                                  update.mutate({
                                    id: d.id,
                                    projectId,
                                    loadNumber: d.loadNumber,
                                    receivedDate: today,
                                    status: "received",
                                  })
                                }
                              >
                                Mark received
                              </Button>
                            )}
                          {can("log.create") &&
                            ["late", "at_risk"].includes(d.risk) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={delay.isPending}
                                onClick={() =>
                                  delay.mutate({ deliveryId: d.id })
                                }
                              >
                                Create delay notice
                              </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {selected !== null &&
        (selected === "new" || loads.some(d => d.id === selected)) && (
          <DeliveryDrawer
            key={selected}
            projectId={projectId}
            load={loads.find(d => d.id === selected) ?? null}
            editable={can("delivery.edit")}
            onClose={() => {
              setSelected(null);
              if (routeLoad) navigate(`/jobs/${projectId}/deliveries`);
            }}
            onChanged={refresh}
          />
        )}
      {routeLoad &&
        !query.isLoading &&
        !query.error &&
        !loads.some(d => d.id === routeLoad) && (
          <ErrorState error={{ message: "Load not found on this job." }} />
        )}
    </>
  );
}
