import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PageHeader,
  Panel,
  Field,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/ks/Layout";
import { ConfirmButton } from "@/components/ks/Controls";
import { Pill } from "@/components/ks/Status";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { ACCESS_TYPES } from "@shared/domain";
import { errMsg, fmtDateTime } from "@/lib/format";
import { CopySecret } from "@/features/admin/Editor";
export default function Account() {
  const { ref, user, userName, jobRoleName, isLoading, error } = useRefData();
  const tokens = trpc.integration.tokens.useQuery();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const create = trpc.integration.createToken.useMutation({
    onSuccess: r => {
      setSecret(r.token);
      setName("");
      void utils.integration.tokens.invalidate();
    },
    onError: e => toast.error(errMsg(e)),
  });
  const revoke = trpc.integration.revokeToken.useMutation({
    onSuccess: () => {
      void utils.integration.tokens.invalidate();
      toast.success("Token revoked");
    },
    onError: e => toast.error(errMsg(e)),
  });
  if (isLoading || tokens.isLoading) return <Loading />;
  if (error || tokens.error)
    return <ErrorState error={error ?? tokens.error} />;
  if (!ref)
    return (
      <EmptyState
        title="Account unavailable"
        body="Sign in to view your account."
      />
    );
  const person = user(ref.me.id);
  const canCreate = ref.me.isAdmin || ref.me.accessType === "full";
  return (
    <div>
      <PageHeader
        eyebrow="Personal settings"
        title="Account"
        subtitle="Profile, access and integration credentials."
      />
      <div className="space-y-5 p-6">
        <Panel
          title="My profile"
          actions={
            <Pill tone={ref.me.isAdmin ? "orange" : "gray"}>
              {ref.me.isAdmin ? "Organization admin" : "Organization member"}
            </Pill>
          }
          bodyClassName="p-5"
        >
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name">{ref.me.name ?? "—"}</Field>
            <Field label="Email">{ref.me.email ?? "—"}</Field>
            <Field label="Access type">
              {ACCESS_TYPES[ref.me.accessType as keyof typeof ACCESS_TYPES] ??
                ref.me.accessType}
            </Field>
            <Field label="Title">{person?.title ?? "—"}</Field>
            <Field label="Job role">{jobRoleName(person?.jobRoleId)}</Field>
            <Field label="Supervisor">{userName(person?.supervisorId)}</Field>
            <Field label="Status">
              <Pill tone={person?.isActive ? "green" : "gray"}>
                {person?.isActive ? "Active" : "Inactive"}
              </Pill>
            </Field>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            An organization admin manages your profile, rates and access.
          </p>
        </Panel>
        <Panel
          title={`Personal API tokens · ${tokens.data?.length ?? 0} / 5`}
          actions={
            <Link href="/api-docs" className="text-xs hover:underline">
              API reference →
            </Link>
          }
          bodyClassName="space-y-4 p-5"
        >
          <p className="max-w-3xl text-muted-foreground">
            Bearer tokens act as you and follow your permissions. At most five
            tokens per person. Only SHA-256 hashes are stored. Tokens do not
            expire automatically; revoke unused credentials.
          </p>
          {secret && (
            <CopySecret
              value={secret}
              label="Copy this token now. It cannot be viewed again."
              onDismiss={() => setSecret(null)}
            />
          )}
          {canCreate ? (
            <div className="flex max-w-lg gap-2">
              <Input
                value={name}
                aria-label="Token name"
                placeholder="Token name, e.g. accounting export"
                maxLength={128}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (
                    e.key === "Enter" &&
                    name.trim() &&
                    !secret &&
                    !create.isPending &&
                    (tokens.data?.length ?? 0) < 5
                  )
                    create.mutate({ name: name.trim() });
                }}
              />
              <Button
                disabled={
                  !name.trim() ||
                  create.isPending ||
                  !!secret ||
                  (tokens.data?.length ?? 0) >= 5
                }
                onClick={() => create.mutate({ name: name.trim() })}
              >
                Create token
              </Button>
            </div>
          ) : (
            <p className="border border-[var(--ks-rule)] p-3">
              API token creation requires Full access or organization admin
              access.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="ks-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Last 4</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.data?.map(t => (
                  <tr key={t.id}>
                    <td className="font-medium">{t.name}</td>
                    <td className="num">…{t.last4}</td>
                    <td className="num">{fmtDateTime(t.createdAt)}</td>
                    <td className="num">
                      {t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : "Never"}
                    </td>
                    <td className="right">
                      <ConfirmButton
                        title={`Revoke ${t.name}?`}
                        body="Applications using this token will immediately lose access."
                        confirmLabel="Revoke token"
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
          {!tokens.data?.length && (
            <EmptyState
              title="No API tokens"
              body={
                canCreate
                  ? "Name a token to connect an export or integration."
                  : "Ask an admin for Full access to create API tokens."
              }
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
