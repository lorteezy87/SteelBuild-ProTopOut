import { useEffect, useState } from "react";
import { toast } from "sonner";
import { parseGateRefusal } from "@shared/gate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Starting a sequence whose ready-to-erect gate isn't ready needs a reason. The server refuses with a
 * GATE_REASON_NEEDED message; `withGate` catches that, asks here, and retries with the reasons.
 */
type Ask = { items: { taskId: number; name: string }[]; text: string; resolve: (r: Record<string, string> | null) => void };
let open: ((a: Ask) => void) | null = null;

const messageOf = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "");
export const isGateRefusal = (e: unknown) => parseGateRefusal(messageOf(e)) != null;

export async function withGate<T>(run: (reasons?: Record<string, string>) => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (e) {
    const g = parseGateRefusal(messageOf(e));
    if (!g || !open) throw e;
    const reasons = await new Promise<Record<string, string> | null>(resolve => open!({ ...g, resolve }));
    if (!reasons) {
      toast.message("Not started — a reason is needed while the gate is open.");
      return undefined;
    }
    return await run(reasons);
  }
}

/** Mount once (AppShell). */
export function GateReasonHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  useEffect(() => {
    open = a => {
      setText({});
      setAsk(a);
    };
    return () => {
      open = null;
    };
  }, []);
  const items = ask?.items.length ? ask.items : [{ taskId: 0, name: "" }];
  const ids = items.map(i => i.taskId);
  const done = (r: Record<string, string> | null) => {
    ask?.resolve(r);
    setAsk(null);
  };
  const ready = ids.every(id => (text[String(id)] ?? "").trim().length >= 3);
  // A single-task update comes back as taskId 0: the caller reads reasons["0"].
  return (
    <Dialog open={!!ask} onOpenChange={o => !o && done(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ready-to-erect gate is open</DialogTitle>
          <DialogDescription>{ask?.text}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {items.map(({ taskId: id, name }) => (
            <label key={id} className="block space-y-1">
              <span className="label-caps">{name ? `Reason for ${name}` : "Reason to start anyway"}</span>
              <Textarea maxLength={500} value={text[String(id)] ?? ""} onChange={e => setText(t => ({ ...t, [String(id)]: e.target.value }))} placeholder="e.g. AB survey accepted verbally by GC super; written copy to follow" />
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => done(null)}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => done(Object.fromEntries(ids.map(id => [String(id), (text[String(id)] ?? "").trim()])))}>
            Start with reason
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
