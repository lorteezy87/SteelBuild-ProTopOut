import { Link } from "wouter";
import { Shield, ChevronRight } from "lucide-react";
import {
  PageHeader,
  EmptyState,
  Loading,
  ErrorState,
} from "@/components/brand/Layout";
import { useRefData } from "@/lib/ref";
import Crew from "@/features/settings/Crew";
import JobRoles from "@/features/admin/JobRoles";
import Calendars from "@/features/admin/Calendars";
import Companies from "@/features/admin/Companies";
import Equipment from "@/features/admin/Equipment";
import Cranes from "@/features/settings/Cranes";
import Certifications from "@/features/settings/Certifications";
import Codes from "@/features/admin/Codes";
import CustomFields from "@/features/admin/CustomFields";
import Workflows from "@/features/admin/Workflows";
import Settings from "@/features/admin/Settings";
const sections = [
  { key: "users", label: "Crew", group: "People & rates", component: Crew },
  { key: "certifications", label: "Certifications", group: "People & rates", component: Certifications },
  {
    key: "job-roles",
    label: "Classifications & rates",
    group: "People & rates",
    component: JobRoles,
  },
  {
    key: "calendars",
    label: "Work calendars",
    group: "Reference data",
    component: Calendars,
  },
  {
    key: "companies",
    label: "Companies & contacts",
    group: "Reference data",
    component: Companies,
  },
  {
    key: "equipment",
    label: "Equipment",
    group: "Reference data",
    component: Equipment,
  },
  {
    key: "cranes",
    label: "Cranes & load charts",
    group: "Reference data",
    component: Cranes,
  },
  {
    key: "codes",
    label: "Time & expense codes",
    group: "Reference data",
    component: Codes,
  },
  {
    key: "custom-fields",
    label: "Custom fields",
    group: "Configuration",
    component: CustomFields,
  },
  {
    key: "workflows",
    label: "Workflow log apps",
    group: "Configuration",
    component: Workflows,
  },
  {
    key: "settings",
    label: "Organization settings",
    group: "Configuration",
    component: Settings,
  },
];
export default function AdminLayout({
  params,
}: {
  params?: { section?: string };
}) {
  const { ref, isAdmin, isLoading, error } = useRefData();
  const key = params?.section ?? "users";
  const current = sections.find(s => s.key === key);
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  if (!isAdmin)
    return (
      <EmptyState
        icon={<Shield className="size-7" />}
        title="Organization admin access required"
        body="Ask an organization admin to manage people, security and configuration."
      />
    );
  const Component = current?.component;
  return (
    <div>
      <PageHeader
        eyebrow={`${ref?.org.name ?? "SteelBuild Pro TopOut"} · Settings`}
        title={current?.label ?? "Settings"}
        subtitle="Crew, rates, reference data and configuration. Changes apply to every job."
      />
      <div className="flex flex-col md:flex-row">
        <nav
          aria-label="Settings sections"
          className="shrink-0 border-b border-[var(--tp-rule)] bg-[var(--tp-paper)] p-3 md:w-52 md:border-b-0 md:border-r"
        >
          <div className="flex flex-wrap gap-1 md:block">
            {sections.map((s, i) => (
              <div key={s.key}>
                {(i === 0 || sections[i - 1].group !== s.group) && (
                  <div className="label-caps mb-1 mt-4 hidden px-3 first:mt-0 md:block">
                    {s.group}
                  </div>
                )}
                <Link
                  href={`/admin/${s.key}`}
                  aria-current={key === s.key ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 border-l-2 px-3 py-2 text-[12px] ${key === s.key ? "border-[var(--tp-accent)] bg-[var(--tp-accent-soft)] font-semibold text-[var(--tp-ink)]" : "border-transparent text-muted-foreground hover:bg-[var(--tp-bone)] hover:text-foreground"}`}
                >
                  {s.label}
                  {key === s.key && <ChevronRight className="size-3.5" />}
                </Link>
              </div>
            ))}
          </div>
        </nav>
        <main className="min-w-0 flex-1 p-5 lg:p-6">
          {Component ? (
            <Component key={key} />
          ) : (
            <EmptyState
              title="Unknown admin section"
              body="Choose a section from the left."
              action={
                <Link
                  href="/admin/users"
                  className="text-[var(--tp-accent-ink)] underline"
                >
                  Open people
                </Link>
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}
