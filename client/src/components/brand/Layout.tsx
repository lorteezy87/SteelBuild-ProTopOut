import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/** Standard page header: small eyebrow, title, optional subtitle, actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3 border-b border-[var(--tp-rule)] bg-[var(--tp-paper)] px-6 pb-5 pt-6", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="label-caps mb-1">{eyebrow}</div>}
        <h1 className="tp-display truncate text-[24px] leading-tight text-[var(--tp-ink)]">{title}</h1>
        {subtitle && <div className="mt-1 text-[14px] text-[var(--tp-muted)]">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Fact strip: label over value, hairline dividers. Pass cells as [label, value] pairs. */
export function TitleBlock({ cells, className }: { cells: { label: string; value: ReactNode; wide?: boolean }[]; className?: string }) {
  const cols = cells.map(c => (c.wide ? "minmax(220px,2.2fr)" : "minmax(110px,1fr)")).join(" ");
  return (
    <div className={cn("title-block overflow-x-auto", className)} style={{ gridTemplateColumns: cols }}>
      {cells.map((c, i) => (
        <div key={i}>
          <div className="label-caps">{c.label}</div>
          <div className="mt-1 truncate text-[14px] font-medium text-[var(--tp-ink)]">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("tp-panel flex min-w-0 flex-col", className)}>
      {(title || actions) && (
        <header className="tp-panel-head">
          <div className="tp-section-title min-w-0 truncate">{title}</div>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

/** KPI card: label with an optional tone dot, large tabular figure, optional sub line. */
export function Kpi({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "green" | "amber" | "red" | "orange" | "gray";
  className?: string;
}) {
  const dot =
    tone === "green"
      ? "bg-[var(--tp-green)]"
      : tone === "amber"
        ? "bg-[var(--tp-amber)]"
        : tone === "red"
          ? "bg-[var(--tp-red)]"
          : tone === "orange"
            ? "bg-[var(--tp-accent)]"
            : null;
  return (
    <div className={cn("tp-panel px-5 py-4", className)}>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--tp-muted)]">
        {dot && <span className={cn("size-2 shrink-0 rounded-full", dot)} />}
        {label}
      </div>
      <div className="num mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] text-[var(--tp-ink)]">{value}</div>
      {sub && <div className="mt-2 text-[12.5px] text-[var(--tp-muted)]">{sub}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {icon && <div className="text-[var(--tp-muted)]">{icon}</div>}
      <div className="tp-section-title">{title}</div>
      {body && <div className="max-w-md text-[13.5px] text-[var(--tp-muted)]">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-12 text-[13.5px] text-[var(--tp-ink-2)]", className)}>
      <Loader2 className="size-4 animate-spin text-[var(--tp-accent)]" />
      {label}
    </div>
  );
}

export function ErrorState({ error, className }: { error: unknown; className?: string }) {
  const msg = error && typeof error === "object" && "message" in error ? String((error as { message: string }).message) : "Failed to load";
  return (
    <div className={cn("m-6 flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--tp-red-strong)_30%,white)] bg-[var(--tp-red-soft)] px-4 py-3 text-[13.5px] text-[var(--tp-red-strong)]", className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>{msg}</div>
    </div>
  );
}

/** Label + value row for detail drawers. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label-caps mb-1">{label}</div>
      <div className="min-w-0 text-[13.5px]">{children}</div>
    </div>
  );
}

/** Horizontal tab strip for sub-pages: medium-weight labels, 2px navy underline. */
export function TabStrip({ tabs, active, onSelect, className }: { tabs: { key: string; label: ReactNode; badge?: ReactNode }[]; active: string; onSelect: (key: string) => void; className?: string }) {
  return (
    <div className={cn("flex gap-0 overflow-x-auto border-b border-[var(--tp-rule)]", className)}>
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors",
            active === t.key ? "border-[var(--tp-accent-ink)] text-[var(--tp-ink)]" : "border-transparent text-[var(--tp-muted)] hover:text-[var(--tp-ink)]"
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}
