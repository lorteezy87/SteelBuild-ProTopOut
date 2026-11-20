import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { MD } from "../domain";
import { project } from "../fixtures";
import { MS, type MPiece } from "../space";
import { MemberGeometry, sectionKind, sectionProfile } from "./geometry";
import { sequenceColor } from "./types";

const factories: MemberGeometry[] = [];
const geometries: THREE.BufferGeometry[] = [];
const factory = () => {
  const f = new MemberGeometry();
  factories.push(f);
  return f;
};
const keep = (g: THREE.BufferGeometry | null) => {
  expect(g).not.toBeNull();
  geometries.push(g!);
  return g!;
};
const piece = (size: string, extra: Partial<MPiece> = {}): MPiece => {
  const { sheets, recs } = project();
  return {
    ...MS.build(sheets, recs, MD.noSettings()).pieces[0],
    size,
    shape: MS.shape({ k: "beam", size }),
    p0: [0, 0],
    p1: [20, 0],
    z: 10,
    ...extra,
  };
};
afterEach(() => {
  geometries.splice(0).forEach(g => g.dispose());
  factories.splice(0).forEach(f => f.dispose());
});

describe("real steel member geometry", () => {
  it("extrudes an I section along the plan line, with a vertical web and its top at top-of-steel", () => {
    const q = piece("W24X55", { p0: [5, 7], p1: [5, 27] });
    const before = JSON.stringify(q),
      geometry = keep(factory().piece(q));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(7);
    expect(box.max.y).toBeCloseTo(27);
    expect(box.max.z).toBeCloseTo(10);
    expect(box.min.z).toBeCloseTo(8);
    expect(box.max.x - box.min.x).toBeCloseTo(q.shape.b / 12);
    expect(JSON.stringify(q)).toBe(before);
    const profile = sectionProfile(q.size, q.shape);
    expect(
      profile.curves.some(c => c instanceof THREE.QuadraticBezierCurve)
    ).toBe(true);
  });
  it("distinguishes channels and angles, and leaves an HSS tube genuinely hollow", () => {
    expect(sectionKind("C12X30", MS.shape({ k: "beam", size: "C12X30" }))).toBe(
      "C"
    );
    expect(
      sectionKind("MC10X25", MS.shape({ k: "beam", size: "MC10X25" }))
    ).toBe("C");
    expect(
      sectionKind("L6X4X3/8", MS.shape({ k: "beam", size: "L6X4X3/8" }))
    ).toBe("L");
    const q = piece("HSS8X6X1/4"),
      g = keep(factory().piece(q));
    expect(sectionProfile(q.size, q.shape).holes).toHaveLength(1);
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    mesh.updateMatrixWorld();
    const throughTube = new THREE.Raycaster(
      new THREE.Vector3(-2, 0, 10 - 4 / 12),
      new THREE.Vector3(1, 0, 0)
    );
    expect(throughTube.intersectObject(mesh)).toHaveLength(0);
    const ontoFlange = new THREE.Raycaster(
      new THREE.Vector3(10, 0, 15),
      new THREE.Vector3(0, 0, -1)
    );
    expect(ontoFlange.intersectObject(mesh).length).toBeGreaterThan(0);
    mesh.material.dispose();
  });
  it("builds double-angle joist chords, bar webs and bearing seats inside the nominal envelope", () => {
    const q = piece("24K8", {
      k: "joist",
      shape: MS.shape({ k: "joist", size: "24K8" }),
    });
    const g = keep(factory().piece(q));
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBeCloseTo(10);
    expect(g.boundingBox!.min.z).toBeCloseTo(8);
    expect(g.getAttribute("position").count).toBeGreaterThan(1000);
    const normals = g.getAttribute("normal"),
      positions = g.getAttribute("position");
    expect(Array.from(normals.array).every(Number.isFinite)).toBe(true);
    // Every reflected angle still has front faces agreeing with its transformed normals.
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      face = new THREE.Vector3(),
      normal = new THREE.Vector3();
    let mismatches = 0;
    for (let i = 0; i < positions.count; i += 3) {
      a.fromBufferAttribute(positions, i);
      b.fromBufferAttribute(positions, i + 1);
      c.fromBufferAttribute(positions, i + 2);
      face.crossVectors(b.sub(a), c.sub(a));
      normal.fromBufferAttribute(normals, i);
      if (face.lengthSq() > 1e-14 && face.dot(normal) < -1e-7) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
  it("builds vertical column sections, plates, four anchors and an illustrative footing only at a base", () => {
    const { sheets, recs } = project(),
      q = MS.build(sheets, recs, MD.noSettings()).cols[0],
      f = factory();
    const parts = f.column(q, true)!;
    geometries.push(parts.steel, parts.bolts!, parts.concrete!);
    parts.steel.computeBoundingBox();
    parts.concrete!.computeBoundingBox();
    expect(parts.steel.boundingBox!.min.z).toBeCloseTo(q.z0);
    expect(parts.steel.boundingBox!.max.z).toBeCloseTo(q.z1);
    expect(parts.concrete!.boundingBox!.max.z).toBeLessThan(q.z0);
    expect(parts.bolts!.getAttribute("position").count).toBeGreaterThan(100);
    const upper = f.column({ ...q, z0: 13.5, z1: 27 }, false)!;
    geometries.push(upper.steel);
    expect(upper.bolts).toBeNull();
    expect(upper.concrete).toBeNull();
  });
  it("uses stable muted sequence colors independently of visible piece counts", () => {
    const seqs = ["1", "2", "3"];
    expect(sequenceColor("1", seqs)).not.toBe(sequenceColor("2", seqs));
    expect(sequenceColor("2", seqs)).toBe(sequenceColor("2", seqs));
    expect(sequenceColor("", seqs)).toBe("#858c93");
  });
});
