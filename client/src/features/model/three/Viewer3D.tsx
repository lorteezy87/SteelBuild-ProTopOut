import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MD } from "../domain";
import { SteelScene } from "./SteelScene";
import type { CamView, ViewerProps } from "./types";

type Hover = { key: string; x: number; y: number } | null;
type Transition = {
  start: number;
  duration: number;
  fromEye: THREE.Vector3;
  toEye: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
};

class SteelViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 5000);
  readonly controls: OrbitControls;
  readonly steel: SteelScene;
  private frame = 0;
  private stopped = false;
  private animation: Transition | null = null;
  private resize: ResizeObserver;
  private theme: MutationObserver;
  private pointers = new Map<number, { x: number; y: number }>();
  private press: {
    x: number;
    y: number;
    moved: boolean;
    multi: boolean;
    button: number;
  } | null = null;
  private lastTap: {
    time: number;
    key: string | null;
    x: number;
    y: number;
  } | null = null;
  private hoverFrame = 0;
  private hoverPosition: { x: number; y: number } | null = null;
  private hovered: string | null = null;
  private selected: string[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    model: ViewerProps["model"],
    private pick: ViewerProps["onPick"],
    private hover: (value: Hover) => void,
    private noGL: () => void
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x000000, 0);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.65;
    this.controls.panSpeed = 0.85;
    this.controls.zoomSpeed = 0.8;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.015;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    // OrbitControls natively switches left-drag to pan with Shift/Ctrl/Cmd; a still click remains additive selection.
    try {
      this.steel = new SteelScene(this.renderer, model);
    } catch (error) {
      this.controls.dispose();
      this.renderer.dispose();
      throw error;
    }
    const radius = Math.max(
      5,
      this.steel.bounds.getSize(new THREE.Vector3()).length() / 2
    );
    this.controls.minDistance = Math.max(0.8, radius / 150);
    this.controls.maxDistance = radius * 18;
    this.camera.far = Math.max(1000, radius * 50);
    this.camera.near = Math.max(0.01, radius / 10000);
    this.controls.addEventListener("change", this.invalidate);
    this.controls.addEventListener("start", this.controlStart);
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.cancel);
    canvas.addEventListener("pointerleave", this.leave);
    canvas.addEventListener("dblclick", this.doubleClick);
    canvas.addEventListener("keydown", this.keydown);
    canvas.addEventListener("webglcontextlost", this.contextLost);
    this.resize = new ResizeObserver(this.resized);
    this.resize.observe(canvas);
    this.theme = new MutationObserver(() => {
      this.steel.updateTheme();
      this.invalidate();
    });
    this.theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    this.resized();
    this.setView("3d", false);
  }
  private contextLost = (e: Event) => {
    e.preventDefault();
    this.animation = null;
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.hoverFrame);
    this.noGL();
  };
  private controlStart = () => {
    this.animation = null;
    this.hovered = null;
    this.hoverPosition = null;
    this.steel.setHover(null);
    this.hover(null);
  };
  private resized = () => {
    if (this.stopped) return;
    const w = Math.max(1, this.canvas.clientWidth),
      h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  };
  invalidate = () => {
    if (!this.stopped && !this.frame)
      this.frame = requestAnimationFrame(this.draw);
  };
  private draw = (time: number) => {
    this.frame = 0;
    if (this.stopped) return;
    if (this.animation) {
      const a = this.animation,
        t = Math.min(1, (time - a.start) / a.duration),
        eased = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(a.fromEye, a.toEye, eased);
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, eased);
      if (t >= 1) this.animation = null;
    }
    const moving = this.controls.update();
    try {
      this.renderer.render(this.steel.scene, this.camera);
    } catch {
      this.noGL();
      return;
    }
    if (moving || this.animation) this.invalidate();
  };
  setSelected(keys: string[]) {
    this.selected = keys;
    this.steel.setSelected(keys);
    this.steel.setHover(
      this.hovered && !keys.includes(this.hovered) ? this.hovered : null
    );
    this.invalidate();
  }
  private smoothTo(
    eye: THREE.Vector3,
    target: THREE.Vector3,
    animate: boolean
  ) {
    // Clear existing damping momentum before a preset to prevent its tail from fighting the animation.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (!animate || reduced) {
      this.animation = null;
      this.camera.position.copy(eye);
      this.controls.target.copy(target);
      this.controls.update();
    } else
      this.animation = {
        start: performance.now(),
        duration: 500,
        fromEye: this.camera.position.clone(),
        toEye: eye,
        fromTarget: this.controls.target.clone(),
        toTarget: target,
      };
    this.invalidate();
  }
  setView(view: CamView["v"], animate = true, box = this.steel.bounds) {
    const center = box.getCenter(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov),
      horizontalFov =
        2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    let direction =
      view === "fit"
        ? this.camera.position.clone().sub(this.controls.target).normalize()
        : new THREE.Vector3(0.9, -1.25, 0.9).normalize();
    if (view === "top")
      direction = new THREE.Vector3(0, -0.0001, 1).normalize();
    if (direction.lengthSq() < 0.5)
      direction = new THREE.Vector3(0.9, -1.25, 0.9).normalize();
    const right = new THREE.Vector3()
      .crossVectors(direction.clone().negate(), this.camera.up)
      .normalize();
    const up = new THREE.Vector3()
      .crossVectors(right, direction.clone().negate())
      .normalize();
    let distance = this.controls.minDistance * 1.2;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const offset = new THREE.Vector3(x, y, z).sub(center),
            depth = offset.dot(direction);
          distance = Math.max(
            distance,
            depth + Math.abs(offset.dot(right)) / Math.tan(horizontalFov / 2),
            depth + Math.abs(offset.dot(up)) / Math.tan(verticalFov / 2)
          );
        }
    distance = Math.min(this.controls.maxDistance * 0.95, distance * 1.14);
    this.smoothTo(
      center.clone().addScaledVector(direction, distance),
      center,
      animate
    );
  }
  private focus(key: string) {
    const box = this.steel.pieceBounds.get(key);
    if (box) this.setView("fit", true, box);
  }
  private down = (e: PointerEvent) => {
    this.canvas.focus({ preventScroll: true });
    this.hover(null);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1)
      this.press = {
        x: e.clientX,
        y: e.clientY,
        moved: false,
        multi: e.shiftKey || e.ctrlKey || e.metaKey,
        button: e.button,
      };
    else if (this.press) this.press.moved = true;
    this.canvas.style.cursor = "grabbing";
  };
  private move = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) {
      if (
        this.press &&
        Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 5
      )
        this.press.moved = true;
      return;
    }
    if (e.pointerType === "touch") return;
    this.hoverPosition = { x: e.clientX, y: e.clientY };
    if (!this.hoverFrame)
      this.hoverFrame = requestAnimationFrame(() => {
        this.hoverFrame = 0;
        if (!this.hoverPosition || this.stopped || this.pointers.size) return;
        const { x, y } = this.hoverPosition,
          key = this.steel.pick(x, y, this.camera),
          rect = this.canvas.getBoundingClientRect();
        if (key !== this.hovered) {
          this.hovered = key;
          this.steel.setHover(key && !this.selected.includes(key) ? key : null);
          this.invalidate();
        }
        this.canvas.style.cursor = key ? "pointer" : "grab";
        this.hover(
          key
            ? {
                key,
                x: Math.min(rect.width - 175, Math.max(8, x - rect.left + 14)),
                y: Math.min(rect.height - 58, Math.max(8, y - rect.top + 14)),
              }
            : null
        );
      });
  };
  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size) return;
    const press = this.press;
    this.press = null;
    this.canvas.style.cursor = "grab";
    if (!press || press.moved || press.button !== 0) return;
    const key = this.steel.pick(e.clientX, e.clientY, this.camera);
    this.pick(key, press.multi);
    if (e.pointerType === "touch") {
      const last = this.lastTap,
        now = performance.now();
      if (
        key &&
        last?.key === key &&
        now - last.time < 330 &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < 25
      ) {
        this.focus(key);
        this.lastTap = null;
      } else this.lastTap = { time: now, key, x: e.clientX, y: e.clientY };
    }
  };
  private cancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.press = null;
    this.canvas.style.cursor = "grab";
  };
  private leave = () => {
    this.hoverPosition = null;
    this.hovered = null;
    this.steel.setHover(null);
    this.hover(null);
    this.invalidate();
  };
  private doubleClick = (e: MouseEvent) => {
    const key = this.steel.pick(e.clientX, e.clientY, this.camera);
    if (key) {
      e.preventDefault();
      this.focus(key);
    }
  };
  private keydown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "f") this.setView("fit");
    else if (key === "t") this.setView("top");
    else if (key === "a") this.setView("3d");
    else if (key === "escape") this.pick(null);
    else return;
    e.preventDefault();
  };
  dispose() {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.hoverFrame);
    this.resize.disconnect();
    this.theme.disconnect();
    this.controls.removeEventListener("change", this.invalidate);
    this.controls.removeEventListener("start", this.controlStart);
    this.controls.dispose();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.cancel);
    this.canvas.removeEventListener("pointerleave", this.leave);
    this.canvas.removeEventListener("dblclick", this.doubleClick);
    this.canvas.removeEventListener("keydown", this.keydown);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    // React reuses this canvas when filters change. Forcing context loss here would poison its next renderer.
    this.steel.dispose();
    this.renderer.dispose();
  }
}

export default function Viewer3D(props: ViewerProps) {
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef<SteelViewer | null>(null),
    latest = useRef(props);
  latest.current = props;
  const [hover, setHover] = useState<Hover>(null);
  useEffect(() => {
    if (!canvas.current) return;
    let viewer: SteelViewer;
    try {
      viewer = new SteelViewer(
        canvas.current,
        props.model,
        (key, additive) => latest.current.onPick(key, additive),
        setHover,
        () => latest.current.onNoGL()
      );
      engine.current = viewer;
      viewer.steel.setColorBy(latest.current.colorBy ?? "steel");
      viewer.setSelected(
        latest.current.selected ??
          (latest.current.sel ? [latest.current.sel] : [])
      );
    } catch {
      latest.current.onNoGL();
      return;
    }
    return () => {
      engine.current = null;
      viewer.dispose();
    };
  }, [props.model]);
  useEffect(() => {
    engine.current?.setSelected(
      props.selected ?? (props.sel ? [props.sel] : [])
    );
  }, [props.selected, props.sel]);
  useEffect(() => {
    if (engine.current) {
      engine.current.steel.setColorBy(props.colorBy ?? "steel");
      engine.current.invalidate();
    }
  }, [props.colorBy]);
  useEffect(() => {
    if (props.view) engine.current?.setView(props.view.v);
  }, [props.view]);
  const member = hover
    ? props.model.pieces.find(q => q.key === hover.key) ||
      props.model.cols.find(q => q.key === hover.key)
    : null;
  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvas}
        role="img"
        aria-label={props.label || "3D structural steel model"}
        aria-description="Drag to orbit. Right-drag or Shift-drag to pan. Scroll to zoom. Double-click to focus. F fits the model, T looks from above, A shows an angle, Escape clears selection. Shift, Control or Command-click toggles multiple pieces."
        tabIndex={0}
        onContextMenu={e => e.preventDefault()}
        className="block h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ks-accent)]"
      />
      {hover && member && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-48 rounded-md border border-[var(--ks-rule)] bg-[var(--ks-paper)] px-2.5 py-1.5 text-[11px] text-[var(--ks-ink)] shadow-md"
          style={{ left: hover.x, top: hover.y }}
        >
          <b className="num block truncate">
            {member.mark || ("len" in member ? "Piece" : "Column")}
          </b>
          <span>
            {member.size || "Unknown section"}
            {"len" in member
              ? " · " + MD.feet(member.len)
              : " · " + MD.feet(member.z1 - member.z0)}
          </span>
        </div>
      )}
    </div>
  );
}
