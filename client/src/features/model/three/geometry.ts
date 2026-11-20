import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MCol, MPiece, Shape as MemberShape } from "../space";

const inches = (text: string | undefined, fallback: number) => {
  if (!text) return fallback;
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  const value = fraction ? +fraction[1] / +fraction[2] : Number(text);
  return value > 0 && Number.isFinite(value) ? value : fallback;
};

export type SectionKind = "I" | "C" | "L" | "HSS" | "box";
export const sectionKind = (size: string, shape: MemberShape): SectionKind => {
  const s = size.toUpperCase().replace(/\s/g, "");
  if (/^(C|MC)\d/.test(s)) return "C";
  if (/^L\d/.test(s)) return "L";
  if (/^HSS/.test(s)) return "HSS";
  return shape.t === "I" ? "I" : "box";
};

function roundedRect(
  path: THREE.Path,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
  const r = Math.min(radius, w / 2, h / 2);
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  path.closePath();
}

/** Cross section x = flange width, y = vertical; its top is always y = 0. */
export function sectionProfile(
  size: string,
  nominal: MemberShape
): THREE.Shape {
  const d = Math.max(0.1, nominal.d / 12),
    b = Math.max(0.1, nominal.b / 12);
  const kind = sectionKind(size, nominal);
  const clean = size.toUpperCase().replace(/\s/g, "");
  const wallText = /^(?:HSS|L)[\d.]+X[\d.]+X([\d./]+)/.exec(clean)?.[1];
  const tf = Math.min(d / 3, (nominal.tf || inches(wallText, 0.375)) / 12);
  const tw = Math.min(b / 3, (nominal.tw || inches(wallText, 0.3125)) / 12);
  const p = new THREE.Shape();
  if (kind === "I") {
    const r = Math.min(tf * 0.65, (b - tw) / 6, (d - 2 * tf) / 6);
    p.moveTo(-b / 2, 0);
    p.lineTo(b / 2, 0);
    p.lineTo(b / 2, -tf);
    p.lineTo(tw / 2 + r, -tf);
    p.quadraticCurveTo(tw / 2, -tf, tw / 2, -tf - r);
    p.lineTo(tw / 2, -d + tf + r);
    p.quadraticCurveTo(tw / 2, -d + tf, tw / 2 + r, -d + tf);
    p.lineTo(b / 2, -d + tf);
    p.lineTo(b / 2, -d);
    p.lineTo(-b / 2, -d);
    p.lineTo(-b / 2, -d + tf);
    p.lineTo(-tw / 2 - r, -d + tf);
    p.quadraticCurveTo(-tw / 2, -d + tf, -tw / 2, -d + tf + r);
    p.lineTo(-tw / 2, -tf - r);
    p.quadraticCurveTo(-tw / 2, -tf, -tw / 2 - r, -tf);
    p.lineTo(-b / 2, -tf);
  } else if (kind === "C") {
    const r = Math.min(tf * 0.6, (b - tw) / 4);
    p.moveTo(-b / 2, 0);
    p.lineTo(b / 2, 0);
    p.lineTo(b / 2, -tf);
    p.lineTo(-b / 2 + tw + r, -tf);
    p.quadraticCurveTo(-b / 2 + tw, -tf, -b / 2 + tw, -tf - r);
    p.lineTo(-b / 2 + tw, -d + tf + r);
    p.quadraticCurveTo(-b / 2 + tw, -d + tf, -b / 2 + tw + r, -d + tf);
    p.lineTo(b / 2, -d + tf);
    p.lineTo(b / 2, -d);
    p.lineTo(-b / 2, -d);
  } else if (kind === "L") {
    p.moveTo(-b / 2, 0);
    p.lineTo(b / 2, 0);
    p.lineTo(b / 2, -tf);
    p.lineTo(-b / 2 + tw, -tf);
    p.lineTo(-b / 2 + tw, -d);
    p.lineTo(-b / 2, -d);
  } else if (kind === "HSS") {
    const wall = Math.min(b / 4, d / 4, inches(wallText, 0.375) / 12);
    roundedRect(p, -b / 2, -d, b, d, wall * 2);
    const hole = new THREE.Path();
    roundedRect(
      hole,
      -b / 2 + wall,
      -d + wall,
      b - wall * 2,
      d - wall * 2,
      wall
    );
    p.holes.push(hole);
  } else {
    roundedRect(p, -b / 2, -d, b, d, Math.min(b, d) * 0.035);
  }
  p.closePath();
  return p;
}

/** Templates are local to one scene and disposed with it, never global GPU resources. */
export class MemberGeometry {
  private profiles = new Map<string, THREE.BufferGeometry>();
  private box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  private rod = new THREE.CylinderGeometry(1, 1, 1, 7).toNonIndexed();
  private nut = new THREE.CylinderGeometry(1, 1, 1, 6).toNonIndexed();

  private profile(size: string, s: MemberShape) {
    const key = `${sectionKind(size, s)}:${size}:${s.d}:${s.b}:${s.tf}:${s.tw}`;
    let g = this.profiles.get(key);
    if (!g) {
      g = new THREE.ExtrudeGeometry(sectionProfile(size, s), {
        depth: 1,
        bevelEnabled: false,
        curveSegments: 3,
        steps: 1,
      });
      if (g.index) {
        const nonIndexed = g.toNonIndexed();
        g.dispose();
        g = nonIndexed;
      }
      this.profiles.set(key, g);
    }
    return g;
  }
  private block(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    l: number
  ) {
    return this.box.clone().scale(w, h, l).translate(x, y, z);
  }
  private bar(a: THREE.Vector3, b: THREE.Vector3, radius: number, hex = false) {
    const delta = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.clone().normalize()
    );
    return (hex ? this.nut : this.rod)
      .clone()
      .scale(radius, delta.length(), radius)
      .applyQuaternion(q)
      .translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
  }
  private combine(geometries: THREE.BufferGeometry[]) {
    const result = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    if (!result) throw new Error("Steel geometry could not be combined");
    result.clearGroups();
    return result;
  }
  piece(q: MPiece): THREE.BufferGeometry | null {
    const dx = q.p1[0] - q.p0[0],
      dy = q.p1[1] - q.p0[1],
      length = Math.hypot(dx, dy);
    if (length < 0.1) return null;
    const transform = new THREE.Matrix4()
      .makeBasis(
        new THREE.Vector3(-dy / length, dx / length, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(dx / length, dy / length, 0)
      )
      .setPosition(q.p0[0], q.p0[1], q.z);
    if (q.shape.t !== "joist")
      return this.profile(q.size, q.shape)
        .clone()
        .scale(1, 1, length)
        .applyMatrix4(transform);
    const depth = Math.max(q.shape.d / 12, 0.5);
    const leg = Math.min(depth / 5, 2 / 12),
      wall = 0.1875 / 12,
      gap = 0.05;
    const chordShape = {
      t: "box" as const,
      d: leg * 12,
      b: leg * 12,
      tf: wall * 12,
      tw: wall * 12,
    };
    const chord = this.profile("L2X2X3/16", chordShape);
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      parts.push(
        chord
          .clone()
          .translate(leg / 2, 0, 0)
          .scale(side, 1, length)
          .translate((side * gap) / 2, 0, 0)
      );
      parts.push(
        chord
          .clone()
          .translate(leg / 2, 0, 0)
          .scale(side, -1, Math.max(0.1, length - 0.8))
          .translate((side * gap) / 2, -depth, 0.4)
      );
    }
    // Warren web: round-bar diagonals, with shorter vertical end posts below the bearing seats.
    const panels = Math.min(
      64,
      Math.max(4, Math.ceil(length / Math.max(depth * 1.2, 2)))
    );
    const start = Math.min(0.4, length / 8),
      span = length - start * 2;
    for (let i = 0; i < panels; i++) {
      const y0 = i % 2 ? -depth + leg / 2 : -leg / 2;
      const y1 = i % 2 ? -leg / 2 : -depth + leg / 2;
      parts.push(
        this.bar(
          new THREE.Vector3(0, y0, start + (span * i) / panels),
          new THREE.Vector3(0, y1, start + (span * (i + 1)) / panels),
          0.026
        )
      );
    }
    for (const end of [start, length - start]) {
      parts.push(
        this.bar(
          new THREE.Vector3(0, -leg / 2, end),
          new THREE.Vector3(0, -depth + leg / 2, end),
          0.03
        )
      );
      parts.push(
        this.block(
          0,
          -leg - 0.02,
          end,
          leg * 2 + gap + 0.12,
          0.04,
          Math.min(0.65, length / 4)
        )
      );
    }
    // Reflections used for paired angles reverse triangle winding. Repair it before merging.
    parts.slice(0, 4).forEach((g, i) => {
      if (i === 0 || i === 3) reverseWinding(g);
    });
    return this.combine(parts).applyMatrix4(transform);
  }
  column(
    q: MCol,
    foundation: boolean
  ): {
    steel: THREE.BufferGeometry;
    bolts: THREE.BufferGeometry | null;
    concrete: THREE.BufferGeometry | null;
  } | null {
    const height = q.z1 - q.z0;
    if (height <= 0) return null;
    const d = Math.max(0.1, q.shape.d / 12),
      b = Math.max(0.1, q.shape.b / 12);
    const steel = [
      this.profile(q.size, q.shape)
        .clone()
        .translate(0, d / 2, 0)
        .scale(1, 1, height)
        .translate(q.xy[0], q.xy[1], q.z0),
    ];
    const plateW = b + 0.55,
      plateD = d + 0.55,
      plateT = foundation ? 0.075 : 0.04;
    steel.push(
      this.block(q.xy[0], q.xy[1], q.z0 + plateT / 2, plateW, plateD, plateT)
    );
    steel.push(
      this.block(q.xy[0], q.xy[1], q.z1 - 0.025, b + 0.14, d + 0.14, 0.05)
    );
    const bolts: THREE.BufferGeometry[] = [];
    if (foundation)
      for (const x of [-1, 1])
        for (const y of [-1, 1]) {
          const bx = q.xy[0] + x * (plateW / 2 - 0.12),
            by = q.xy[1] + y * (plateD / 2 - 0.12);
          bolts.push(
            this.bar(
              new THREE.Vector3(bx, by, q.z0 - 0.05),
              new THREE.Vector3(bx, by, q.z0 + 0.19),
              0.032
            )
          );
          bolts.push(
            this.bar(
              new THREE.Vector3(bx, by, q.z0 + plateT),
              new THREE.Vector3(bx, by, q.z0 + plateT + 0.055),
              0.063,
              true
            )
          );
          bolts.push(
            this.bar(
              new THREE.Vector3(bx, by, q.z0 + plateT - 0.006),
              new THREE.Vector3(bx, by, q.z0 + plateT + 0.012),
              0.078
            )
          );
        }
    const concrete = foundation
      ? this.combine([
          this.block(
            q.xy[0],
            q.xy[1],
            q.z0 - 0.8,
            Math.max(3, plateW + 1),
            Math.max(3, plateD + 1),
            0.55
          ),
          this.block(
            q.xy[0],
            q.xy[1],
            q.z0 - 0.28,
            plateW + 0.25,
            plateD + 0.25,
            0.55
          ),
        ])
      : null;
    return {
      steel: this.combine(steel),
      bolts: bolts.length ? this.combine(bolts) : null,
      concrete,
    };
  }
  dispose() {
    this.profiles.forEach(g => g.dispose());
    this.profiles.clear();
    this.box.dispose();
    this.rod.dispose();
    this.nut.dispose();
  }
}

function reverseWinding(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    const attribute = g.getAttribute(name);
    if (!(attribute instanceof THREE.BufferAttribute)) continue;
    const data = attribute.array,
      stride = attribute.itemSize;
    for (let i = 0; i < attribute.count; i += 3)
      for (let j = 0; j < stride; j++) {
        const a = (i + 1) * stride + j,
          b = (i + 2) * stride + j,
          tmp = data[a];
        data[a] = data[b];
        data[b] = tmp;
      }
  }
}
