import { Link } from "wouter";
import { Shield, ChevronRight } from "lucide-react";
import {
  PageHeader,
  EmptyState,
  Loading,
  ErrorState,
} from "@/components/ks/Layout";
import { useRefData } from "@/lib/ref";
import Users from "@/features/admin/Users";
import Roles from "@/features/admin/Roles";
import Assignments from "@/features/admin/Assignments";
import Workspaces from "@/features/admin/Workspaces";
import JobRoles from "@/features/admin/JobRoles";
import Calendars from "@/features/admin/Calendars";
import Companies from "@/features/admin/Companies";
import Equipment from "@/features/admin/Equipment";
import Codes from "@/features/admin/Codes";
import CustomFields from "@/features/admin/CustomFields";
import Workflows from "@/features/admin/Workflows";
import Settings from "@/features/admin/Settings";
import Integrations from "@/features/admin/Integrations";
import Demo from "@/features/admin/Demo";
const sections = [
  { key: "users", label: "People", group: "Access", component: Users },
  { key: "roles", label: "Security roles", group: "Access", component: Roles },
  {
    key: "assignments",
    label: "Role assignments",
    group: "Access",
    component: Assignments,
  },
  {
    key: "workspaces",
    label: "Workspaces",
    group: "Reference data",
    component: Workspaces,
  },
  {
    key: "job-roles",
    label: "Job roles & rates",
    group: "Reference data",
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
  {
    key: "integrations",
    label: "Integrations",
    group: "Configuration",
    component: Integrations,
  },
  {
    key: "demo",
    label: "Demo & maintenance",
    group: "Configuration",
    component: Demo,
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
        eyebrow={`${ref?.org.name ?? "SteelBuild Pro"} · Administration`}
        title={current?.label ?? "Administration"}
        subtitle="Organization-wide configuration. Changes apply to every job."
      />
      <div className="flex flex-col md:flex-row">
        <nav
          aria-label="Administration sections"
          className="shrink-0 border-b border-[var(--ks-rule)] bg-[var(--ks-paper)] p-3 md:w-52 md:border-b-0 md:border-r"
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
                  className={`flex items-center justify-between gap-2 border-l-2 px-3 py-2 text-[12px] ${key === s.key ? "border-[var(--ks-accent)] bg-[var(--ks-accent-soft)] font-semibold text-[var(--ks-ink)]" : "border-transparent text-muted-foreground hover:bg-[var(--ks-bone)] hover:text-foreground"}`}
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
                  className="text-[var(--ks-accent-ink)] underline"
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
