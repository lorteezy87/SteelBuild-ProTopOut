/** Markups drawn in SVG whose user units are page units. k = screen px per page unit (strokes and tags stay a fixed screen size). */
import { memo, type ReactNode } from "react";
import { HIGHLIGHT, centroid, cloudArcs, measureText, toPage, type Mark, type P2 } from "./marks";

const HALO = "#fbfaf8";

export type ShapeProps = {
  kind: string;
  pts: P2[];
  color: string;
  /** N1… shown in a tag at the first point */
  tag?: string | null;
  /** the note (text markups show it on the drawing) */
  note?: string | null;
  k: number;
  W: number;
  H: number;
  fpu: number | null;
  selected?: boolean;
  /** a shape being drawn (no tag, measurements live) */
  live?: boolean;
};

export function Shape({ kind, pts, color: col, tag, note, k, W, H, fpu, selected, live }: ShapeProps) {
  if (!pts.length) return null;
  const sw = 1.6 / k,
    sw2 = selected ? sw * 2.2 : sw * 1.4;
  const a = pts[0],
    b = pts[pts.length - 1];
  const x0 = Math.min(a[0], b[0]),
    y0 = Math.min(a[1], b[1]),
    w = Math.abs(a[0] - b[0]),
    h = Math.abs(a[1] - b[1]);
  const label = (t: string, at: P2) => (
    <text
      x={at[0]}
      y={at[1]}
      fontSize={13 / k}
      fill={col}
      textAnchor="middle"
      fontFamily="IBM Plex Mono, ui-monospace, monospace"
      stroke={HALO}
      strokeWidth={3 / k}
      paintOrder="stroke"
    >
      {t}
    </text>
  );
  const tagEl =
    !live && tag ? (
      <g>
        <rect x={a[0] + 4 / k} y={a[1] - 18 / k} width={(tag.length * 7 + 8) / k} height={15 / k} fill="#1b1f23" />
        <text x={a[0] + 8 / k} y={a[1] - 7 / k} fontSize={11 / k} fill="#fbfaf8" fontFamily="IBM Plex Mono, ui-monospace, monospace">
          {tag}
        </text>
      </g>
    ) : null;
  let body: ReactNode = null;
  if (kind === "rect") body = <rect x={x0} y={y0} width={w} height={h} fill="none" stroke={col} strokeWidth={sw2} />;
  else if (kind === "highlight")
    body = <rect x={x0} y={y0} width={w} height={h} fill={HIGHLIGHT} fillOpacity={0.35} stroke={selected ? col : "none"} strokeWidth={sw} />;
  else if (kind === "cloud") {
    const arcs = cloudArcs(x0, y0, w, h, W, H);
    body = <path d={`M${x0} ${y0}` + arcs.map(q => ` A${q.r} ${q.r} 0 0 1 ${q.x} ${q.y}`).join("")} fill="none" stroke={col} strokeWidth={sw2} />;
  } else if (kind === "arrow" || kind === "length" || kind === "cal" || kind.startsWith("plugin:")) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]),
      hl = 12 / k;
    const head: P2[] | null =
      kind === "arrow"
        ? [
            [b[0] - hl * Math.cos(ang - 0.4), b[1] - hl * Math.sin(ang - 0.4)],
            [b[0] - hl * Math.cos(ang + 0.4), b[1] - hl * Math.sin(ang + 0.4)],
          ]
        : null;
    const tick = (p: P2) => {
      const t = 6 / k,
        nx = -Math.sin(ang) * t,
        ny = Math.cos(ang) * t;
      return <line x1={p[0] - nx} y1={p[1] - ny} x2={p[0] + nx} y2={p[1] + ny} stroke={col} strokeWidth={sw2} />;
    };
    const lab = kind === "length" ? measureText("length", pts, fpu) : kind === "cal" ? "known length" : "";
    body = (
      <>
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={col} strokeWidth={kind.startsWith("plugin:") ? sw * 2 : sw2} strokeLinecap="round" />
        {head && <polygon points={[b, ...head].map(p => p.join(",")).join(" ")} fill={col} />}
        {!head && !kind.startsWith("plugin:") && tick(a)}
        {!head && !kind.startsWith("plugin:") && tick(b)}
        {lab && label(lab, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 6 / k])}
      </>
    );
  } else if (kind === "area") {
    body = (
      <>
        <polygon points={pts.map(p => p.join(",")).join(" ")} fill={col} fillOpacity={0.12} stroke={col} strokeWidth={sw2} strokeLinejoin="round" />
        {pts.length >= 3 && label(measureText("area", pts, fpu), centroid(pts))}
      </>
    );
  } else if (kind === "count")
    body = pts.map((p, i) => (
      <g key={i}>
        <circle cx={p[0]} cy={p[1]} r={9 / k} fill={col} fillOpacity={0.9} />
        <text x={p[0]} y={p[1] + 4 / k} fontSize={10 / k} textAnchor="middle" fill={HALO} fontFamily="IBM Plex Mono, ui-monospace, monospace">
          {i + 1}
        </text>
      </g>
    ));
  else if (kind === "pen")
    body = <polyline points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke={col} strokeWidth={sw2} strokeLinejoin="round" strokeLinecap="round" />;
  else if (kind === "text") {
    const fs = Math.max(W, H) * 0.008,
      t = note || "…";
    body = (
      <>
        <text x={a[0]} y={a[1]} fontSize={fs} fill={col} fontWeight={600} stroke={HALO} strokeWidth={Math.max(W, H) * 0.0025} paintOrder="stroke">
          {t}
        </text>
        {selected && (
          <rect x={a[0]} y={a[1] - fs * 1.1} width={fs * 0.55 * t.length} height={fs * 1.4} fill="none" stroke={col} strokeWidth={sw} strokeDasharray={4 / k} />
        )}
      </>
    );
  } else if (kind === "note") {
    const r = (selected ? 11 : 9) / k;
    body = (
      <>
        <path d={`M${a[0]} ${a[1]} l${-r * 0.7} ${-r * 1.4} a${r} ${r} 0 1 1 ${r * 1.4} 0 z`} fill={col} stroke={HALO} strokeWidth={1.5 / k} />
        <circle cx={a[0]} cy={a[1] - r * 2} r={r * 0.4} fill={HALO} />
      </>
    );
    return (
      <g>
        {body}
        {!live && tag && (
          <text
            x={a[0] + r * 1.2}
            y={a[1] - r * 1.6}
            fontSize={11 / k}
            fill={col}
            fontFamily="IBM Plex Mono, ui-monospace, monospace"
            stroke={HALO}
            strokeWidth={3 / k}
            paintOrder="stroke"
          >
            {tag}
          </text>
        )}
      </g>
    );
  }
  return (
    <g>
      {body}
      {tagEl}
    </g>
  );
}

type LayerProps = {
  marks: Mark[];
  W: number;
  H: number;
  k: number;
  fpu: number | null;
  sel: number | null;
  /** a markup being moved or reshaped: its live points (page units) */
  edit: { id: number; pts: P2[] } | null;
  /** markups not on the revision shown are drawn faded */
  rev: number;
};

/** Every stored markup of the page (memoized: drawing a new shape doesn't redraw the rest). */
export const MarkupLayer = memo(function MarkupLayer({ marks, W, H, k, fpu, sel, edit, rev }: LayerProps) {
  return (
    <>
      {marks.map(m => (
        <g key={m.id} opacity={m.rev === rev ? 1 : 0.55}>
          <Shape
            kind={m.kind}
            pts={edit && edit.id === m.id ? edit.pts : toPage(m.points, W, H)}
            color={m.color}
            tag={m.label}
            note={m.note}
            k={k}
            W={W}
            H={H}
            fpu={fpu}
            selected={sel === m.id}
          />
        </g>
      ))}
    </>
  );
});
