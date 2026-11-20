import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PPE_ITEMS, PPE_KEYS, type Attendee, type JhaStep } from "@shared/safety";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check } from "@/features/admin/Editor";
import { useRefData } from "@/lib/ref";

/** Job steps, each with its hazards and controls. */
export function StepsEditor({ steps, onChange }: { steps: JhaStep[]; onChange: (s: JhaStep[]) => void }) {
  const put = (i: number, patch: Partial<JhaStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <div key={i} className="grid gap-2 border border-[var(--tp-rule)] p-3 sm:grid-cols-3">
          <div className="sm:col-span-3 flex items-center justify-between">
            <span className="label-caps">Step {i + 1}</span>
            <Button size="icon" variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
          <Textarea aria-label={`Step ${i + 1} task`} placeholder="Task step" rows={2} value={s.step} onChange={e => put(i, { step: e.target.value })} />
          <Textarea aria-label={`Step ${i + 1} hazards`} placeholder="Hazards" rows={2} value={s.hazards} onChange={e => put(i, { hazards: e.target.value })} />
          <Textarea aria-label={`Step ${i + 1} controls`} placeholder="Controls" rows={2} value={s.controls} onChange={e => put(i, { controls: e.target.value })} />
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...steps, { step: "", hazards: "", controls: "" }])}>
        <Plus className="size-3.5" /> Step
      </Button>
    </div>
  );
}

export function PpePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-x-4 sm:grid-cols-2">
      {PPE_KEYS.map(k => (
        <Check key={k} label={PPE_ITEMS[k]} checked={value.includes(k)} onChange={on => onChange(on ? [...value, k] : value.filter(x => x !== k))} />
      ))}
    </div>
  );
}

/** Sign-in list: tick crew from the roster, or add a visitor by name. */
export function Attendees({ value, onChange }: { value: Attendee[]; onChange: (v: Attendee[]) => void }) {
  const { ref } = useRefData();
  const [visitor, setVisitor] = useState("");
  const crew = (ref?.users ?? []).filter(u => u.isActive);
  const visitors = value.filter(a => a.userId == null);
  return (
    <div className="space-y-2">
      <div className="grid gap-x-4 sm:grid-cols-2">
        {crew.map(u => (
          <Check
            key={u.id}
            label={u.name ?? `#${u.id}`}
            checked={value.some(a => a.userId === u.id)}
            onChange={on => onChange(on ? [...value, { userId: u.id, name: u.name ?? `#${u.id}` }] : value.filter(a => a.userId !== u.id))}
          />
        ))}
      </div>
      {visitors.length > 0 && (
        <ul className="text-sm">
          {visitors.map(a => (
            <li key={a.name} className="flex items-center gap-2">
              {a.name} (visitor)
              <Button size="sm" variant="ghost" onClick={() => onChange(value.filter(x => x !== a))}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input aria-label="Visitor name" placeholder="Visitor / other trade" value={visitor} onChange={e => setVisitor(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={!visitor.trim()}
          onClick={() => {
            onChange([...value, { userId: null, name: visitor.trim() }]);
            setVisitor("");
          }}
        >
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{value.length} signed in</p>
    </div>
  );
}
