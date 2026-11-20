/**
 * Model forms (SteelBuild src/modules/model/forms.jsx): a job's settings (lift allowance, column base elevation, the
 * joist list), a read's level and top of steel, and a piece (added by hand from the viewer's Draw missed piece, placed
 * for a label the reader couldn't place, or fixed).
 */
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RecordDrawer, SimpleSelect } from "@/components/ks/Controls";
import { MD, elevText, type Kind, type PieceFields, type ReadRec, type Settings } from "./domain";
import { MS } from "./space";

function Row({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-caps">{label}</span>
      {children}
      {error ? <span className="text-[12px] text-[var(--ks-red-strong)]">{error}</span> : hint ? <span className="text-[12px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** The job's weights and base: used in its piece lists, lift weights, totals and the 3D model. */
export function SettingsDrawer({ open, onClose, cfg, version, onSave }: { open: boolean; onClose: () => void; cfg: Settings; version: number; onSave: (s: Settings, expectedVersion: number) => Promise<boolean> }) {
  const [allow, setAllow] = useState(String(cfg.allow || 0));
  const [base, setBase] = useState(elevText(cfg.base));
  const [jw, setJw] = useState(cfg.jw.map(x => x.mark + " " + x.lb).join("\n"));
  const [expectedVersion] = useState(version);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const parsed = MD.parseJw(jw);
  const a = allow.trim();
  const errs = {
    allow: a && !(/^\d{1,2}(\.\d{1,2})?$/.test(a) && +a <= 50) ? "A percentage from 0 to 50" : "",
    base: base.trim() && MS.ft(base) == null ? "Feet and inches, like 0'-0\" or -4'-6\"" : "",
    jw: parsed.bad.length ? "Each line needs a mark and a weight in pounds, like “T12 1950”." : "",
  };
  const save = async () => {
    setTried(true);
    if (errs.allow || errs.base || errs.jw) return;
    setBusy(true);
    const ok = await onSave({ allow: +a || 0, base: base.trim() ? MS.ft(base) : null, jw: parsed.jw }, expectedVersion);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <RecordDrawer
      open={open}
      onOpenChange={o => !o && onClose()}
      eyebrow="Model"
      title="Weights and base"
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            Save weights
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground">Used in this job’s piece lists, lift weights, totals and the 3D model.</p>
        <Row label="Allowance for connections (%)" hint="Added to every piece’s weight. 0 = bare steel." error={tried ? errs.allow : ""}>
          <Input className="num w-32 bg-[var(--ks-paper)]" inputMode="decimal" value={allow} onChange={e => setAllow(e.target.value)} />
        </Row>
        <Row label="Column base elevation" hint="In the 3D model, where the lowest columns start. Blank: 12 ft below their level." error={tried ? errs.base : ""}>
          <Input className="num w-40 bg-[var(--ks-paper)]" placeholder={"0'-0\""} value={base} onChange={e => setBase(e.target.value)} />
        </Row>
        <Row
          label="Joist weights (one per line: mark and pounds per joist)"
          error={tried ? errs.jw : ""}
          hint={
            parsed.bad.length
              ? "Can’t read: " + parsed.bad.slice(0, 3).join(" · ") + (parsed.bad.length > 3 ? " …" : "")
              : parsed.jw.length
                ? parsed.jw.length + " joist marks"
                : "Paste from the joist supplier’s list. Joists without one show no weight."
          }
        >
          <Textarea className="num min-h-48 bg-[var(--ks-paper)]" placeholder={"T12 1950\nT13 2100\nJ145 640"} value={jw} onChange={e => setJw(e.target.value)} />
        </Row>
      </div>
    </RecordDrawer>
  );
}

/** A read's level and top-of-steel elevation, set by hand: where its pieces sit in the 3D model. */
export function LevelDrawer({ rec, sheet, onClose, onSave }: { rec: ReadRec; sheet: string; onClose: () => void; onSave: (lvl: string, tos: number | null) => Promise<boolean> }) {
  const [lvl, setLvl] = useState(rec.lvl);
  const [tos, setTos] = useState(elevText(rec.tos));
  const [busy, setBusy] = useState(false);
  const bad = tos.trim() && MS.ft(tos) == null;
  const save = async () => {
    if (bad) return;
    setBusy(true);
    const ok = await onSave(lvl.trim().slice(0, 30), tos.trim() ? MS.ft(tos) : null);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <RecordDrawer
      open
      onOpenChange={o => !o && onClose()}
      eyebrow="Level"
      title={sheet + " Rev " + rec.rev + (rec.pg > 1 ? " page " + rec.pg : "")}
      width={440}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !!bad}>
            Save level
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Row label="Level" hint={rec.lvlBy === "read" && lvl.trim() === rec.lvl ? "From the sheet title" : "Sheets with the same level are filtered together."}>
          <Input className="bg-[var(--ks-paper)]" placeholder="Level 2, Roof" value={lvl} onChange={e => setLvl(e.target.value)} />
        </Row>
        <Row
          label="Top of steel elevation"
          error={bad ? "Feet and inches, like 13'-6\"" : ""}
          hint={rec.tosBy === "read" && tos.trim() === elevText(rec.tos) ? "From the drawing’s top-of-steel note" : "Feet and inches, as the drawings give it. Blank: not known (shown at 0)."}
        >
          <Input className="num w-40 bg-[var(--ks-paper)]" placeholder={"13'-6\""} value={tos} onChange={e => setTos(e.target.value)} />
        </Row>
      </div>
    </RecordDrawer>
  );
}

/** A piece's kind, mark, size and note (Add missed piece, Place a label, Fix piece). Inline, for the viewer's side panel. */
export function PieceForm({
  title,
  sub,
  init,
  saveLabel,
  onSave,
  onCancel,
}: {
  title: string;
  sub: string;
  init: PieceFields;
  saveLabel: string;
  onSave: (f: PieceFields) => Promise<unknown> | void;
  onCancel: () => void;
}) {
  const [k, setK] = useState<Kind>(init.k === "joist" ? "joist" : "beam");
  const [mark, setMark] = useState(init.mark);
  const [size, setSize] = useState(init.size);
  const [note, setNote] = useState(init.note || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const w = MD.lbPerFt(size);
  const sizeHint =
    k === "joist"
      ? "Its weight comes from the job’s joist list, by mark."
      : !size.trim()
        ? "As on the drawing, e.g. W18X35 or HSS6X6X1/4"
        : w
          ? (w.approx ? "About " : "") + w.lb + " lb per foot" + (w.approx ? " (from its dimensions)" : "")
          : "Not a shape the weight can be worked out for";
  const save = async () => {
    if (!mark.trim() && !size.trim()) return setErr("Give the piece a mark or a size.");
    setBusy(true);
    try {
      await onSave({ k, mark, size, note });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-3 flex flex-col gap-2.5 border border-[var(--ks-rule)] bg-[var(--ks-paper)] p-3">
      <div>
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[12px] text-muted-foreground">{sub}</div>
      </div>
      <Row label="Kind">
        <SimpleSelect
          size="sm"
          value={k}
          onChange={v => setK(v === "joist" ? "joist" : "beam")}
          options={[
            { value: "beam", label: "Beam, girder or HSS" },
            { value: "joist", label: "Joist or joist girder" },
          ]}
        />
      </Row>
      <Row label="Piece mark" hint="As the drawing labels it (optional for a beam with a size)." error={err}>
        <Input className="num h-8 bg-[var(--ks-paper)]" placeholder="B1220 or T12" value={mark} onChange={e => (setMark(e.target.value), setErr(""))} />
      </Row>
      <Row label="Size" hint={sizeHint}>
        <Input className="num h-8 bg-[var(--ks-paper)]" placeholder={k === "joist" ? "26K9" : "W18X40"} value={size} onChange={e => (setSize(e.target.value), setErr(""))} />
      </Row>
      <Row label="Note">
        <Input className="h-8 bg-[var(--ks-paper)]" placeholder="Why it was added or fixed (optional)" value={note} onChange={e => setNote(e.target.value)} />
      </Row>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={busy}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
