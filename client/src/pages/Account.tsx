import { Field, Loading, PageHeader, Panel } from "@/components/brand/Layout";
import { ChangePassword } from "@/features/settings/ChangePassword";
import { useRefData } from "@/lib/ref";

export default function Account() {
  const { ref } = useRefData();
  if (!ref) return <Loading />;
  return (
    <>
      <PageHeader eyebrow="Owner" title="Account" subtitle="Your login for SteelBuild Pro TopOut." />
      <div className="space-y-5 p-6">
        <Panel title="Profile" bodyClassName="p-5">
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Name">{ref.me.name ?? "—"}</Field>
            <Field label="Email">{ref.me.email ?? "—"}</Field>
          </div>
        </Panel>
        <ChangePassword />
      </div>
    </>
  );
}
