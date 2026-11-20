import { useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/brand/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errMsg } from "@/lib/format";
import { trpc } from "@/lib/trpc";

export function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = trpc.account.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Password changed");
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: e => toast.error(errMsg(e)),
  });
  const mismatch = confirm.length > 0 && confirm !== next;
  return (
    <Panel title="Change password" bodyClassName="p-5">
      <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">Current password</Label>
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-next">New password</Label>
          <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-confirm">Confirm new password</Label>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
        </div>
      </div>
      {mismatch && <p className="mt-2 text-[13px] text-destructive">The new passwords don't match.</p>}
      <Button
        className="mt-4"
        disabled={!current || next.length < 10 || mismatch || confirm !== next || change.isPending}
        onClick={() => change.mutate({ current, next })}
      >
        {change.isPending ? "Saving…" : "Change password"}
      </Button>
    </Panel>
  );
}
