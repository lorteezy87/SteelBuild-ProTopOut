/** Crew certifications: what expires, when it's due, and what a classification requires. */

export const CERT_TYPES = {
  nccco_operator: { label: "NCCCO Crane Operator", expires: true },
  nccco_rigger1: { label: "NCCCO Rigger Level I", expires: true },
  nccco_rigger2: { label: "NCCCO Rigger Level II", expires: true },
  nccco_signal: { label: "NCCCO Signalperson", expires: true },
  fall_protection: { label: "Fall Protection", expires: true },
  cpr_first_aid: { label: "CPR / First Aid", expires: true },
  osha10: { label: "OSHA 10", expires: false },
  osha30: { label: "OSHA 30", expires: false },
  aws_welder: { label: "AWS / D1.1 Welder Qualification", expires: true },
  other: { label: "Other", expires: true },
} as const satisfies Record<string, { label: string; expires: boolean }>;

export type CertType = keyof typeof CERT_TYPES;
export const CERT_TYPE_KEYS = Object.keys(CERT_TYPES) as CertType[];
export const CERT_TYPE_LABELS = Object.fromEntries(CERT_TYPE_KEYS.map(k => [k, CERT_TYPES[k].label])) as Record<CertType, string>;

/** Expiring within this many calendar days shows as due. */
export const CERT_WARN_DAYS = 30;

export type CertStatus = "current" | "expiring" | "expired" | "unknown" | "no_expiry";

/** `{date}` is filled in by the screen. */
export const CERT_STATUS_LABEL: Record<CertStatus, string> = {
  current: "Current",
  expiring: "Expires {date}",
  expired: "Expired {date}",
  unknown: "Expiry unknown",
  no_expiry: "No expiry",
};

export const certTypeLabel = (t: string) => (CERT_TYPES as Record<string, { label: string }>)[t]?.label ?? t;
const expires = (t: string) => (CERT_TYPES as Record<string, { expires: boolean }>)[t]?.expires ?? true;

function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A type that expires but has no date entered is unknown — never current. The expiry day itself is still valid. */
export function certStatus(c: { certType: string; expiresOn: string | null }, today: string): CertStatus {
  if (!expires(c.certType)) return "no_expiry";
  if (!c.expiresOn) return "unknown";
  if (c.expiresOn < today) return "expired";
  if (c.expiresOn <= plusDays(today, CERT_WARN_DAYS)) return "expiring";
  return "current";
}

const VALID = new Set<CertStatus>(["current", "expiring", "no_expiry"]);

/** Required types this person can't show a valid card for on the given day. An unknown expiry doesn't count as valid. */
export function crewCertGaps(required: string[], certs: { certType: string; expiresOn: string | null }[], onDate: string): string[] {
  const out: string[] = [];
  for (const type of required) {
    const mine = certs.filter(c => c.certType === type).map(c => certStatus(c, onDate));
    if (mine.some(s => VALID.has(s))) continue;
    out.push(mine.includes("unknown") ? `${certTypeLabel(type)} (expiry unknown)` : certTypeLabel(type));
  }
  return out;
}

const RANK: Partial<Record<CertStatus, number>> = { expired: 0, expiring: 1, unknown: 2 };

/**
 * Today panel, judged per person and type (like crewCertGaps and the matrix): a renewed card clears the
 * lapsed one. A pair with no valid card shows its most informative card — the latest dated one, else unknown.
 * Expired first, then by date (unknown dates last).
 */
export function certsDue(certs: { id: number; userId: number; name: string; certType: string; expiresOn: string | null }[], today: string) {
  const groups = new Map<string, typeof certs>();
  for (const c of certs) {
    const k = `${c.userId}:${c.certType}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const out: { id: number; userId: number; label: string; date: string | null; status: CertStatus }[] = [];
  for (const cards of groups.values()) {
    const rated = cards.map(c => ({ c, status: certStatus(c, today) }));
    if (rated.some(r => r.status === "current" || r.status === "no_expiry")) continue;
    const dated = rated.filter(r => r.c.expiresOn != null).sort((a, b) => b.c.expiresOn!.localeCompare(a.c.expiresOn!));
    const pick = dated[0] ?? rated[0];
    if (RANK[pick.status] == null) continue;
    out.push({ id: pick.c.id, userId: pick.c.userId, label: `${pick.c.name} · ${certTypeLabel(pick.c.certType)}`, date: pick.c.expiresOn, status: pick.status });
  }
  return out.sort((a, b) => (a.status === "expired" ? 0 : 1) - (b.status === "expired" ? 0 : 1) || (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.id - b.id);
}
