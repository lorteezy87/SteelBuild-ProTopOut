import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart3, CalendarRange, ClipboardCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { BrandGlyph, Wordmark } from "../brand/Status";

const POINTS = [
  { icon: CalendarRange, title: "Schedule and sequences", body: "Erection sequences tied to fabricator loads, with health that flags a slipping job early." },
  { icon: ClipboardCheck, title: "Field to office", body: "Daily reports post crew hours to timesheets; RFIs and change orders carry their own clocks." },
  { icon: BarChart3, title: "Cost and portfolio", body: "Budget, earned value and change orders rolled up across every active job." },
];

/** Unauthenticated entry: brand panel on Foundry Black, sign-in card on white. */
export function SignIn() {
  return (
    <div className="flex min-h-dvh bg-[var(--tp-bone)]">
      <div className="relative hidden w-[46%] max-w-[720px] flex-col overflow-hidden bg-[var(--tp-graphite)] px-12 py-10 text-white lg:flex">
        <Wordmark size="lg" width={380} className="-ml-3" />
        <div className="mt-auto max-w-[460px]">
          <div className="text-[12.5px] font-medium tracking-[0.02em] text-[var(--tp-brand)]">Steel erection project management</div>
          <h1 className="mt-3 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-white">
            Every job, sequence and dollar in one place.
          </h1>
          <div className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--tp-graphite-3)] bg-[var(--tp-graphite-2)] text-[var(--tp-brand)]">
                  <Icon className="size-4" />
                </span>
                <div>
                  <div className="text-[14px] font-medium text-white">{title}</div>
                  <div className="mt-0.5 text-[13.5px] leading-relaxed text-[var(--tp-sidebar-muted)]">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 border-t border-[var(--tp-graphite-3)] pt-4 text-[12px] text-[var(--tp-sidebar-muted)]">Erection only · Fabrication by others</div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center lg:hidden">
            <div className="rounded-xl bg-[var(--tp-graphite)] px-6 py-4">
              <Wordmark size="md" />
            </div>
          </div>
          <OwnerSignIn />
          <p className="mt-6 text-center text-[12px] text-[var(--tp-muted)]">Forgot your password? Set OWNER_RESET_PASSWORD on the server and restart.</p>
        </div>
      </div>
    </div>
  );
}

export function AccessBlocked({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--tp-bone)] p-8">
      <div className="tp-panel w-full max-w-md p-7">
        <div className="mb-5 flex items-center gap-3">
          <BrandGlyph size={40} />
          <div className="text-[13px] font-medium text-[var(--tp-muted)]">SteelBuild Pro TopOut</div>
        </div>
        <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--tp-ink)]">Your account can't sign in yet</h2>
        <p className="mt-2 text-[14px] text-[var(--tp-ink-2)]">{message}</p>
        <p className="mt-2 text-[14px] text-[var(--tp-muted)]">Ask your SteelBuild Pro TopOut administrator to activate your account or change your access type.</p>
        <Button variant="outline" className="mt-6" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
}

/** Owner sign-in. On a fresh install it becomes first-run setup and creates the owner. */
function OwnerSignIn() {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then((s: { setupRequired?: boolean } | null) => setSetupRequired(!!s?.setupRequired))
      .catch(() => setSetupRequired(false));
  }, []);

  const setup = setupRequired === true;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (setup) await post("/api/auth/setup", { name, email, password });
      else await post("/api/auth/login", { email, password });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form className="tp-panel p-8" onSubmit={submit} noValidate>
      <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-[var(--tp-ink)]">
        {setup ? "Set up SteelBuild Pro TopOut" : "Sign in to SteelBuild Pro TopOut"}
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--tp-muted)]">
        {setup ? "Create your login. You are the only person who signs in to this app." : "Use your email and password."}
      </p>
      <div className="mt-6 space-y-4">
        {setup && (
          <div className="space-y-1.5">
            <Label htmlFor="si-name">Full name</Label>
            <Input id="si-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="si-email">Email</Label>
          <Input id="si-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="si-password">Password</Label>
          <Input
            id="si-password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {setup && <p className="text-[12px] text-[var(--tp-muted)]">At least 10 characters.</p>}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-6 h-11 w-full text-[14.5px]" disabled={busy || setupRequired === null}>
        {busy ? "Please wait…" : setup ? "Create login" : "Sign in"}
      </Button>
    </form>
  );
}
