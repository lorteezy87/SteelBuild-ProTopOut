/** Lightweight facade: three.js is downloaded only when a WebGL 3D view is mounted. */
import { Component, Suspense, lazy, type ReactNode } from "react";
import { SEL_COLOR, TONES, type Model, type Tone } from "./space";
import { sequenceColor, type ColorBy, type ViewerProps } from "./three/types";
export type { CamView, ColorBy } from "./three/types";

const LazyViewer = lazy(() => import("./three/Viewer3D"));
let glOk: boolean | null = null;
/** Current three.js needs WebGL 2. Release the small capability-probe context immediately. */
export const webglOk = () => {
  if (glOk != null) return glOk;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    glOk = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    glOk = false;
  }
  return glOk;
};

class ViewerBoundary extends Component<
  { children: ReactNode; onNoGL: () => void; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onNoGL();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function View3D(props: ViewerProps) {
  return (
    <ViewerBoundary onNoGL={props.onNoGL} fallback={<PlanView {...props} />}>
      <Suspense
        fallback={
          <div
            className="grid h-full place-items-center text-[13px] text-muted-foreground"
            role="status"
          >
            Loading steel model…
          </div>
        }
      >
        <LazyViewer {...props} />
      </Suspense>
    </ViewerBoundary>
  );
}

const toneVar = (t: Tone) => {
  const tone = TONES.find(q => q[0] === t) || TONES[0];
  return `var(${tone[2]}, ${tone[3]})`;
};
/** SVG plan remains available without loading three.js, with the same selection and color controls. */
export function PlanView({
  model,
  sel,
  selected,
  colorBy = "steel",
  onPick,
}: {
  model: Model;
  sel: string | null;
  selected?: string[];
  colorBy?: ColorBy;
  onPick: (key: string | null, additive?: boolean) => void;
}) {
  const points = [
    ...model.pieces.flatMap(q => [q.p0, q.p1]),
    ...model.cols.map(c => c.xy),
  ];
  if (!points.length) return null;
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  points.forEach(([x, y]) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  });
  x0 -= 5;
  x1 += 5;
  y0 -= 5;
  y1 += 5;
  const sw = Math.max(x1 - x0, y1 - y0) / 400,
    chosen = new Set(selected ?? (sel ? [sel] : []));
  const color = (q: { key: string; tone: Tone; seq: string }) =>
    chosen.has(q.key)
      ? SEL_COLOR[1]
      : colorBy === "review"
        ? toneVar(q.tone)
        : colorBy === "sequence"
          ? sequenceColor(q.seq, model.seqs)
          : "var(--tp-ink-2, #76818b)";
  return (
    <svg
      role="img"
      aria-label="Plan of the pieces"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === "Escape") onPick(null);
      }}
      onClick={() => onPick(null)}
      viewBox={[x0, -y1, x1 - x0, y1 - y0].join(" ")}
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--tp-accent)]"
    >
      {model.pieces.map(q => (
        <g
          key={q.key}
          onClick={e => {
            e.stopPropagation();
            onPick(q.key, e.shiftKey || e.ctrlKey || e.metaKey);
          }}
          className="cursor-pointer"
        >
          <title>{[q.mark, q.size].filter(Boolean).join(" · ")}</title>
          <line
            x1={q.p0[0]}
            y1={-q.p0[1]}
            x2={q.p1[0]}
            y2={-q.p1[1]}
            stroke="transparent"
            strokeWidth={sw * 8}
          />
          <line
            x1={q.p0[0]}
            y1={-q.p0[1]}
            x2={q.p1[0]}
            y2={-q.p1[1]}
            stroke={color(q)}
            strokeWidth={
              chosen.has(q.key) ? sw * 3 : q.k === "joist" ? sw : sw * 1.8
            }
            strokeDasharray={
              q.k === "joist" ? `${sw * 3} ${sw * 2}` : undefined
            }
          />
        </g>
      ))}
      {model.cols.map(c => (
        <rect
          key={c.key}
          x={c.xy[0] - sw * 3}
          y={-c.xy[1] - sw * 3}
          width={sw * 6}
          height={sw * 6}
          onClick={e => {
            e.stopPropagation();
            onPick(c.key, e.shiftKey || e.ctrlKey || e.metaKey);
          }}
          className="cursor-pointer"
          fill={color(c)}
        >
          <title>{[c.mark, c.size].filter(Boolean).join(" · ")}</title>
        </rect>
      ))}
    </svg>
  );
}
