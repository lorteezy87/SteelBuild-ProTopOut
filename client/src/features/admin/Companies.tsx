import { useState } from "react";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
import { COMPANY_TYPES } from "@shared/domain";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/brand/Controls";
import {
  ReferenceEditor,
  DraftFields,
  text,
  nullableText,
  flag,
  type Draft,
} from "./Editor";
function Contacts({ id }: { id: number }) {
  const { company } = useRefData();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>({
    name: "",
    title: "",
    email: "",
    phone: "",
  });
  const upsert = trpc.admin.companies.upsertContact.useMutation({
    onSuccess: () => {
      setEditing(undefined);
      void utils.ref.all.invalidate();
      toast.success("Contact saved");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const remove = trpc.admin.companies.removeContact.useMutation({
    onSuccess: () => utils.ref.all.invalidate(),
    onError: e => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="label-caps">Contacts</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(null);
            setDraft({ name: "", title: "", email: "", phone: "" });
          }}
        >
          New contact
        </Button>
      </div>
      <table className="tp-table">
        <thead>
          <tr>
            <th>Name / title</th>
            <th>Email / phone</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {company(id)?.contacts.map(c => (
            <tr key={c.id}>
              <td>
                <button
                  className="text-left hover:text-[var(--tp-accent-ink)]"
                  onClick={() => {
                    setEditing(c.id);
                    setDraft({
                      name: c.name,
                      title: c.title,
                      email: c.email,
                      phone: c.phone,
                    });
                  }}
                >
                  {c.name}
                  <span className="block text-xs text-muted-foreground">
                    {c.title}
                  </span>
                </button>
              </td>
              <td>
                {c.email}
                <span className="block text-xs text-muted-foreground">
                  {c.phone}
                </span>
              </td>
              <td>
                <ConfirmButton
                  title="Remove contact?"
                  destructive
                  onConfirm={() => remove.mutate({ id: c.id })}
                >
                  Remove
                </ConfirmButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!company(id)?.contacts.length && (
        <p className="text-muted-foreground">
          No contacts. Add the GC, fabricator or field contact.
        </p>
      )}
      {editing !== undefined && (
        <div className="space-y-3 border border-[var(--tp-rule)] p-3">
          <DraftFields
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "title", label: "Title" },
              { key: "email", label: "Email", type: "email" },
              { key: "phone", label: "Phone" },
            ]}
            draft={draft}
            onChange={setDraft}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!text(draft, "name").trim() || upsert.isPending}
              onClick={() =>
                upsert.mutate({
                  id: editing ?? undefined,
                  companyId: id,
                  name: text(draft, "name"),
                  title: nullableText(draft, "title"),
                  email: nullableText(draft, "email"),
                  phone: nullableText(draft, "phone"),
                })
              }
            >
              Save contact
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
export default function Companies() {
  const { ref } = useRefData();
  const save = trpc.admin.companies.upsert.useMutation();
  return (
    <ReferenceEditor
      title="Company"
      description="GCs, fabricators, detailers, EORs and vendors. Fabrication is by others; keep supplier contacts current."
      rows={ref?.companies ?? []}
      columns={[
        { label: "Name", cell: r => r.name },
        {
          label: "Type",
          cell: r =>
            COMPANY_TYPES[r.type as keyof typeof COMPANY_TYPES] ?? r.type,
        },
        { label: "Email", cell: r => r.email ?? "—" },
        { label: "Phone", cell: r => r.phone ?? "—" },
        { label: "Contacts", cell: r => r.contacts.length },
        { label: "Active", cell: r => (r.isActive ? "Yes" : "No") },
      ]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "type", label: "Type", type: "select", options: COMPANY_TYPES },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone" },
        { key: "address", label: "Address", type: "textarea" },
        { key: "notes", label: "Notes", type: "textarea" },
        { key: "isActive", label: "Active", type: "check" },
      ]}
      defaults={{
        name: "",
        type: "other",
        email: "",
        phone: "",
        address: "",
        notes: "",
        isActive: true,
      }}
      onSave={(d, id) =>
        save.mutateAsync({
          id,
          name: text(d, "name"),
          type: text(d, "type"),
          email: nullableText(d, "email"),
          phone: nullableText(d, "phone"),
          address: nullableText(d, "address"),
          notes: nullableText(d, "notes"),
          isActive: flag(d, "isActive"),
        })
      }
      extra={id => <Contacts key={id} id={id} />}
    />
  );
}
