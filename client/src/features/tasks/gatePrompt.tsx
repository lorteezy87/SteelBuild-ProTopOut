import { useEffect, useState } from "react";
import type { GateRefusal } from "@shared/gate";
import { setGatePrompter } from "./gateRetry";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export { GateCancelled, isGateRefusal, withGate } from "./gateRetry";

type Ask = GateRefusal & { resolve: (r: Record<string, string> | null) => void };

/** Mount once (AppShell). */
export function GateReasonHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  useEffect(() => {
    setGatePrompter(
      g =>
        new Promise(resolve => {
          setText({});
          setAsk({ ...g, resolve });
        }),
    );
    return () => setGatePrompter(null);
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
