import { PageHeader, TabStrip } from "@/components/brand/Layout";
import {
  DailyApprovalQueue,
  ExpenseApprovalQueue,
  TimeApprovalQueue,
} from "@/features/time/ApprovalQueues";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";

export default function Approvals() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab") ?? "time";
  const active =
    requested === "expenses"
      ? "expenses"
      : ["daily", "daily-reports", "dailyReports"].includes(requested)
        ? "daily"
        : "time";
  const badges = trpc.ref.badges.useQuery();
  function select(key: string) {
    const params = new URLSearchParams(search);
    params.set("tab", key);
    navigate(`${location}?${params.toString()}`, { replace: true });
  }
  return (
    <>
      <PageHeader
        eyebrow="Review / post / invoice"
        title="Approvals"
        subtitle="Review crew hours, job expenses and daily field reports. Reject with a correction reason."
      />
      <div className="px-6 pt-2">
        <TabStrip
          active={active}
          onSelect={select}
          tabs={[
            { key: "time", label: "Time", badge: badges.data?.time },
            {
              key: "expenses",
              label: "Expenses",
              badge: badges.data?.expenses,
            },
            { key: "daily", label: "Daily reports", badge: badges.data?.daily },
          ]}
        />
      </div>
      <div className="p-6">
        {active === "time" ? (
          <TimeApprovalQueue />
        ) : active === "expenses" ? (
          <ExpenseApprovalQueue />
        ) : (
          <DailyApprovalQueue />
        )}
      </div>
    </>
  );
}
