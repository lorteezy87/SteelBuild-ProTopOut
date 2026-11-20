import type { ReactNode } from "react";
import { Link } from "wouter";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/brand/Layout";
import { Pill } from "@/components/brand/Status";
import { errMsg } from "@/lib/format";
import { WEBHOOK_ENTITIES, WEBHOOK_ACTIONS } from "@shared/domain";
import { API_RESOURCES, type ApiResource } from "@/features/admin/ApiResources";
const verification = `import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const app = express();
const secret = process.env.STEELBUILD_WEBHOOK_SECRET;
if (!secret) throw new Error("Set STEELBUILD_WEBHOOK_SECRET");

// Register before express.json(). Verify the unmodified raw body.
app.post("/webhooks/steelbuild", express.raw({ type: "application/json" }),
  async (req, res) => {
    const timestamp = req.get("X-SteelBuild-Timestamp") ?? "";
    const signature = req.get("X-SteelBuild-Signature") ?? "";
    const deliveryId = req.get("X-SteelBuild-Delivery-Id") ?? "";
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody) || !/^\\d+$/.test(timestamp) ||
        !/^[a-f0-9]{64}$/i.test(signature) || !deliveryId) {
      return res.sendStatus(401);
    }
    // Recommended replay window: five minutes; keep server clocks in sync.
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return res.sendStatus(401);
    }
    const expected = createHmac("sha256", secret)
      .update(timestamp).update(".").update(rawBody).digest();
    const supplied = Buffer.from(signature, "hex");
    if (expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)) {
      return res.sendStatus(401);
    }
    let event;
    try { event = JSON.parse(rawBody.toString("utf8")); }
    catch { return res.sendStatus(400); }
    // Durably deduplicate by deliveryId before applying side effects.
    // Persist/enqueue event here, then acknowledge promptly.
    // req.get("X-SteelBuild-Event") contains the event name (including ping).
    return res.sendStatus(204);
  });
app.use(express.json());
app.listen(8080);`;
function Code({ value, label }: { value: string; label?: string }) {
  return (
    <div className="overflow-hidden border border-[var(--tp-rule)] bg-[var(--tp-graphite)] text-[var(--tp-solid-ink)]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono text-[10px] text-white/60">
          {label ?? "Example"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-white/70 hover:bg-[var(--tp-solid-ink)]/10 hover:text-white"
          aria-label={`Copy ${label ?? "example"}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast.success("Copied");
            } catch (e) {
              toast.error(errMsg(e));
            }
          }}
        >
          <Copy className="size-3" />
          Copy
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-5">
        <code>{value}</code>
      </pre>
    </div>
  );
}
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-5 space-y-4 border-b border-[var(--tp-rule)] pb-8"
    >
      <h2 className="text-[18px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}
export default function ApiDocs() {
  const base = `${window.location.origin}/api/v2`;
  const curl = (path: string) =>
    `curl '${base}${path}' \\\n  -H 'Authorization: Bearer <YOUR_TOKEN>'`;
  const index = [
    { id: "overview", label: "Overview & base URL" },
    { id: "auth", label: "Authentication" },
    { id: "queries", label: "Fields, filters & paging" },
    { id: "limits", label: "Rate limits & errors" },
    { id: "resources", label: "Supported methods" },
    ...API_RESOURCES.map(r => ({ id: r.key, label: r.label })),
    { id: "webhooks", label: "Webhooks & verification" },
  ];
  return (
    <div>
      <PageHeader
        eyebrow="Integrator reference · Version 2"
        title="SteelBuild Pro REST API"
        subtitle="Export portfolio data, create jobs and sequences, and connect signed workflow events."
        actions={
          <Link href="/account" className="text-xs underline">
            Manage my API tokens
          </Link>
        }
      />
      <div className="flex flex-col md:flex-row">
        <nav
          aria-label="API reference index"
          className="border-b border-[var(--tp-rule)] bg-[var(--tp-paper)] p-4 md:w-56 md:shrink-0 md:border-b-0 md:border-r"
        >
          <div className="md:sticky md:top-4">
            <div className="label-caps mb-3">On this page</div>
            <div className="flex flex-wrap gap-1 md:block">
              {index.map(i => (
                <a
                  key={i.id}
                  href={`#${i.id}`}
                  className="block border-l-2 border-transparent px-3 py-1.5 text-xs text-muted-foreground hover:border-[var(--tp-accent)] hover:bg-[var(--tp-bone)] hover:text-foreground"
                >
                  {i.label}
                </a>
              ))}
            </div>
          </div>
        </nav>
        <main className="min-w-0 flex-1 space-y-8 p-5 lg:p-8">
          <Section id="overview" title="Overview">
            <p>
              The API base path is <code className="font-mono">/api/v2</code> on
              this deployment. Resource names are case-sensitive. Use JSON
              request bodies, positive integer IDs and YYYY-MM-DD date strings.
              Numeric request values are numbers, not strings.
            </p>
            <Code
              value={`BASE_URL=${base}\n\ncurl "$BASE_URL/"`}
              label="Base URL & public discovery"
            />
            <p>
              <code>GET /api/v2/</code> is unauthenticated discovery. It returns{" "}
              <code>
                {'{"name":"SteelBuild Pro API","version":2,"resources":[...]}'}
              </code>
              , not a data envelope.
            </p>
            <p>
              Collection responses have <code>data</code>,{" "}
              <code>totalRecords</code> and <code>nextPage</code>. Single-record
              and write responses contain only <code>data</code>.
            </p>
            <Code
              value={JSON.stringify(
                {
                  data: [
                    {
                      id: 1,
                      code: "PHX-401",
                      name: "Phoenix erection job",
                      state: "active",
                    },
                  ],
                  totalRecords: 1,
                  nextPage: null,
                },
                null,
                2
              )}
              label="Collection response · HTTP 200"
            />
            <Code
              value={
                '// GET /jobs/1\n{"data":{"id":1,"name":"Phoenix erection job"}}\n\n// POST /jobs · HTTP 201\n{"data":{"id":1}}\n\n// PATCH /jobs/1 · HTTP 200\n{"data":{"ok":true}}\n\n// DELETE /tasks/1 · HTTP 200\n{"data":{"id":1,"deleted":true}}'
              }
              label="Record & write responses"
            />
            <p className="text-muted-foreground">
              Reads use report-style projections, not full database records. IDs
              accepted on writes may be represented by display names on reads.
              Unsupported methods are not implied by a resource being listed.
            </p>
          </Section>
          <Section id="auth" title="Authentication">
            <p>
              Create a personal token on the{" "}
              <Link href="/account" className="underline">
                Account page
              </Link>
              . Full access or organization admin access is required to create
              one. Each person can have at most five. Tokens are shown once,
              stored as SHA-256 hashes, and have no expiry setting. Revoke them
              when no longer needed.
            </p>
            <Code
              value={curl("/jobs?fields=code,name,state")}
              label="Bearer authentication"
            />
            <p>
              Every resource operation requires{" "}
              <code>Authorization: Bearer &lt;token&gt;</code>. A token acts as
              its owner; inactive and Passive owners are rejected. Writes run
              through the existing permission checks, with access-type caps and
              deny-wins roles. Store tokens on the server, never in a browser
              bundle, query string or public repository.
            </p>
            <p>
              Non-admin owners with Logs only or Timesheet-only access can use
              <code> logItems</code> under their log privileges and read
              <code> companies</code>. Jobs, tasks, timeEntries (including their
              own), expenses, deliveries and dailyReports return HTTP 403 for
              these tiers on every method. Users reads still require Full access
              or admin access. Passive owners cannot use API tokens.
            </p>
            <p>
              <code>?notifications=false</code> suppresses in-app notifications{" "}
              <strong>and outbound webhook emission</strong> for supported
              writes. Activity records and recalculation still run.
            </p>
          </Section>
          <Section id="queries" title="Fields, filters, sorting & pagination">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Behavior</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>fields</code>
                  </td>
                  <td>
                    Comma-separated response fields. id is always included.
                    Unknown fields are omitted.
                  </td>
                  <td>
                    <code>fields=code,name,state</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>filter</code>
                  </td>
                  <td>
                    URL-encoded JSON object. All conditions combine with AND.
                    Field keys refer to returned columns.
                  </td>
                  <td>
                    <code>{'{"state":"active"}'}</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>sort</code>
                  </td>
                  <td>
                    Comma-separated columns with one direction for the entire
                    list; ascending by default. Nulls sort last.
                  </td>
                  <td>
                    <code>sort=state,name/desc</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>page</code>
                  </td>
                  <td>
                    1-based, fixed 250 records/page. No page-size option. Follow
                    nextPage until null.
                  </td>
                  <td>
                    <code>page=2</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>app</code>
                  </td>
                  <td>
                    Optional log app key for logItems collection or
                    single-record reads.
                  </td>
                  <td>
                    <code>app=rfi</code>
                  </td>
                </tr>
              </tbody>
            </table>
            <p>
              Filters and sort apply before paging and field selection. A
              single-record GET supports fields (and app for logItems), but does
              not apply filter, sort or paging.
            </p>
            <Code
              value={`curl --get '${base}/jobs' \\\n  -H 'Authorization: Bearer <YOUR_TOKEN>' \\\n  --data-urlencode 'fields=code,name,state,deadline' \\\n  --data-urlencode 'filter={"state":["active","draft"],"name":"^Phoenix","deadline":{"between":["today","today+30"]}}' \\\n  --data-urlencode 'sort=deadline,name/desc' \\\n  --data-urlencode 'page=1'`}
              label="Combined query"
            />
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Filter shorthand" bodyClassName="p-3">
                <Code
                  value={
                    '{"state":"active"}                 // equality\n{"state":["active","draft"]}        // in list\n{"name":"^Phoenix"}                 // prefix, case-insensitive\n{"budget":{"gt":100000}}           // numeric comparison\n{"name":{"contains":"steel"}}      // case-insensitive contains\n{"deadline":{"range":"next_month"}} // calendar period\n{"cf_crew_hours":{"gte":40}}        // custom field column'
                  }
                  label="JSON filter examples"
                />
              </Panel>
              <Panel
                title="Operators & relative dates"
                bodyClassName="space-y-3 p-4"
              >
                <p className="font-mono text-xs">
                  eq, ne, gt, gte, lt, lte, in, nin, contains, starts, empty,
                  notempty, between, range
                </p>
                <p className="text-xs">
                  Use only supported operators. Date tokens resolve in the
                  organization's timezone: today, yesterday, tomorrow, today+N,
                  today-N; this/last/next_week_start or _end;
                  this/last/next_month_start or _end.
                </p>
                <p className="text-xs">
                  range values: today, this_week, last_week, next_week,
                  this_month, last_month, next_month, next_30, last_30, overdue.
                  Weeks start Monday; ranges are inclusive.
                </p>
              </Panel>
            </div>
            <p>
              For custom fields, GET columns are <code>cf_&lt;key&gt;</code>;
              write JSON uses <code>{'{"customFields":{"key":value}}'}</code>.
              Formulas are computed by the server, not by the integrator.
            </p>
            <Code
              value={
                '{\n  "data": ["up to 250 records"],\n  "totalRecords": 501,\n  "nextPage": "/api/v2/jobs?fields=code%2Cname&page=2"\n}'
              }
              label="Paging · nextPage is a relative URL"
            />
          </Section>
          <Section id="limits" title="Rate limits & error handling">
            <p>
              Each token permits{" "}
              <strong>600 calls per fixed one-hour window</strong>.
              Authenticated responses include{" "}
              <code>X-SteelBuild-Api-Usage: used/600</code>. On HTTP 429,{" "}
              <code>Retry-After</code> gives seconds until the window resets.
              Use paging and fields rather than repeated record requests.
            </p>
            <Code
              value={
                'HTTP/1.1 429 Too Many Requests\nX-SteelBuild-Api-Usage: 600/600\nRetry-After: 1320\nContent-Type: application/json\n\n{"error":{"code":"rate_limited","message":"Rate limit of 600 calls per hour exceeded"}}'
              }
              label="Rate-limit response"
            />
            <table className="tp-table">
              <thead>
                <tr>
                  <th>HTTP</th>
                  <th>Typical code</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "400",
                    "bad_id / bad_filter / bad_request",
                    "Invalid positive integer ID, malformed JSON filter or invalid write fields.",
                  ],
                  [
                    "401",
                    "unauthorized",
                    "Missing bearer header or invalid/revoked token.",
                  ],
                  [
                    "403",
                    "forbidden",
                    "Owner is inactive/Passive or lacks required privileges.",
                  ],
                  [
                    "404",
                    "not_found",
                    "Unknown read resource/app, or record not visible to the owner.",
                  ],
                  [
                    "405",
                    "method_not_allowed",
                    "POST, PATCH or DELETE not implemented on that resource.",
                  ],
                  [
                    "429",
                    "rate_limited",
                    "Hourly token budget exhausted; respect Retry-After.",
                  ],
                  ["500", "internal", "Unexpected server error."],
                ].map(r => (
                  <tr key={r[0]}>
                    {r.map((v, i) => (
                      <td key={i} className={i < 2 ? "font-mono text-xs" : ""}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <Code
              value={
                '{"error":{"code":"bad_request","message":"name: Too small: expected string to have >=1 characters"}}'
              }
              label="Error envelope"
            />
          </Section>
          <Section id="resources" title="Supported resources & methods">
            <p>
              All nine resources implement collection and single-record GET.
              Only jobs, tasks, logItems and deliveries implement writes. There
              are no REST endpoints for tokens, roles, log-app definitions,
              approvals, files or workflow transitions.
            </p>
            <div className="overflow-x-auto">
              <table className="tp-table">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>GET list</th>
                    <th>GET /:id</th>
                    <th>POST</th>
                    <th>PATCH /:id</th>
                    <th>DELETE /:id</th>
                  </tr>
                </thead>
                <tbody>
                  {API_RESOURCES.map(r => (
                    <tr key={r.key}>
                      <td>
                        <a
                          href={`#${r.key}`}
                          className="font-mono hover:underline"
                        >
                          /{r.key}
                        </a>
                      </td>
                      {[true, true, !!r.create, !!r.patch, !!r.delete].map(
                        (yes, i) => (
                          <td key={i}>
                            {yes ? <Pill tone="green">Yes</Pill> : "—"}
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          {API_RESOURCES.map(r => (
            <Resource key={r.key} resource={r} base={base} />
          ))}
          <Section id="webhooks" title="Webhooks & signature verification">
            <p>
              Admins configure endpoint URL, active flag and event subscriptions
              under{" "}
              <Link href="/admin/integrations" className="underline">
                Administration → Integrations
              </Link>
              . Keep the one-time signing secret separate from API tokens.
              Subscribe to specific events or <code>*</code>. A signed test uses
              the event <code>ping</code>.
            </p>
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>X-SteelBuild-Timestamp</code>
                  </td>
                  <td>
                    Unix seconds as a string. A new timestamp is used on each
                    attempt.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>X-SteelBuild-Signature</code>
                  </td>
                  <td>
                    64-character hex HMAC-SHA256 of timestamp + "." + exact
                    request body. No sha256= prefix.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>X-SteelBuild-Delivery-Id</code>
                  </td>
                  <td>
                    UUID stable across retries/redelivery. Use as an idempotency
                    key.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>X-SteelBuild-Event</code>
                  </td>
                  <td>entity.action or ping.</td>
                </tr>
                <tr>
                  <td>
                    <code>Content-Type</code>
                  </td>
                  <td>application/json</td>
                </tr>
                <tr>
                  <td>
                    <code>User-Agent</code>
                  </td>
                  <td>SteelBuild-Pro-Webhooks/1.0</td>
                </tr>
              </tbody>
            </table>
            <Code
              value={
                'hex(HMAC-SHA256(secret, `${timestamp}.${body}`))\n\n{\n  "event": "task.update",\n  "deliveryId": "c4858472-47e3-4497-980a-fbd0888d28dd",\n  "occurredAt": "2026-11-05T15:00:00.000Z",\n  "data": {"id": 42, "projectId": 1, "changed": ["percentComplete"]}\n}'
              }
              label="Signature & event payload"
            />
            <p>
              Payload data is event-specific and often contains an ID plus
              changed fields, not a full record. Fetch the current record
              through REST if needed. Do not reserialize JSON before verifying;
              whitespace and byte order matter.
            </p>
            <div className="overflow-x-auto">
              <table className="tp-table">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Available event names</th>
                  </tr>
                </thead>
                <tbody>
                  {WEBHOOK_ENTITIES.map(e => (
                    <tr key={e}>
                      <td className="font-mono">{e}</td>
                      <td className="font-mono text-xs">
                        {WEBHOOK_ACTIONS.map(a => `${e}.${a}`).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Return any 2xx status within 10 seconds. Failures retry after 1,
              4, 16 and 64 minutes, with a maximum of five attempts. Inspect
              status, response code, response body and attempts in the delivery
              log; admins can redeliver. Verify signatures, reject stale
              timestamps and durably deduplicate delivery IDs before applying
              side effects.
            </p>
            <Code
              value={verification}
              label="Node.js + Express · verify before JSON parsing"
            />
            <p className="text-xs text-muted-foreground">
              The five-minute freshness window and durable deduplication are
              receiver recommendations. Register this raw-body route before a
              global JSON parser, persist the event or queue work, then
              acknowledge quickly.
            </p>
          </Section>
        </main>
      </div>
    </div>
  );
}
function Resource({
  resource: r,
  base,
}: {
  resource: ApiResource;
  base: string;
}) {
  const writeCurl = (
    method: string,
    suffix: string,
    body: Record<string, unknown>
  ) =>
    `curl -X ${method} '${base}/${r.key}${suffix}' \\\n  -H 'Authorization: Bearer <YOUR_TOKEN>' \\\n  -H 'Content-Type: application/json' \\\n  --data '${JSON.stringify(body, null, 2)}'`;
  return (
    <Section id={r.key} title={r.label}>
      <p>{r.description}</p>
      <div className="space-y-1 font-mono text-xs">
        <div>
          <Pill tone="blue">GET</Pill> /api/v2/{r.key}
        </div>
        <div>
          <Pill tone="blue">GET</Pill> /api/v2/{r.key}/:id
        </div>
      </div>
      <Code
        value={`curl '${base}/${r.key}${r.key === "logItems" ? "?app=rfi" : ""}' \\\n  -H 'Authorization: Bearer <YOUR_TOKEN>'\n\ncurl '${base}/${r.key}/1?fields=id${r.key === "logItems" ? ",label,title&app=rfi" : ""}' \\\n  -H 'Authorization: Bearer <YOUR_TOKEN>'`}
        label={`${r.key} · read examples (replace sample IDs)`}
      />
      <details className="border border-[var(--tp-rule)] bg-[var(--tp-paper)] p-3">
        <summary className="cursor-pointer font-medium">
          Response field names
        </summary>
        <p className="mt-3 break-words font-mono text-xs leading-6">
          {r.columns}
        </p>
      </details>
      {r.create && (
        <div className="space-y-3 border-l-2 border-[var(--tp-accent)] pl-4">
          <h3 className="font-semibold">
            <Pill tone="orange">POST</Pill>{" "}
            <code className="ml-2">/{r.key}</code>
          </h3>
          <p>
            <strong>Required:</strong> {r.create.required}
          </p>
          <p>
            <strong>Optional:</strong> {r.create.optional}
          </p>
          <p className="text-xs text-muted-foreground">
            Permission: {r.create.permission}.
          </p>
          <Code
            value={writeCurl("POST", "", r.create.example)}
            label="Create · HTTP 201 returns data.id"
          />
        </div>
      )}
      {r.patch && (
        <div className="space-y-3 border-l-2 border-[var(--tp-rule)] pl-4">
          <h3 className="font-semibold">
            <Pill tone="orange">PATCH</Pill>{" "}
            <code className="ml-2">/{r.key}/:id</code>
          </h3>
          <p>{r.patch.fields}</p>
          <p className="text-xs text-muted-foreground">
            Permission: {r.patch.permission}.
          </p>
          <Code
            value={writeCurl(
              "PATCH",
              "/1?notifications=false",
              r.patch.example
            )}
            label="Partial update · notifications and webhooks suppressed"
          />
        </div>
      )}
      {r.delete && (
        <div className="space-y-3 border-l-2 border-[var(--tp-red)] pl-4">
          <h3 className="font-semibold">
            <Pill tone="red">DELETE</Pill>{" "}
            <code className="ml-2">/{r.key}/:id</code>
          </h3>
          <p className="text-xs text-muted-foreground">
            Permission: {r.delete}
          </p>
          <Code
            value={`curl -X DELETE '${base}/${r.key}/1' \\\n  -H 'Authorization: Bearer <YOUR_TOKEN>'`}
            label="Delete · HTTP 200 returns data.deleted"
          />
        </div>
      )}
      {r.note && (
        <p className="border border-[var(--tp-rule)] bg-[var(--tp-paper)] p-3 text-xs leading-5">
          {r.note}
        </p>
      )}
    </Section>
  );
}
