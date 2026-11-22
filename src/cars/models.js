// Procedural car models. The body is a single skin lofted through
// cross-sections derived from the profile curves in designs.js; wheels,
// lights, wings and trim are separate parts placed on that skin.

import * as THREE from 'three';
import { DESIGNS } from './designs.js';

// ---- curve helper: monotone cubic interpolation through key points --------

function pchip(keys, outside = 'clamp') {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const h = [];
  const delta = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array(n).fill(0);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return outside === 'none' && x < xs[0] ? -Infinity : ys[0];
    if (x >= xs[n - 1]) return outside === 'none' && x > xs[n - 1] ? -Infinity : ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h[i] * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h[i] * m[i + 1]
    );
  };
}

// ---- cross-section ---------------------------------------------------------
// Half ring (x >= 0), 22 points from the floor centreline, out under the
// sill, up the body side to the shoulder, in across the glass base, up the
// side glass and over the roof to the centreline.

const N_PTS = 22;
const SIDE_N = 8;
const GLASS_T = [0.3, 0.6, 0.88, 1];
const ROOF_N = 6;

function makeSectionFn(d, spec) {
  const halfWidth = pchip(d.halfWidth);
  const bottom = pchip(d.bottom);
  const belt = pchip(d.belt);
  const deck = pchip(d.deck);
  const roof = pchip(d.roof, 'none');
  const inset = pchip(d.inset);
  const wb2 = spec.wheelbase / 2;
  const Rf = spec.wheelRadiusFront;
  const Rr = spec.wheelRadiusRear;

  const green = (z) => Math.max(0, roof(z) - belt(z));

  const section = (z, xs, ys) => {
    const hw = halfWidth(z);
    const bot = bottom(z);
    const bl = belt(z);

    // wheel arches
    let low = bot;
    const dzF = z - wb2;
    const dzR = z + wb2;
    const aF = Rf + 0.06;
    const aR = Rr + 0.06;
    if (Math.abs(dzF) < aF) low = Math.max(low, Rf + Math.sqrt(aF * aF - dzF * dzF));
    if (Math.abs(dzR) < aR) low = Math.max(low, Rr + Math.sqrt(aR * aR - dzR * dzR));
    low = Math.min(low, bl - 0.05);
    const flare = d.flare * (Math.exp(-((dzF / 0.4) ** 2)) + Math.exp(-((dzR / 0.4) ** 2)));

    const wIn = Math.max(0.05, hw - 0.36);
    xs[0] = 0;
    ys[0] = bot;
    xs[1] = wIn;
    ys[1] = bot;
    xs[2] = wIn;
    ys[2] = low;

    for (let i = 0; i < SIDE_N; i++) {
      const t = i / (SIDE_N - 1);
      let x;
      if (t < 0.5) x = hw * (1 - d.tuck * (1 - t / 0.5) ** 2);
      else x = hw - d.shoulder * ((t - 0.5) / 0.5) ** 2.4;
      x += flare * Math.sin(Math.PI * Math.min(1, t * 1.25));
      xs[3 + i] = x;
      ys[3 + i] = low + (bl - low) * t;
    }

    const hwSh = hw - d.shoulder;
    const gb = Math.max(0.1, hwSh - inset(z));
    const yb = bl + 0.012;
    xs[11] = gb;
    ys[11] = yb;

    const g = green(z);
    const ge = Math.min(green(z + d.glassLagFront), green(z - d.glassLagRear), g) * 0.92;
    const rw = Math.max(0.2, gb - ge * d.tumble);
    for (let i = 0; i < 4; i++) {
      const t = GLASS_T[i];
      xs[12 + i] = gb + (rw - gb) * t + 0.012 * Math.sin(Math.PI * t) * Math.min(1, ge * 4);
      ys[12 + i] = yb + ge * t;
    }
    const yE = yb + ge;
    const yC = Math.max(deck(z), bl + g);
    for (let i = 1; i <= ROOF_N; i++) {
      const t = i / ROOF_N;
      xs[15 + i] = rw * (1 - t);
      ys[15 + i] = yE + (yC - yE) * (1 - (1 - t) ** d.crownPow);
    }
    return ge;
  };

  return { section, halfWidth, bottom, belt, deck, green };
}

// ---- mesh assembly ----------------------------------------------------------

class Bucket {
  constructor() {
    this.pos = [];
    this.idx = [];
    this.map = new Map();
  }
  vert(key, x, y, z) {
    let i = this.map.get(key);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.pos.push(x, y, z);
      this.map.set(key, i);
    }
    return i;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

function stationList(d, spec) {
  const zs = [];
  const step = 0.03;
  for (let z = d.zRear; z <= d.zFront + 1e-6; z += step) zs.push(z);
  zs.push(d.zFront);
  // resolve the rounded ends finely
  for (let i = 1; i < 12; i++) {
    zs.push(d.zFront - 0.12 * (i / 12) ** 2);
    zs.push(d.zRear + 0.1 * (i / 12) ** 2);
  }
  const keys = [...d.windshield, ...d.rearGlass, ...d.sideGlass];
  if (d.bPillar != null) keys.push(d.bPillar - 0.035, d.bPillar + 0.035);
  if (d.intakeBand) keys.push(d.zFront - d.intakeBand.depth);
  zs.push(...keys);
  // even angular sampling around the wheel arches
  const wb2 = spec.wheelbase / 2;
  for (const [zw, R] of [
    [wb2, spec.wheelRadiusFront + 0.06],
    [-wb2, spec.wheelRadiusRear + 0.06],
  ]) {
    for (let k = 0; k <= 28; k++) zs.push(zw + R * Math.cos((Math.PI * k) / 28));
  }
  zs.sort((a, b) => a - b);
  const out = [];
  for (const z of zs) {
    if (z < d.zRear - 1e-6 || z > d.zFront + 1e-6) continue;
    if (out.length && z - out[out.length - 1] < 0.004) continue;
    out.push(z);
  }
  return out;
}

function buildBody(d, spec, mats) {
  const fn = makeSectionFn(d, spec);
  const zs = stationList(d, spec);
  const nSt = zs.length;
  const M = (N_PTS - 1) * 2; // points in the full ring
  const ring = new Float32Array(nSt * M * 2);
  const ge = new Float32Array(nSt);
  const xs = new Float32Array(N_PTS);
  const ys = new Float32Array(N_PTS);
  for (let i = 0; i < nSt; i++) {
    ge[i] = fn.section(zs[i], xs, ys);
    for (let k = 0; k < M; k++) {
      const src = k < N_PTS ? k : M - k;
      ring[(i * M + k) * 2] = k < N_PTS ? xs[src] : -xs[src];
      ring[(i * M + k) * 2 + 1] = ys[src];
    }
  }

  const inRange = (z, r) => r && z >= r[0] && z <= r[1];
  const classify = (seg, z, geMid) => {
    if (seg <= 2) return 'under';
    if (seg <= 9) {
      const t = (seg - 3 + 0.5) / 7;
      if (d.intakeBand && z > d.zFront - d.intakeBand.depth && t < d.intakeBand.top) return 'black';
      if (z < d.zRear + 0.2 && t < 0.3) return 'black';
      // sill between the wheels
      if (seg === 3 && Math.abs(z) < spec.wheelbase / 2 - spec.wheelRadiusRear - 0.1) return 'black';
      return 'paint';
    }
    if (seg === 10) return 'paint';
    if (seg <= 13) {
      if (geMid > 0.05 && inRange(z, d.sideGlass)) {
        if (d.bPillar != null && Math.abs(z - d.bPillar) < 0.035) return 'black';
        return 'glass';
      }
      return 'paint';
    }
    if (seg <= 15) return 'paint';
    if (inRange(z, d.windshield) || inRange(z, d.rearGlass)) return 'glass';
    return 'paint';
  };

  const buckets = { paint: new Bucket(), glass: new Bucket(), black: new Bucket(), under: new Bucket() };
  const P = (i, k) => {
    const o = (i * M + (k % M)) * 2;
    return [ring[o], ring[o + 1], zs[i]];
  };

  for (let i = 0; i < nSt - 1; i++) {
    const zm = (zs[i] + zs[i + 1]) / 2;
    const gm = (ge[i] + ge[i + 1]) / 2;
    for (let k = 0; k < M; k++) {
      const seg = k < N_PTS - 1 ? k : M - 1 - k;
      const b = buckets[classify(seg, zm, gm)];
      const k1 = (k + 1) % M;
      const pa = P(i, k);
      const pb = P(i, k1);
      const pc = P(i + 1, k1);
      const pd = P(i + 1, k);
      const a = b.vert(i * M + k, ...pa);
      const bb = b.vert(i * M + k1, ...pb);
      const c = b.vert((i + 1) * M + k1, ...pc);
      const dd = b.vert((i + 1) * M + k, ...pd);
      b.idx.push(a, bb, dd, bb, c, dd);
    }
  }

  // end caps
  for (const end of [0, nSt - 1]) {
    let cy = 0;
    for (let k = 0; k < M; k++) cy += ring[(end * M + k) * 2 + 1];
    cy /= M;
    for (let k = 0; k < M; k++) {
      const seg = k < N_PTS - 1 ? k : M - 1 - k;
      let cls = classify(seg, zs[end], ge[end]);
      if (cls === 'glass') cls = 'paint';
      const b = buckets[cls];
      const k1 = (k + 1) % M;
      const base = 1e7 + end * 1000;
      const c = b.vert(base + 999, 0, cy, zs[end]);
      const p0 = b.vert(base + k, ...P(end, k));
      const p1 = b.vert(base + k1, ...P(end, k1));
      if (end === 0) b.idx.push(c, p1, p0);
      else b.idx.push(c, p0, p1);
    }
  }

  const group = new THREE.Group();
  for (const name of Object.keys(buckets)) {
    if (!buckets[name].idx.length) continue;
    const mesh = new THREE.Mesh(buckets[name].geometry(), mats[name]);
    mesh.castShadow = true;
    mesh.receiveShadow = name === 'paint';
    group.add(mesh);
  }

  // surface queries for placing parts
  const topY = (x, z) => {
    fn.section(z, xs, ys);
    const ax = Math.abs(x);
    for (let k = 10; k < N_PTS - 1; k++) {
      const x0 = xs[k];
      const x1 = xs[k + 1];
      if (ax <= x0 && ax >= x1) {
        const t = x0 === x1 ? 0 : (x0 - ax) / (x0 - x1);
        return ys[k] + (ys[k + 1] - ys[k]) * t;
      }
    }
    return ys[N_PTS - 1];
  };
  const sideX = (y, z) => {
    fn.section(z, xs, ys);
    for (let k = 3; k < 10; k++) {
      if (y >= ys[k] && y <= ys[k + 1]) {
        const t = (y - ys[k]) / (ys[k + 1] - ys[k] || 1);
        return xs[k] + (xs[k + 1] - xs[k]) * t;
      }
    }
    return xs[10];
  };

  return { group, topY, sideX, fn };
}

// ---- wheels -----------------------------------------------------------------

function buildWheel(R, width, rimInch, style, mats) {
  const rimR = (rimInch * 0.0254) / 2;
  const hw = width / 2;
  const sw = R - rimR;
  const g = new THREE.Group();

  const prof = [
    [rimR - 0.006, -hw + 0.008],
    [rimR + sw * 0.45, -hw],
    [R - 0.022, -hw + 0.01],
    [R - 0.004, -hw + 0.035],
    [R, -hw + 0.06],
    [R, hw - 0.06],
    [R - 0.004, hw - 0.035],
    [R - 0.022, hw - 0.01],
    [rimR + sw * 0.45, hw],
    [rimR - 0.006, hw - 0.008],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 44), mats.tyre);
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width * 0.92, 36, 1, true), mats.rimInner);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);

  // rim lip
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.008, 0.012, 8, 44), mats.rim);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = hw - 0.012;
  g.add(lip);

  // spokes on the outer face (+x)
  const faceX = hw - 0.05;
  const spokeLen = rimR - 0.01;
  const addSpoke = (angle, w, thick, sweep = 0) => {
    const geo = new THREE.BoxGeometry(thick, spokeLen, w);
    geo.translate(0, spokeLen / 2, 0);
    const m = new THREE.Mesh(geo, mats.rim);
    m.position.x = faceX;
    m.rotation.x = angle;
    m.rotation.z = sweep;
    g.add(m);
  };
  if (style === 'star5') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      addSpoke(a - 0.1, 0.034, 0.04);
      addSpoke(a + 0.1, 0.034, 0.04);
    }
  } else if (style === 'twin5') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      addSpoke(a - 0.16, 0.03, 0.035);
      addSpoke(a + 0.16, 0.03, 0.035);
    }
  } else {
    for (let i = 0; i < 10; i++) addSpoke((i / 10) * Math.PI * 2, 0.026, 0.035);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 20), mats.rim);
  hub.rotation.z = -Math.PI / 2;
  hub.position.x = faceX + 0.005;
  g.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16), mats.chrome);
  cap.rotation.z = -Math.PI / 2;
  cap.position.x = faceX + 0.045;
  g.add(cap);

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.8, rimR * 0.8, 0.03, 36), mats.disc);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = hw * 0.25;
  g.add(disc);

  // caliper does not rotate with the wheel
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.075, rimR * 0.34, rimR * 0.95), mats.caliper);
  caliper.position.set(hw * 0.25, rimR * 0.1, -rimR * 0.62);
  caliper.rotation.x = 0.25;

  return { spin: g, caliper };
}

// ---- small helpers ----------------------------------------------------------

function plateTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 256, 80);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 248, 72);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 52px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 43);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const sphereGeo = new THREE.SphereGeometry(1, 28, 18);

// ---- public: build a complete car ------------------------------------------

export function buildCar(spec, colorHex) {
  const d = DESIGNS[spec.id];
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({
      color: colorHex,
      metalness: 0.12,
      roughness: 0.62,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 0.85,
    }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x05070a, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
    black: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.55, metalness: 0.2 }),
    under: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.95 }),
    carbon: new THREE.MeshPhysicalMaterial({ color: 0x0c0d0f, roughness: 0.35, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: d.wheel.rim, roughness: 0.3, metalness: 0.9 }),
    rimInner: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd9dadc, roughness: 0.15, metalness: 1 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6d6f73, roughness: 0.45, metalness: 0.85 }),
    caliper: new THREE.MeshStandardMaterial({ color: d.wheel.caliper, roughness: 0.4, metalness: 0.3 }),
    head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff1d6, emissiveIntensity: 1.2, roughness: 0.08, metalness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3a0204, emissive: 0xff1408, emissiveIntensity: 0.9, roughness: 0.25 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0xcfd3d6, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8b8e93, roughness: 0.25, metalness: 1 }),
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // Model space has the wheelbase centre at z = 0; shift so the origin is
  // under the centre of gravity, which is where the physics lives.
  const a = spec.wheelbase * (1 - spec.frontWeight);
  const shift = a - spec.wheelbase / 2;
  const shell = new THREE.Group();
  shell.position.z = shift;
  body.add(shell);

  const built = buildBody(d, spec, mats);
  shell.add(built.group);
  const { topY, sideX, fn } = built;

  const add = (mesh, shadow = false) => {
    mesh.castShadow = shadow;
    shell.add(mesh);
    return mesh;
  };

  // headlights: a dark glass housing sunk into the nose with bright
  // projector lenses standing just proud of it
  for (const h of d.headlights) {
    for (const s of [1, -1]) {
      const y = topY(h.x, h.z);
      const slope = (topY(h.x, h.z + 0.08) - topY(h.x, h.z - 0.08)) / 0.16;
      const holder = new THREE.Group();
      holder.position.set(s * h.x, y - h.sy * 0.45, h.z);
      holder.rotation.order = 'YXZ';
      holder.rotation.y = s * h.yaw;
      holder.rotation.x = -Math.atan(slope);
      const housing = new THREE.Mesh(sphereGeo, mats.glass);
      housing.scale.set(h.sx, h.sy, h.sz);
      holder.add(housing);
      for (const l of h.lamps) {
        const lamp = new THREE.Mesh(sphereGeo, mats.head);
        lamp.scale.set(l.r, h.sy * 0.9, l.rz ?? l.r);
        lamp.position.set(s * l.x, h.sy * 0.22, l.z);
        holder.add(lamp);
      }
      shell.add(holder);
    }
  }

  // tail lights
  const tl = d.taillights;
  const zTail = d.zRear;
  if (tl.type === 'round') {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(tl.panel.w, tl.panel.h, 0.02), mats.black);
    panel.position.set(0, tl.y, zTail - 0.004);
    add(panel);
    for (const it of tl.items) {
      for (const s of [1, -1]) {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(it.r, it.r * 0.92, 0.035, 28), mats.tail);
        lamp.rotation.x = -Math.PI / 2;
        lamp.position.set(s * it.x, tl.y, zTail - 0.022);
        add(lamp);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(it.r, 0.007, 8, 28), mats.chrome);
        ring.position.set(s * it.x, tl.y, zTail - 0.03);
        add(ring);
      }
    }
  } else {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(tl.w, tl.h, 0.03), mats.tail);
    bar.position.set(0, tl.y, zTail - 0.008);
    add(bar);
    const under = new THREE.Mesh(new THREE.BoxGeometry(tl.w * 0.92, 0.1, 0.02), mats.black);
    under.position.set(0, tl.y - 0.08, zTail - 0.004);
    add(under);
  }

  // plates
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture('DR1FT'), roughness: 0.6 });
  const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.012), plateMat);
  rearPlate.position.set(0, Math.max(fn.bottom(d.zRear) + 0.1, tl.y - 0.24), zTail - 0.008);
  rearPlate.rotation.y = Math.PI;
  add(rearPlate);

  // exhausts
  for (const ex of d.exhaust) {
    for (const s of [1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(ex.r, ex.r, 0.16, 20, 1, true), mats.steel);
      pipe.material.side = THREE.DoubleSide;
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(s * ex.x, ex.y, zTail + 0.055);
      add(pipe);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(ex.r * 0.94, 20), mats.under);
      inner.rotation.y = Math.PI;
      inner.position.set(s * ex.x, ex.y, zTail + 0.06);
      add(inner);
    }
  }

  // mirrors: on short stalks off the shoulder line
  {
    const mz = d.mirrors.z;
    const y = fn.belt(mz) + 0.07;
    for (const s of [1, -1]) {
      const x = sideX(fn.belt(mz) - 0.02, mz);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.06), mats.black);
      stalk.position.set(s * (x + 0.02), y - 0.035, mz);
      stalk.rotation.z = s * 0.35;
      add(stalk);
      const head = new THREE.Mesh(sphereGeo, mats.paint);
      head.scale.set(0.08, 0.052, 0.05);
      head.position.set(s * (x + 0.1), y, mz - 0.01);
      add(head, true);
    }
  }

  // side intake (mid-engined car)
  if (d.sideVent) {
    for (const s of [1, -1]) {
      const v = d.sideVent;
      const m = new THREE.Mesh(sphereGeo, mats.under);
      m.scale.set(0.07, v.h / 2, v.len / 2);
      m.position.set(s * (sideX(v.y, v.z) - 0.03), v.y, v.z);
      m.rotation.z = s * 0.1;
      add(m);
    }
  }

  // bonnet vents
  if (d.hoodVents) {
    const v = d.hoodVents;
    for (const s of v.x === 0 ? [0] : [1, -1]) {
      const m = new THREE.Mesh(sphereGeo, mats.under);
      m.scale.set(v.w / 2, 0.03, v.len / 2);
      const slope = (topY(v.x, v.z + 0.1) - topY(v.x, v.z - 0.1)) / 0.2;
      m.position.set(s * v.x, topY(v.x, v.z) - 0.012, v.z);
      m.rotation.x = -Math.atan(slope);
      add(m);
    }
  }

  // front splitter
  {
    const z = d.zFront - 0.16;
    const w = fn.halfWidth(z) * 1.86;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, 0.2), mats.carbon);
    sp.position.set(0, fn.bottom(z) - 0.012, z);
    add(sp, true);
  }

  // wing
  {
    const w = d.wing;
    const deckY = topY(0.3, w.z);
    if (w.type === 'hoop') {
      const top = deckY + w.height;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(w.span, 0.03, w.chord), mats.paint);
      blade.position.set(0, top, w.z);
      blade.rotation.x = 0.1;
      add(blade, true);
      for (const s of [1, -1]) {
        const x = w.span / 2 - 0.03;
        const baseY = topY(x - 0.06, w.z + 0.02);
        const h = top - baseY + 0.02;
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, w.chord * 0.85), mats.paint);
        up.position.set(s * (x - 0.02), baseY + h / 2 - 0.02, w.z + 0.01);
        up.rotation.z = s * 0.1;
        add(up, true);
      }
    } else if (w.type === 'swan') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(w.span, 0.032, w.chord), mats.carbon);
      blade.position.set(0, w.height, w.z);
      blade.rotation.x = 0.14;
      add(blade, true);
      for (const s of [1, -1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.2, w.chord + 0.1), mats.carbon);
        plate.position.set(s * (w.span / 2), w.height - 0.02, w.z);
        add(plate, true);
        // pylon
        const footZ = w.z + 0.16;
        const footY = topY(0.33, footZ) - 0.03;
        const h = w.height - footY;
        const py = new THREE.Mesh(new THREE.BoxGeometry(0.022, h, 0.13), mats.carbon);
        py.position.set(s * 0.33, footY + h / 2, w.z + 0.09);
        py.rotation.x = 0.3;
        add(py, true);
      }
      // ducktail under the wing
      const dz = w.z + 0.1;
      const duck = new THREE.Mesh(new THREE.BoxGeometry(fn.halfWidth(dz) * 1.7, 0.03, 0.16), mats.paint);
      duck.position.set(0, topY(0.2, dz) + 0.035, dz);
      duck.rotation.x = 0.35;
      add(duck, true);
    } else {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w.span, 0.028, w.chord), mats.paint);
      lip.position.set(0, deckY + 0.02, w.z);
      lip.rotation.x = 0.3;
      add(lip, true);
    }
  }

  // wheels
  const wheels = [];
  const wb2 = spec.wheelbase / 2;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const left = i % 2 === 0;
    const R = front ? spec.wheelRadiusFront : spec.wheelRadiusRear;
    const width = front ? spec.tireWidthFront : spec.tireWidthRear;
    const track = front ? spec.trackFront : spec.trackRear;
    const steer = new THREE.Group();
    steer.position.set((left ? 1 : -1) * (track / 2), R, (front ? wb2 : -wb2) + shift);
    const spin = new THREE.Group();
    const w = buildWheel(R, width, spec.rimInch, d.wheel.style, mats);
    const flip = new THREE.Group();
    if (!left) flip.rotation.y = Math.PI;
    flip.add(w.spin);
    spin.add(flip);
    steer.add(spin);
    const calHolder = new THREE.Group();
    if (!left) calHolder.rotation.y = Math.PI;
    calHolder.add(w.caliper);
    steer.add(calHolder);
    root.add(steer);
    wheels.push({ steer, spin, R });
  }

  return {
    root,
    body,
    wheels,
    mats,
    shift,
    design: d,
    setColor(hex) {
      mats.paint.color.setHex(hex);
    },
    setBrake(on) {
      mats.tail.emissiveIntensity = on ? 4.2 : 0.9;
    },
    dispose() {
      root.traverse((o) => {
        if (o.isMesh && o.geometry !== sphereGeo) o.geometry.dispose();
      });
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}
