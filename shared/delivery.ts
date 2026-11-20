export type DeliveryRisk = "late" | "at_risk" | "ok" | "received";

/**
 * Load risk against the sequence need-on-site date.
 * late    = needed date passed without receipt, or received after need date
 * at_risk = promised after need date, or received short / damaged
 */
export function deliveryRisk(
  d: { needDate: string | null; promisedDate: string | null; receivedDate: string | null; status: string },
  today: string
): DeliveryRisk {
  const received = d.status === "received" || d.status === "received_short" || d.status === "damaged";
  if (received) {
    if (d.needDate && d.receivedDate && d.receivedDate > d.needDate) return "late";
    if (d.status !== "received") return "at_risk";
    return "received";
  }
  if (d.needDate && today > d.needDate) return "late";
  if (d.needDate && d.promisedDate && d.promisedDate > d.needDate) return "at_risk";
  return "ok";
}
