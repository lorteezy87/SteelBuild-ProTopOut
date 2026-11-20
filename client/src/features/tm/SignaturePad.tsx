import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Finger/stylus/mouse signature on a canvas; Accept hands back a PNG data URL. */
export function SignaturePad({ onAccept, onCancel, busy }: { onAccept: (png: string) => void; onCancel: () => void; busy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio);
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#111";
  }, []);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setInked(false);
  };
  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        aria-label="Signature pad"
        className="h-44 w-full touch-none rounded-md border border-dashed border-[var(--tp-rule)] bg-white"
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const g = e.currentTarget.getContext("2d")!;
          const p = at(e);
          g.beginPath();
          g.moveTo(p.x, p.y);
        }}
        onPointerMove={e => {
          if (!drawing.current) return;
          const g = e.currentTarget.getContext("2d")!;
          const p = at(e);
          g.lineTo(p.x, p.y);
          g.stroke();
          setInked(true);
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)}
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={clear}>Clear</Button>
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="ml-auto" disabled={!inked || busy} onClick={() => onAccept(ref.current!.toDataURL("image/png"))}>
          Accept signature
        </Button>
      </div>
    </div>
  );
}
