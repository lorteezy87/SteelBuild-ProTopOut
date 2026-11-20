import { cn } from "@/lib/utils";
import { COST_HEALTH, PRIORITIES, SCHEDULE_HEALTH } from "@shared/domain";

/* ------------------------------------------------------------------ */
/* Brand: the SteelBuild Pro diamond-plate badge (from steelbuild-pro  */
/* .com). The artwork sits on Foundry Black (#0B0E11), so it is shown  */
/* on that ground: the side menu, the sign-in panel, or a dark tile.   */
/* ------------------------------------------------------------------ */
export const BRAND_BADGE = "/brand/steelbuild-pro-badge-480.webp";
export const BRAND_BADGE_LG = "/brand/steelbuild-pro-badge-960.webp";
export const BRAND_ICON = "/brand/steelbuild-pro-icon-96.webp";

/** Square app icon (dark tile with the badge). */
export function BrandGlyph({ size = 28, className }: { size?: number; className?: string; hole?: string }) {
  return (
    <img
      src={BRAND_ICON}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("shrink-0 rounded-md bg-[var(--ks-graphite)] object-cover", className)}
    />
  );
}

/**
 * Full logo: the diamond-plate badge. `size` sets its width.
 * Always placed on Foundry Black (`light` kept for older call sites).
 */
export function Wordmark({
  className,
  size = "md",
  width,
}: {
  className?: string;
  light?: boolean;
  tagline?: boolean;
  size?: "sm" | "md" | "lg";
  width?: number;
}) {
  const w = width ?? (size === "lg" ? 420 : size === "sm" ? 132 : 200);
  return (
    <img
      src={size === "lg" ? BRAND_BADGE_LG : BRAND_BADGE}
      width={w}
      height={Math.round((w * 317) / 480)}
      alt="SteelBuild Pro"
      draggable={false}
      className={cn("block h-auto max-w-full select-none", className)}
      style={{ width: w }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Status pills: soft tint, round dot, sentence case. Every tone's    */
/* text meets 4.5:1 on its tint.                                       */
/* ------------------------------------------------------------------ */
export type Tone = "green" | "amber" | "red" | "blue" | "gray" | "orange" | "ink" | "hazard";

const TONE: Record<Tone, string> = {
  green: "bg-[var(--ks-green-soft)] text-[var(--ks-green)] ring-[color-mix(in_srgb,var(--ks-green)_22%,transparent)]",
  amber: "bg-[var(--ks-amber-soft)] text-[var(--ks-amber)] ring-[color-mix(in_srgb,var(--ks-amber)_24%,transparent)]",
  red: "bg-[var(--ks-red-soft)] text-[var(--ks-red-strong)] ring-[color-mix(in_srgb,var(--ks-red-strong)_22%,transparent)]",
  blue: "bg-[var(--ks-blue-soft)] text-[var(--ks-blue)] ring-[color-mix(in_srgb,var(--ks-blue)_20%,transparent)]",
  gray: "bg-[var(--ks-gray-soft)] text-[var(--ks-ink-2)] ring-[var(--ks-rule)]",
  orange: "bg-[var(--ks-accent-soft)] text-[var(--ks-accent-ink)] ring-[color-mix(in_srgb,var(--ks-accent-ink)_20%,transparent)]",
  ink: "bg-[var(--ks-solid)] text-white ring-[var(--ks-solid)]",
  hazard: "bg-[var(--ks-hold)] text-white ring-[var(--ks-hold)]",
};

const DOT: Record<Tone, string> = {
  green: "bg-[var(--ks-green)]",
  amber: "bg-[var(--ks-amber)]",
  red: "bg-[var(--ks-red)]",
  blue: "bg-[var(--ks-blue)]",
  gray: "bg-[var(--ks-muted)]",
  orange: "bg-[var(--ks-accent)]",
  ink: "bg-[var(--ks-solid-ink)]",
  hazard: "bg-[var(--ks-brand)]",
};

/**
 * `dot` adds a round status dot before the label. `hazard` (delayed, late,
 * over budget) switches a soft pill to the solid red exception style.
 */
export function Pill({ tone = "gray", children, className, dot, hazard }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean; hazard?: boolean }) {
  const solidRed = hazard && tone === "red";
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium leading-none ring-1 ring-inset",
        solidRed ? "bg-[var(--ks-red-fill)] text-white ring-[var(--ks-red-fill)]" : TONE[tone],
        className
      )}
    >
      {(dot || tone === "hazard") && <span className={cn("size-1.5 shrink-0 rounded-full", solidRed ? "bg-[var(--ks-solid-ink)]" : DOT[tone])} />}
      {children}
    </span>
  );
}

export const scheduleTone = (h: string | null | undefined): Tone =>
  h === "delayed" ? "red" : h === "at_risk" ? "amber" : h === "on_track" ? "green" : h === "blocked" ? "hazard" : h === "done" ? "blue" : "gray";

export const costTone = (h: string | null | undefined): Tone =>
  h === "overbudget" ? "red" : h === "at_risk" ? "amber" : h === "on_track" ? "green" : "gray";

export function ScheduleHealth({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const label = SCHEDULE_HEALTH[value as keyof typeof SCHEDULE_HEALTH] ?? value;
  return (
    <Pill tone={scheduleTone(value)} dot className={className}>
      {label}
    </Pill>
  );
}

export function CostHealth({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const label = COST_HEALTH[value as keyof typeof COST_HEALTH] ?? value;
  return (
    <Pill tone={costTone(value)} dot className={className}>
      {label}
    </Pill>
  );
}

export function PriorityBadge({ value }: { value: string | null | undefined }) {
  if (!value || value === "normal") return <span className="text-[12.5px] text-muted-foreground">Normal</span>;
  const tone: Tone = value === "critical" ? "red" : value === "high" ? "amber" : "gray";
  return <Pill tone={tone}>{PRIORITIES[value as keyof typeof PRIORITIES] ?? value}</Pill>;
}

export function SlaBadge({ value }: { value: string | null | undefined }) {
  if (value === "delayed") return <Pill tone="red" dot>Delayed</Pill>;
  if (value === "at_risk") return <Pill tone="amber" dot>At risk</Pill>;
  return <Pill tone="green" dot>On time</Pill>;
}

export function DeliveryRiskBadge({ value }: { value: string | null | undefined }) {
  if (value === "late") return <Pill tone="red" dot>Late</Pill>;
  if (value === "at_risk") return <Pill tone="amber" dot>At risk</Pill>;
  if (value === "received") return <Pill tone="blue" dot>Received</Pill>;
  return <Pill tone="green" dot>On schedule</Pill>;
}

/**
 * Workflow state chip. The state's own color (admin-chosen hex, possibly
 * light) drives the dot and a faint tint; the label stays ink so it is
 * always readable.
 */
export function StateChip({ name, color, category }: { name: string; color?: string | null; category?: string | null }) {
  const c = color || (category === "end" ? "var(--ks-muted)" : category === "start" ? "var(--ks-blue)" : "var(--ks-accent-ink)");
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium leading-none text-[var(--ks-ink)] ring-1 ring-inset"
      style={{ background: `color-mix(in srgb, ${c} 10%, var(--ks-paper))`, ["--tw-ring-color" as string]: `color-mix(in srgb, ${c} 32%, var(--ks-rule))` }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: c }} />
      {name}
    </span>
  );
}

/** Slim rounded progress bar with optional planned marker. */
export function ProgressBar({ value, planned, className, tone = "orange" }: { value: number; planned?: number | null; className?: string; tone?: "orange" | "green" | "ink" }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const fill = tone === "green" ? "bg-[var(--ks-green)]" : tone === "ink" ? "bg-[var(--ks-ink)]" : "bg-[var(--ks-accent)]";
  return (
    <div className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--ks-gray-soft)]", className)}>
      <div className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${v}%` }} />
      {planned != null && (
        <div className="absolute inset-y-0 w-[2px] bg-[var(--ks-ink)]/70" style={{ left: `calc(${Math.max(0, Math.min(100, planned))}% - 1px)` }} />
      )}
    </div>
  );
}
