import { diffDays } from "@/lib/format";

/** + means later. Deadline comparisons explicitly use calendar days. */
export function deadlineVariance(
  deadline: string | null,
  finish: string | null
) {
  return deadline && finish ? diffDays(deadline, finish) : null;
}
export function varianceLabel(days: number | null, unit = "days") {
  return days == null
    ? "No comparison"
    : days === 0
      ? "On date"
      : `${Math.abs(days)} ${unit} ${days > 0 ? "late" : "early"}`;
}
