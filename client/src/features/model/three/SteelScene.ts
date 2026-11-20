import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  SEL_COLOR,
  TONES,
  type MCol,
  type Model,
  type MPiece,
  type Tone,
} from "../space";
import { MemberGeometry } from "./geometry";
import { sequenceColor, type ColorBy } from "./types";
import { keyAtFace, type FaceRange } from "./picking";

type SteelBucket = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  tone: Tone;
  sequence: string;
  ranges: FaceRange[];
};
type PendingBucket = {
  tone: Tone;
  sequence: string;
  parts: THREE.BufferGeometry[];
  ranges: FaceRange[];
  faces: number;
  vertices: number;
};
const MAX_BATCH_VERTICES = 120_000;

/** Resolve modern CSS colors (including oklch) through canvas, which three.Color cannot parse. */
export function themeColor(token: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  if (!value) return new THREE.Color(fallback);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Color(fallback);
  ctx.fillStyle = fallback;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(
    r / 255,
    g / 255,
    b / 255,
    THREE.SRGBColorSpace
  );
}

function grain(seed: number) {
  const side = 128,
    pixels = new Uint8Array(side * side * 4);
  let state = seed;
  for (let i = 0; i < pixels.length; i += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const v = 110 + ((state >>> 24) % 55);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
    pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** All geometry lives in model feet with z up; no mutation of MS.build output. */
export class SteelScene {
  readonly scene = new THREE.Scene();
  readonly bounds = new THREE.Box3();
  readonly pieceBounds = new Map<string, THREE.Box3>();
  private factory = new MemberGeometry();
  private root = new THREE.Group();
  private highlight = new THREE.Group();
  private hoverGroup = new THREE.Group();
  private buckets: SteelBucket[] = [];
  private pickMeshes: THREE.Mesh[] = [];
  private bucketByMesh = new Map<THREE.Object3D, SteelBucket>();
  private members = new Map<string, MPiece | MCol>();
  private foundations = new Set<string>();
  private textures = [grain(739), grain(2017)];
  private environment: THREE.WebGLRenderTarget;
  private sun = new THREE.DirectionalLight(0xffedda, 3.1);
  private fill = new THREE.HemisphereLight(0xdceafa, 0x71716a, 2.2);
  private concrete: THREE.MeshStandardMaterial;
  private bolts: THREE.MeshStandardMaterial;
  private selectionMaterial: THREE.MeshStandardMaterial;
  private hoverMaterial: THREE.MeshStandardMaterial;
  private outlineMaterial = new THREE.LineBasicMaterial({
    color: SEL_COLOR[1],
    transparent: true,
    opacity: 0.95,
    depthTest: true,
  });
  private grid: THREE.LineSegments | null = null;
  private slab: THREE.Mesh | null = null;
  private colorBy: ColorBy = "steel";
  private raycaster = new THREE.Raycaster();
  private hoverKey: string | null = null;
  private model: Model;

  constructor(
    private renderer: THREE.WebGLRenderer,
    model: Model
  ) {
    this.model = model;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment.texture;
    this.scene.environmentRotation.x = Math.PI / 2;
    this.scene.environmentIntensity = 0.65;
    this.concrete = new THREE.MeshStandardMaterial({
      color: 0xbfc2c5,
      roughness: 0.94,
      metalness: 0,
      bumpMap: this.textures[1],
      bumpScale: 0.012,
    });
    this.bolts = new THREE.MeshStandardMaterial({
      color: 0x343b42,
      roughness: 0.6,
      metalness: 0.78,
    });
    this.selectionMaterial = new THREE.MeshStandardMaterial({
      color: SEL_COLOR[1],
      emissive: SEL_COLOR[1],
      emissiveIntensity: 0.3,
      metalness: 0.6,
      roughness: 0.46,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.hoverMaterial = new THREE.MeshStandardMaterial({
      color: 0xb7c9d9,
      emissive: 0x788d9d,
      emissiveIntensity: 0.2,
      metalness: 0.6,
      roughness: 0.46,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.scene.add(
      this.root,
      this.highlight,
      this.hoverGroup,
      this.sun,
      this.sun.target,
      this.fill
    );
    this.fill.position.set(0, 0, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.radius = 3;
    this.build();
    this.updateTheme();
  }

  private steelMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x76818b,
      metalness: 0.72,
      roughness: 0.49,
      envMapIntensity: 1,
      bumpMap: this.textures[0],
      bumpScale: 0.0015,
    });
  }
  private finishBucket(bucket: PendingBucket) {
    if (!bucket.parts.length) return;
    const geometry = mergeGeometries(bucket.parts, false);
    bucket.parts.forEach(g => g.dispose());
    if (!geometry) throw new Error("Steel render batch could not be combined");
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = this.steelMaterial(),
      mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    this.root.add(mesh);
    const ready = {
      mesh,
      material,
      tone: bucket.tone,
      sequence: bucket.sequence,
      ranges: bucket.ranges,
    };
    this.buckets.push(ready);
    this.pickMeshes.push(mesh);
    this.bucketByMesh.set(mesh, ready);
    bucket.parts = [];
    bucket.ranges = [];
    bucket.faces = bucket.vertices = 0;
  }
  private staticMesh(parts: THREE.BufferGeometry[], material: THREE.Material) {
    if (!parts.length) return;
    // Keep the concrete/anchor batches bounded too, to avoid one giant merge allocation.
    let group: THREE.BufferGeometry[] = [],
      vertices = 0;
    const flush = () => {
      if (!group.length) return;
      const geometry = mergeGeometries(group, false);
      group.forEach(g => g.dispose());
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = mesh.receiveShadow = true;
        this.root.add(mesh);
      }
      group = [];
      vertices = 0;
    };
    for (const g of parts) {
      const count = g.getAttribute("position").count;
      if (vertices + count > MAX_BATCH_VERTICES) flush();
      group.push(g);
      vertices += count;
    }
    flush();
  }
  private build() {
    const pending = new Map<string, PendingBucket>();
    const concrete: THREE.BufferGeometry[] = [],
      bolts: THREE.BufferGeometry[] = [];
    const lowest = new Map<string, number>();
    this.model.cols.forEach(q => {
      const key = q.xy.map(v => v.toFixed(2)).join(",");
      lowest.set(key, Math.min(lowest.get(key) ?? Infinity, q.z0));
    });
    const add = (q: MPiece | MCol, g: THREE.BufferGeometry) => {
      g.computeBoundingBox();
      const box = g.boundingBox!.clone();
      this.bounds.union(box);
      this.pieceBounds.set(q.key, box);
      this.members.set(q.key, q);
      const key = `${q.tone}:${q.seq}`;
      let bucket = pending.get(key);
      if (!bucket) {
        bucket = {
          tone: q.tone,
          sequence: q.seq,
          parts: [],
          ranges: [],
          faces: 0,
          vertices: 0,
        };
        pending.set(key, bucket);
      }
      const count = g.getAttribute("position").count;
      if (bucket.vertices + count > MAX_BATCH_VERTICES)
        this.finishBucket(bucket);
      bucket.parts.push(g);
      bucket.vertices += count;
      bucket.faces += count / 3;
      bucket.ranges.push({ end: bucket.faces, key: q.key });
    };
    this.model.pieces.forEach(q => {
      const g = this.factory.piece(q);
      if (g) add(q, g);
    });
    this.model.cols.forEach(q => {
      const foundation =
        q.z0 === lowest.get(q.xy.map(v => v.toFixed(2)).join(","));
      if (foundation) this.foundations.add(q.key);
      const parts = this.factory.column(q, foundation);
      if (!parts) return;
      add(q, parts.steel);
      if (parts.bolts) bolts.push(parts.bolts);
      if (parts.concrete) concrete.push(parts.concrete);
    });
    pending.forEach(bucket => this.finishBucket(bucket));
    this.staticMesh(bolts, this.bolts);
    this.staticMesh(concrete, this.concrete);
    if (this.bounds.isEmpty())
      this.bounds.set(
        new THREE.Vector3(-5, -5, -1),
        new THREE.Vector3(5, 5, 10)
      );
    this.buildGround();
    this.fitLight();
    this.renderer.shadowMap.needsUpdate = true;
  }
  private buildGround() {
    const size = this.bounds.getSize(new THREE.Vector3()),
      center = this.bounds.getCenter(new THREE.Vector3());
    const padding = Math.max(8, Math.max(size.x, size.y) * 0.12);
    let base = this.bounds.min.z;
    if (this.model.cols.length)
      base = this.model.cols.reduce((z, q) => Math.min(z, q.z0), Infinity);
    const w = size.x + padding * 2,
      h = size.y + padding * 2;
    this.slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.22),
      this.concrete
    );
    this.slab.position.set(center.x, center.y, base - 0.19);
    this.slab.receiveShadow = true;
    this.root.add(this.slab);
    const step = Math.max(5, Math.ceil(Math.max(w, h) / 250 / 5) * 5),
      points: number[] = [];
    const xmin = center.x - w / 2,
      xmax = center.x + w / 2,
      ymin = center.y - h / 2,
      ymax = center.y + h / 2;
    const z = base - 0.078;
    for (let x = Math.ceil(xmin / step) * step; x < xmax; x += step)
      points.push(x, ymin, z, x, ymax, z);
    for (let y = Math.ceil(ymin / step) * step; y < ymax; y += step)
      points.push(xmin, y, z, xmax, y, z);
    const geometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3)
    );
    this.grid = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xb7bec5,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      })
    );
    this.root.add(this.grid);
  }
  private fitLight() {
    const center = this.bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(
      15,
      this.bounds.getSize(new THREE.Vector3()).length() / 2
    );
    this.sun.position
      .copy(center)
      .add(new THREE.Vector3(-0.55, -0.8, 1.5).multiplyScalar(radius));
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    const camera = this.sun.shadow.camera;
    camera.position.copy(this.sun.position);
    camera.up.set(0, 0, 1);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const lightBounds = this.bounds.clone();
    if (this.slab) {
      this.slab.updateMatrixWorld();
      lightBounds.expandByObject(this.slab);
    }
    const shadowBounds = new THREE.Box3();
    for (const x of [lightBounds.min.x, lightBounds.max.x])
      for (const y of [lightBounds.min.y, lightBounds.max.y])
        for (const z of [lightBounds.min.z - 1.2, lightBounds.max.z]) {
          shadowBounds.expandByPoint(
            new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse)
          );
        }
    camera.left = shadowBounds.min.x - 2;
    camera.right = shadowBounds.max.x + 2;
    camera.bottom = shadowBounds.min.y - 2;
    camera.top = shadowBounds.max.y + 2;
    camera.near = Math.max(0.1, -shadowBounds.max.z - 5);
    camera.far = Math.max(camera.near + 10, -shadowBounds.min.z + 5);
    camera.updateProjectionMatrix();
  }
  setColorBy(mode: ColorBy) {
    this.colorBy = mode;
    this.buckets.forEach(bucket => {
      let color = new THREE.Color(0x76818b);
      if (mode === "review") {
        const tone = TONES.find(t => t[0] === bucket.tone) || TONES[0];
        color = themeColor(tone[2], tone[3]).lerp(
          new THREE.Color(0x9099a0),
          0.18
        );
      } else if (mode === "sequence")
        color.set(sequenceColor(bucket.sequence, this.model.seqs));
      bucket.material.color.copy(color);
    });
  }
  updateTheme() {
    const dark = document.documentElement.classList.contains("dark");
    const paper = themeColor("--tp-paper", dark ? "#171d25" : "#f5f7fa");
    const bone = themeColor("--tp-bone", dark ? "#11161d" : "#edf2f7");
    const top = dark
      ? bone.clone().lerp(new THREE.Color(0x090d13), 0.6)
      : paper.clone().lerp(new THREE.Color(0xd1e2f2), 0.55);
    const bottom = dark
      ? paper.clone().lerp(new THREE.Color(0x323d48), 0.18)
      : paper.clone();
    this.renderer.domElement.style.backgroundImage = `linear-gradient(180deg, ${top.getStyle()}, ${bottom.getStyle()})`;
    this.concrete.color.set(dark ? 0x525a62 : 0xbfc3c7);
    if (this.grid)
      (this.grid.material as THREE.LineBasicMaterial).color.copy(
        themeColor("--tp-rule", dark ? "#76808d" : "#909eaa")
      );
    this.fill.color.set(dark ? 0xbdcee0 : 0xdceafa);
    this.fill.groundColor.set(dark ? 0x465360 : 0x71716a);
    this.renderer.toneMappingExposure = dark ? 1.12 : 1;
    // Selection stays orange in both themes (not the theme's navy accent).
    const orange = new THREE.Color(SEL_COLOR[1]);
    this.selectionMaterial.color.copy(orange);
    this.selectionMaterial.emissive.copy(orange);
    this.outlineMaterial.color.copy(orange);
    this.setColorBy(this.colorBy);
    this.renderer.shadowMap.needsUpdate = true;
  }
  pick(x: number, y: number, camera: THREE.Camera): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        (-(y - rect.top) / rect.height) * 2 + 1
      ),
      camera
    );
    const hit = this.raycaster.intersectObjects(this.pickMeshes, false)[0];
    if (!hit || hit.faceIndex == null) return null;
    const ranges = this.bucketByMesh.get(hit.object)?.ranges;
    if (!ranges) return null;
    return keyAtFace(ranges, hit.faceIndex);
  }
  private memberGeometry(key: string) {
    const q = this.members.get(key);
    if (!q) return null;
    if ("p0" in q) return this.factory.piece(q);
    const parts = this.factory.column(q, this.foundations.has(key));
    parts?.bolts?.dispose();
    parts?.concrete?.dispose();
    return parts?.steel ?? null;
  }
  private clearOverlay(group: THREE.Group) {
    group.children.forEach(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments)
        object.geometry.dispose();
    });
    group.clear();
  }
  setSelected(keys: string[]) {
    this.clearOverlay(this.highlight);
    const parts: THREE.BufferGeometry[] = [];
    let vertices = 0;
    const flush = () => {
      if (!parts.length) return;
      const geometry = mergeGeometries(parts, false);
      parts.forEach(g => g.dispose());
      parts.length = 0;
      vertices = 0;
      if (!geometry) return;
      const mesh = new THREE.Mesh(geometry, this.selectionMaterial);
      mesh.renderOrder = 2;
      this.highlight.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 38),
        this.outlineMaterial
      );
      edges.renderOrder = 3;
      this.highlight.add(edges);
    };
    for (const key of keys) {
      const geometry = this.memberGeometry(key);
      if (!geometry) continue;
      if (
        vertices + geometry.getAttribute("position").count >
        MAX_BATCH_VERTICES
      )
        flush();
      parts.push(geometry);
      vertices += geometry.getAttribute("position").count;
    }
    flush();
  }
  setHover(key: string | null) {
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.clearOverlay(this.hoverGroup);
    if (!key) return;
    const geometry = this.memberGeometry(key);
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, this.hoverMaterial);
      mesh.renderOrder = 1;
      this.hoverGroup.add(mesh);
    }
  }
  dispose() {
    this.clearOverlay(this.highlight);
    this.clearOverlay(this.hoverGroup);
    this.root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments)
        object.geometry.dispose();
    });
    this.buckets.forEach(b => b.material.dispose());
    this.concrete.dispose();
    this.bolts.dispose();
    this.selectionMaterial.dispose();
    this.hoverMaterial.dispose();
    this.outlineMaterial.dispose();
    if (this.grid) (this.grid.material as THREE.Material).dispose();
    this.textures.forEach(t => t.dispose());
    this.environment.dispose();
    this.sun.shadow.dispose();
    this.factory.dispose();
    this.scene.environment = null;
    this.root.clear();
    this.scene.clear();
    this.members.clear();
    this.pieceBounds.clear();
    this.bucketByMesh.clear();
    this.pickMeshes = [];
    this.buckets = [];
  }
}
