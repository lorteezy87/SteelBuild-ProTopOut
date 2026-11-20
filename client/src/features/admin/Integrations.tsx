import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecordDrawer, ConfirmButton } from "@/components/ks/Controls";
import {
  Panel,
  Field,
  Loading,
  ErrorState,
  EmptyState,
  TabStrip,
} from "@/components/ks/Layout";
import { Pill } from "@/components/ks/Status";
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/lib/ref";
import { errMsg, fmtDateTime } from "@/lib/format";
import { Check, CopySecret, SaveBar } from "./Editor";
type Hook = RouterOutputs["integration"]["webhooks"][number];
type HookForm = {
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  regenerateSecret: boolean;
};
const blank: HookForm = {
  name: "",
  url: "",
  events: [],
  isActive: true,
  regenerateSecret: false,
};
export default function Integrations() {
  const [tab, setTab] = useState("webhooks");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <TabStrip
          tabs={[
            { key: "webhooks", label: "Webhooks" },
            { key: "tokens", label: "Organization API tokens" },
          ]}
          active={tab}
          onSelect={setTab}
        />
        <Link href="/api-docs" className="text-xs hover:underline">
          API & signature reference →
        </Link>
      </div>
      {tab === "tokens" ? <AllTokens /> : <Webhooks />}
    </div>
  );
}
function Webhooks() {
  const q = trpc.integration.webhooks.useQuery();
  const events = trpc.integration.eventNames.useQuery();
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Hook | null | undefined>();
  const [form, setForm] = useState<HookForm>(blank);
  const [secret, setSecret] = useState<string | null>(null);
  const success = async () => {
    await Promise.all([
      utils.integration.webhooks.invalidate(),
      utils.integration.deliveries.invalidate(),
      utils.ref.all.invalidate(),
    ]);
  };
  const save = trpc.integration.upsertWebhook.useMutation({
    onSuccess: r => {
      if (r.secret) setSecret(r.secret);
      setSelected(undefined);
      void success();
      toast.success("Webhook saved");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.integration.removeWebhook.useMutation({
    onSuccess: () => {
      setSelected(undefined);
      void success();
      toast.success("Webhook removed");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const ping = trpc.integration.ping.useMutation({
    onSuccess: r => {
      void success();
      if (r?.status === "success")
        toast.success(`Ping delivered · HTTP ${r.responseCode}`);
      else
        toast.error(
          `Ping not delivered · ${r?.responseCode ?? "network error"}. See delivery log.`
        );
    },
    onError: e => toast.error(errMsg(e)),
  });
  const open = (h: Hook | null) => {
    setSelected(h);
    setForm(
      h
        ? {
            name: h.name,
            url: h.url,
            events: h.events,
            isActive: h.isActive,
            regenerateSecret: false,
          }
        : { ...blank, events: [] }
    );
  };
  if (q.isLoading || events.isLoading) return <Loading />;
  if (q.error || events.error)
    return <ErrorState error={q.error ?? events.error} />;
  return (
    <div className="space-y-4">
      {secret && (
        <CopySecret value={secret} onDismiss={() => setSecret(null)} />
      )}
      <div className="flex justify-between gap-4">
        <p className="max-w-2xl text-muted-foreground">
          Signed POST events with HMAC-SHA256. Return a 2xx response within 10
          seconds. Failed deliveries retry up to five attempts.
        </p>
        <Button size="sm" disabled={!!secret} onClick={() => open(null)}>
          New webhook
        </Button>
      </div>
      <Panel title={`${q.data?.length ?? 0} endpoints`}>
        <div className="overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Endpoint</th>
                <th>Events</th>
                <th>Status</th>
                <th>Deliveries</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map(h => (
                <tr
                  key={h.id}
                  className="cursor-pointer"
                  onClick={() => open(h)}
                >
                  <td>
                    <button className="font-medium text-left">{h.name}</button>
                  </td>
                  <td className="max-w-80 truncate font-mono text-xs">
                    {h.url}
                  </td>
                  <td>
                    {h.events.includes("*")
                      ? "All events"
                      : `${h.events.length} selected`}
                  </td>
                  <td>
                    <Pill tone={h.isActive ? "green" : "gray"}>
                      {h.isActive ? "Active" : "Paused"}
                    </Pill>
                  </td>
                  <td className="num">{h.total}</td>
                  <td className="num">{h.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!q.data?.length && (
          <EmptyState
            title="No webhook endpoints"
            body="Add your receiver URL and select the events to send."
          />
        )}
      </Panel>
      <RecordDrawer
        open={selected !== undefined}
        onOpenChange={v => {
          if (!v) setSelected(undefined);
        }}
        title={selected?.name ?? "New webhook"}
        eyebrow="Integrations"
        width={880}
        actions={
          selected && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={ping.isPending}
                onClick={() => ping.mutate({ id: selected.id })}
              >
                {ping.isPending ? "Sending…" : "Send signed ping"}
              </Button>
              <ConfirmButton
                title="Delete webhook and delivery history?"
                destructive
                onConfirm={() => remove.mutate({ id: selected.id })}
              >
                Delete
              </ConfirmButton>
            </>
          )
        }
        footer={
          <SaveBar
            pending={save.isPending}
            disabled={
              !form.name.trim() ||
              !form.url.trim() ||
              !form.events.length ||
              (!!secret && form.regenerateSecret)
            }
            onSave={() => save.mutate({ id: selected?.id, ...form })}
            onCancel={() => setSelected(undefined)}
          />
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Endpoint URL">
              <Input
                type="url"
                className="font-mono"
                placeholder="https://receiver.example/webhooks/steelbuild"
                value={form.url}
                onChange={e => setForm({ ...form, url: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-8">
            <Check
              label="Active"
              checked={form.isActive}
              onChange={v => setForm({ ...form, isActive: v })}
            />
            {selected && (
              <Check
                label="Rotate secret (old signatures become invalid)"
                checked={form.regenerateSecret}
                onChange={v => setForm({ ...form, regenerateSecret: v })}
              />
            )}
          </div>
          <Field label="Events">
            <div className="border border-[var(--ks-rule)] p-3">
              <Check
                label="All events (*)"
                checked={form.events.includes("*")}
                onChange={v => setForm({ ...form, events: v ? ["*"] : [] })}
              />
              <div className="grid gap-x-6 sm:grid-cols-3">
                {(events.data ?? []).map(event => (
                  <Check
                    key={event}
                    label={event}
                    checked={
                      form.events.includes("*") || form.events.includes(event)
                    }
                    onChange={v => {
                      const list = form.events.includes("*")
                        ? [...(events.data ?? [])]
                        : form.events;
                      setForm({
                        ...form,
                        events: v
                          ? [...new Set([...list, event])]
                          : list.filter(e => e !== event),
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          </Field>
          {selected && (
            <>
              <div className="border-t border-[var(--ks-rule)] pt-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  Stored secret: {selected.secret}. The original cannot be
                  retrieved. Rotate only after coordinating with your receiver.
                </p>
                <Deliveries key={selected.id} id={selected.id} />
              </div>
            </>
          )}
        </div>
      </RecordDrawer>
    </div>
  );
}
function Deliveries({ id }: { id: number }) {
  const q = trpc.integration.deliveries.useQuery(
    { webhookId: id, limit: 100 },
    { refetchInterval: 15_000 }
  );
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState<number | null>(null);
  const retry = trpc.integration.redeliver.useMutation({
    onSuccess: r => {
      void utils.integration.deliveries.invalidate();
      void utils.integration.webhooks.invalidate();
      if (r?.status === "success") toast.success("Delivery succeeded");
      else toast.error("Delivery failed. Inspect the response.");
    },
    onError: e => toast.error(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const detail = q.data?.find(d => d.id === expanded);
  return (
    <div className="space-y-3">
      <h3 className="label-caps">Recent delivery log · latest 100</h3>
      <div className="overflow-x-auto">
        <table className="ks-table">
          <thead>
            <tr>
              <th>Event / sent</th>
              <th>Status</th>
              <th>HTTP</th>
              <th>Attempts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map(d => (
              <tr
                key={d.id}
                className="cursor-pointer"
                onClick={() => setExpanded(expanded === d.id ? null : d.id)}
              >
                <td>
                  <button className="text-left">{d.event}</button>
                  <span className="block text-[10px] num text-muted-foreground">
                    {fmtDateTime(d.createdAt)}
                  </span>
                </td>
                <td>
                  <Pill
                    tone={
                      d.status === "success"
                        ? "green"
                        : d.status === "failed"
                          ? "red"
                          : "amber"
                    }
                  >
                    {d.status}
                  </Pill>
                </td>
                <td className="num">{d.responseCode ?? "—"}</td>
                <td className="num">{d.attempts} / 5</td>
                <td onClick={e => e.stopPropagation()}>
                  <ConfirmButton
                    title="Redeliver this event?"
                    body="Your receiver may already have processed it. Use the delivery ID for idempotency."
                    disabled={retry.isPending}
                    onConfirm={() => retry.mutate({ deliveryRowId: d.id })}
                  >
                    Redeliver
                  </ConfirmButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!q.data?.length && (
        <p className="text-muted-foreground">
          No deliveries. Send a signed ping to test this endpoint.
        </p>
      )}
      {detail && (
        <div className="space-y-2 border bg-[var(--ks-bone)] p-3">
          <Field label="Delivery ID">
            <code className="text-xs">{detail.deliveryId}</code>
          </Field>
          <Field label="Response">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs">
              {detail.responseBody ?? "No response"}
            </pre>
          </Field>
          {detail.nextAttemptAt && (
            <Field label="Next attempt">
              {fmtDateTime(detail.nextAttemptAt)}
            </Field>
          )}
          <details>
            <summary className="cursor-pointer text-xs">Event payload</summary>
            <pre className="mt-2 overflow-x-auto font-mono text-xs">
              {JSON.stringify(detail.payload, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
function AllTokens() {
  const q = trpc.integration.allTokens.useQuery();
  const utils = trpc.useUtils();
  const revoke = trpc.integration.revokeToken.useMutation({
    onSuccess: () => {
      void utils.integration.allTokens.invalidate();
      void utils.integration.tokens.invalidate();
      toast.success("Token revoked");
    },
    onError: e => toast.error(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Organization-wide token inventory. Secrets are never listed. People
        create personal tokens on their{" "}
        <Link href="/account" className="underline">
          Account page
        </Link>
        .
      </p>
      <Panel title={`${q.data?.length ?? 0} tokens`}>
        <div className="overflow-x-auto">
          <table className="ks-table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Name</th>
                <th>Last 4</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map(t => (
                <tr key={t.id}>
                  <td>
                    {t.ownerName ?? `User ${t.userId}`}
                    <span className="block text-xs text-muted-foreground">
                      {t.ownerEmail}
                    </span>
                  </td>
                  <td>{t.name}</td>
                  <td className="num">…{t.last4}</td>
                  <td className="num">{fmtDateTime(t.createdAt)}</td>
                  <td className="num">
                    {t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : "Never"}
                  </td>
                  <td>
                    <ConfirmButton
                      title={`Revoke ${t.name}?`}
                      body="The integration using this token will immediately lose access."
                      destructive
                      disabled={revoke.isPending}
                      onConfirm={() => revoke.mutate({ id: t.id })}
                    >
                      Revoke
                    </ConfirmButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!q.data?.length && (
          <EmptyState
            title="No organization API tokens"
            body="Full-access people can create personal credentials on the Account page."
          />
        )}
      </Panel>
    </div>
  );
}
