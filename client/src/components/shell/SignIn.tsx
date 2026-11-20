import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startLogin } from "@/const";
import { BarChart3, CalendarRange, ClipboardCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { BrandGlyph, Wordmark } from "../ks/Status";

const POINTS = [
  { icon: CalendarRange, title: "Schedule and sequences", body: "Erection sequences tied to fabricator loads, with health that flags a slipping job early." },
  { icon: ClipboardCheck, title: "Field to office", body: "Daily reports post crew hours to timesheets; RFIs and change orders carry their own clocks." },
  { icon: BarChart3, title: "Cost and portfolio", body: "Budget, earned value and change orders rolled up across every active job." },
];

/** Unauthenticated entry: brand panel on Foundry Black, sign-in card on white. */
export function SignIn() {
  return (
    <div className="flex min-h-dvh bg-[var(--ks-bone)]">
      <div className="relative hidden w-[46%] max-w-[720px] flex-col overflow-hidden bg-[var(--ks-graphite)] px-12 py-10 text-white lg:flex">
        <Wordmark size="lg" width={380} className="-ml-3" />
        <div className="mt-auto max-w-[460px]">
          <div className="text-[12.5px] font-medium tracking-[0.02em] text-[var(--ks-brand)]">Steel erection project management</div>
          <h1 className="mt-3 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-white">
            Every job, sequence and dollar in one place.
          </h1>
          <div className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--ks-graphite-3)] bg-[var(--ks-graphite-2)] text-[var(--ks-brand)]">
                  <Icon className="size-4" />
                </span>
                <div>
                  <div className="text-[14px] font-medium text-white">{title}</div>
                  <div className="mt-0.5 text-[13.5px] leading-relaxed text-[var(--ks-sidebar-muted)]">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 border-t border-[var(--ks-graphite-3)] pt-4 text-[12px] text-[var(--ks-sidebar-muted)]">Erection only · Fabrication by others</div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center lg:hidden">
            <div className="rounded-xl bg-[var(--ks-graphite)] px-6 py-4">
              <Wordmark size="md" />
            </div>
          </div>
          {window.__MANUS_CONFIG__?.oauthPortalUrl ? (
            <div className="ks-panel p-8">
              <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-[var(--ks-ink)]">Sign in to SteelBuild Pro</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--ks-muted)]">
                Use your company account. The first person to sign in becomes the administrator and can invite the rest of the team.
              </p>
              <Button className="mt-7 h-11 w-full text-[14.5px]" onClick={() => startLogin()}>
                Continue to sign in
              </Button>
            </div>
          ) : (
            <PasswordSignIn />
          )}
          <p className="mt-6 text-center text-[12px] text-[var(--ks-muted)]">Access is limited to authorized company users.</p>
        </div>
      </div>
    </div>
  );
}

export function AccessBlocked({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--ks-bone)] p-8">
      <div className="ks-panel w-full max-w-md p-7">
        <div className="mb-5 flex items-center gap-3">
          <BrandGlyph size={40} />
          <div className="text-[13px] font-medium text-[var(--ks-muted)]">SteelBuild Pro</div>
        </div>
        <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--ks-ink)]">Your account can't sign in yet</h2>
        <p className="mt-2 text-[14px] text-[var(--ks-ink-2)]">{message}</p>
        <p className="mt-2 text-[14px] text-[var(--ks-muted)]">Ask your SteelBuild Pro administrator to activate your account or change your access type.</p>
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

/** Email + password sign-in for self-hosted installs. The first account becomes the administrator. */
function PasswordSignIn() {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [setupRequired, setSetupRequired] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/local/status", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then((s: { setupRequired?: boolean } | null) => {
        if (s?.setupRequired) {
          setSetupRequired(true);
          setMode("register");
        }
      })
      .catch(() => {});
  }, []);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") await post("/api/auth/local/register", { name, email, password });
      else await post("/api/auth/local/login", { email, password });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const register = mode === "register";
  return (
    <form className="ks-panel p-8" onSubmit={submit} noValidate>
      <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-[var(--ks-ink)]">
        {setupRequired ? "Set up SteelBuild Pro" : register ? "Create your account" : "Sign in to SteelBuild Pro"}
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--ks-muted)]">
        {setupRequired
          ? "No administrator exists yet. This first account becomes the administrator and can invite the rest of the team."
          : register
            ? "Use the email your administrator added for you."
            : "Use your company email and password."}
      </p>
      <div className="mt-6 space-y-4">
        {register && (
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
            autoComplete={register ? "new-password" : "current-password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {register && <p className="text-[12px] text-[var(--ks-muted)]">At least 10 characters.</p>}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-6 h-11 w-full text-[14.5px]" disabled={busy}>
        {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
      </Button>
      {!setupRequired && (
        <button
          type="button"
          className="mt-4 w-full text-center text-[13px] text-[var(--ks-accent-ink,var(--ks-ink-2))] underline-offset-2 hover:underline"
          onClick={() => {
            setMode(register ? "signin" : "register");
            setError(null);
          }}
        >
          {register ? "Already have an account? Sign in" : "Invited by your administrator? Create your account"}
        </button>
      )}
    </form>
  );
}
