import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { ConfirmButton, RecordDrawer } from "@/components/brand/Controls";
import { EmptyState } from "@/components/brand/Layout";
import { Button } from "@/components/ui/button";
import { DraftFields, SaveBar, type Draft, type EditorField } from "@/features/admin/Editor";

export type Column<R> = { label: string; cell: (r: R) => ReactNode; right?: boolean; className?: string };

/**
 * A register table with a drawer editor: used by the Phase 3 logs (QC, toolbox talks, certifications, rentals).
 * The caller converts the draft to its input, so blank stays null (unknown) instead of 0.
 */
export function RecordList<R extends { id: number }>(props: {
  rows: R[];
  columns: Column<R>[];
  fields: EditorField[] | ((d: Draft) => EditorField[]);
  noun: string;
  empty: { title: string; body: string };
  blank: Draft;
  toDraft: (r: R) => Draft;
  validate?: (d: Draft) => string | null;
  onSave: (d: Draft, row: R | null) => Promise<unknown>;
  onDelete?: (r: R) => Promise<unknown>;
  rowActions?: (r: R) => ReactNode;
  drawerExtra?: (r: R) => ReactNode;
  editable?: boolean;
  minWidth?: number;
  toolbar?: ReactNode;
}) {
  const { rows, columns, noun, editable = true } = props;
  const [open, setOpen] = useState<R | null | undefined>();
  const [draft, setDraft] = useState<Draft>(props.blank);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = (r: R | null) => {
    setOpen(r);
    setError(null);
    setDraft(r ? props.toDraft(r) : { ...props.blank });
  };
  const fields = typeof props.fields === "function" ? props.fields(draft) : props.fields;
  const save = async () => {
    const problem = props.validate?.(draft) ?? null;
    if (problem) return setError(problem);
    setPending(true);
    try {
      await props.onSave(draft, open ?? null);
      setOpen(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">{props.toolbar}</div>
        {editable && (
          <Button size="sm" onClick={() => start(null)}>
            <Plus className="size-3.5" /> {noun}
          </Button>
        )}
      </div>
      {!rows.length ? (
        <EmptyState title={props.empty.title} body={props.empty.body} />
      ) : (
        <div className="overflow-x-auto">
          <table className="tp-table" style={props.minWidth ? { minWidth: props.minWidth } : undefined}>
            <thead>
              <tr>
                {columns.map(c => (
                  <th key={c.label} className={c.right ? "right" : undefined}>{c.label}</th>
                ))}
                {props.rowActions && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={editable ? "cursor-pointer" : undefined} onClick={() => editable && start(r)}>
                  {columns.map(c => (
                    <td key={c.label} className={[c.right ? "right" : "", c.className ?? ""].join(" ")}>{c.cell(r)}</td>
                  ))}
                  {props.rowActions && <td className="right" onClick={e => e.stopPropagation()}>{props.rowActions(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RecordDrawer
        open={open !== undefined}
        onOpenChange={o => !o && setOpen(undefined)}
        eyebrow={noun}
        title={open ? `Edit ${noun.toLowerCase()}` : `New ${noun.toLowerCase()}`}
        footer={
          <div className="flex items-center justify-between gap-2">
            {open && props.onDelete ? (
              <ConfirmButton destructive title={`Delete this ${noun.toLowerCase()}?`} body="This can't be undone." confirmLabel="Delete" onConfirm={async () => { await props.onDelete!(open); setOpen(undefined); }}>Delete</ConfirmButton>
            ) : <span />}
            <SaveBar pending={pending} onSave={save} onCancel={() => setOpen(undefined)} />
          </div>
        }
      >
        <div className="space-y-4">
          {error && <p role="alert" className="text-sm text-[var(--tp-red)]">{error}</p>}
          <DraftFields fields={fields} draft={draft} onChange={setDraft} />
          {open && props.drawerExtra?.(open)}
        </div>
      </RecordDrawer>
    </div>
  );
}
