// Downtown at night: a 5x5 block grid with wet four-lane streets, a central
// plaza for donuts and a ring road. Flat ground.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld } from '../physics/collision.js';
import { rng, makeSky, envFromSky, asphaltTexture, concreteTexture, glowTexture, textTexture, facadeBox, disposeGroup } from './common.js';

const BLOCK = 64;
const ROAD = 18;
const PITCH = BLOCK + ROAD;
const N = 5;
const HALF = (N * BLOCK + (N - 1) * ROAD) / 2; // 196: outer edge of the block grid
const RING = HALF + ROAD / 2; // centreline of the ring road
const EDGE = HALF + ROAD; // outer kerb of the ring road
const ROADS = [-RING, -1.5 * PITCH, -0.5 * PITCH, 0.5 * PITCH, 1.5 * PITCH, RING];

function facade(seed, style) {
  const size = 256;
  const n = 8;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  };
  const c = mk();
  const e = mk();
  const ctx = c.getContext('2d');
  const ex = e.getContext('2d');
  const rand = rng(seed);
  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, size, size);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, size, size);
  const cell = size / n;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const x = ix * cell + cell * style.mx;
      const y = iy * cell + cell * style.my;
      const w = cell * (1 - 2 * style.mx);
      const h = cell * (1 - 2 * style.my);
      if (rand() < style.lit) {
        const warm = rand() < style.warm;
        const b = 0.45 + rand() * 0.55;
        const col = warm
          ? `rgb(${(255 * b) | 0},${(196 * b) | 0},${(120 * b) | 0})`
          : `rgb(${(170 * b) | 0},${(210 * b) | 0},${(255 * b) | 0})`;
        ctx.fillStyle = col;
        ctx.fillRect(x, y, w, h);
        ex.fillStyle = col;
        ex.fillRect(x, y, w, h);
        if (rand() < 0.5) {
          // blind half drawn
          ex.fillStyle = 'rgba(0,0,0,0.45)';
          ex.fillRect(x, y, w, h * (0.3 + rand() * 0.4));
        }
      } else {
        ctx.fillStyle = style.glass;
        ctx.fillRect(x, y, w, h);
      }
    }
  }
  const tex = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return new THREE.MeshStandardMaterial({
    map: tex(c),
    emissiveMap: tex(e),
    emissive: 0xffffff,
    emissiveIntensity: 1.1,
    roughness: 0.75,
    metalness: 0.1,
  });
}

class Quads {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
  }
  // axis-aligned rectangle on the ground
  add(cx, cz, sx, sz, y = 0.012) {
    const i = this.pos.length / 3;
    const hx = sx / 2;
    const hz = sz / 2;
    this.pos.push(cx - hx, y, cz - hz, cx + hx, y, cz - hz, cx + hx, y, cz + hz, cx - hx, y, cz + hz);
    this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}

export function createCity({ renderer }) {
  const group = new THREE.Group();
  const world = new CollisionWorld();
  const rand = rng(20240611);

  // ---- sky, light, atmosphere
  const moonDir = new THREE.Vector3(-0.45, 0.62, -0.5).normalize();
  const sky = makeSky({ top: 0x01020a, horizon: 0x1c1436, bottom: 0x04050a, sunDir: moonDir, sunColor: 0x9db4ff, sunSize: 0.0009, sunGlow: 0.25, stars: 0.9 });
  group.add(sky);

  // fake city lights in the reflection environment so paint has something to catch
  const extras = [];
  const envRand = rng(5);
  const envColors = [0xff3df2, 0x2de2ff, 0xffb46a, 0xffffff, 0x7dff6a, 0xff5a3c];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + envRand() * 0.2;
    const col = new THREE.Color(envColors[i % envColors.length]).multiplyScalar(1.5 + envRand() * 3);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6 + envRand() * 16, 2 + envRand() * 10), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    m.position.set(Math.sin(a) * 70, 4 + envRand() * 40, Math.cos(a) * 70);
    m.lookAt(0, m.position.y, 0);
    extras.push(m);
  }
  const env = envFromSky(renderer, sky, 0x06070c, extras);
  for (const m of extras) {
    m.geometry.dispose();
    m.material.dispose();
  }

  const hemi = new THREE.HemisphereLight(0x6577b0, 0x191310, 0.55);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0x93a8ff, 0.55);
  group.add(sun, sun.target);

  // ---- ground
  const groundMat = new THREE.MeshStandardMaterial({ map: asphaltTexture({ base: 30, seed: 11 }), roughness: 0.38, metalness: 0.05, envMapIntensity: 0.75 });
  groundMat.map.repeat.set(90, 90);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(760, 760), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // ---- blocks: pavements and buildings
  const styles = [
    { wall: '#16181d', glass: '#080b10', lit: 0.3, warm: 0.25, mx: 0.12, my: 0.16 },
    { wall: '#231d1a', glass: '#0a0a0c', lit: 0.22, warm: 0.85, mx: 0.2, my: 0.2 },
    { wall: '#0d1218', glass: '#0b1622', lit: 0.42, warm: 0.1, mx: 0.05, my: 0.08 },
    { wall: '#1d1f24', glass: '#07090c', lit: 0.16, warm: 0.6, mx: 0.16, my: 0.24 },
  ];
  const facadeMats = styles.map((s, i) => facade(100 + i, s));
  const buildingGeos = styles.map(() => []);
  const pave = new Quads();
  const plazaPave = new Quads();
  const buildings = [];
  const TILE_W = 25.6;
  const TILE_H = 27.2;

  const addBuilding = (cx, cz, hx, hz, h) => {
    const style = Math.floor(rand() * styles.length);
    const g = facadeBox(hx * 2, h, hz * 2, TILE_W, TILE_H, Math.floor(rand() * 8) / 8);
    g.translate(cx, 0, cz);
    buildingGeos[style].push(g);
    world.addBox(cx, cz, hx, hz);
    buildings.push({ cx, cz, hx, hz, h });
  };

  const FOOT = BLOCK / 2 - 4; // building footprint half-size inside the pavement
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const cx = (i - 2) * PITCH;
      const cz = (j - 2) * PITCH;
      if (i === 2 && j === 2) {
        plazaPave.add(cx, cz, BLOCK, BLOCK, 0.014);
        continue;
      }
      pave.add(cx, cz, BLOCK, BLOCK, 0.014);
      const near = Math.max(Math.abs(i - 2), Math.abs(j - 2)) === 1;
      const tall = near ? 0.6 : 1;
      const r = rand();
      if (r < 0.28) {
        addBuilding(cx, cz, FOOT, FOOT, (45 + rand() * 75) * tall);
      } else if (r < 0.62) {
        const alongX = rand() < 0.5;
        for (const s of [-1, 1]) {
          const h = (18 + rand() * 60) * tall;
          if (alongX) addBuilding(cx + (s * FOOT) / 2, cz, FOOT / 2, FOOT, h);
          else addBuilding(cx, cz + (s * FOOT) / 2, FOOT, FOOT / 2, h);
        }
      } else {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBuilding(cx + (sx * FOOT) / 2, cz + (sz * FOOT) / 2, FOOT / 2, FOOT / 2, (12 + rand() * 55) * tall);
      }
    }
  }

  // outer wall of buildings beyond the ring road
  {
    const depth = 34;
    const d = EDGE + 4 + depth / 2;
    for (let k = -6; k <= 6; k++) {
      const c = k * 40;
      for (const s of [-1, 1]) {
        const h1 = 22 + rand() * 80;
        const g1 = facadeBox(38, h1, depth, TILE_W, TILE_H, Math.floor(rand() * 8) / 8);
        g1.translate(c, 0, s * d);
        buildingGeos[Math.floor(rand() * styles.length)].push(g1);
        buildings.push({ cx: c, cz: s * d, hx: 19, hz: depth / 2, h: h1, outer: true });
        const h2 = 22 + rand() * 80;
        const g2 = facadeBox(depth, h2, 38, TILE_W, TILE_H, Math.floor(rand() * 8) / 8);
        g2.translate(s * d, 0, c);
        buildingGeos[Math.floor(rand() * styles.length)].push(g2);
        buildings.push({ cx: s * d, cz: c, hx: depth / 2, hz: 19, h: h2, outer: true });
      }
    }
    for (const s of [-1, 1]) {
      pave.add(0, s * (EDGE + 2), 2 * EDGE + 8, 4, 0.014);
      pave.add(s * (EDGE + 2), 0, 4, 2 * EDGE + 8, 0.014);
      world.addBox(0, s * (EDGE + 4 + 10), EDGE + 30, 10);
      world.addBox(s * (EDGE + 4 + 10), 0, 10, EDGE + 30);
    }
  }

  buildingGeos.forEach((list, i) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list), facadeMats[i]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const g of list) g.dispose();
  });

  const paveTex = concreteTexture({ seed: 9, base: 74 });
  paveTex.repeat.set(16, 16);
  group.add(pave.mesh(new THREE.MeshStandardMaterial({ map: paveTex, roughness: 0.7 })));
  const plazaTex = concreteTexture({ seed: 4, base: 96 });
  plazaTex.repeat.set(16, 16);
  group.add(plazaPave.mesh(new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.5 })));

  // ---- road markings
  const white = new Quads();
  const yellow = new Quads();
  for (const r of ROADS) {
    for (let k = 0; k < ROADS.length - 1; k++) {
      const a = ROADS[k] + ROAD / 2;
      const b = ROADS[k + 1] - ROAD / 2;
      const len = b - a;
      const mid = (a + b) / 2;
      // centre line: double yellow
      for (const o of [-0.18, 0.18]) {
        yellow.add(r + o, mid, 0.14, len - 9);
        yellow.add(mid, r + o, len - 9, 0.14);
      }
      // lane dashes
      for (const o of [-4.5, 4.5]) {
        for (let t = a + 7; t < b - 7; t += 9) {
          white.add(r + o, t + 1.5, 0.14, 3);
          white.add(t + 1.5, r + o, 3, 0.14);
        }
      }
      // crossings and stop lines at each end
      for (const end of [a + 2.2, b - 2.2]) {
        for (let s = -7.5; s <= 7.5; s += 1.25) {
          white.add(r + s, end, 0.6, 3.2);
          white.add(end, r + s, 3.2, 0.6);
        }
      }
    }
  }
  const lineMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  group.add(white.mesh(lineMat(0xb9bcc0)), yellow.mesh(lineMat(0xb98f1e)));

  // ---- plaza centrepiece
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.9, 40), new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.5, metalness: 0.3 }));
    base.position.y = 0.45;
    base.castShadow = true;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 16, 24), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.3, metalness: 0.8 }));
    col.position.y = 8.9;
    col.castShadow = true;
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2de2ff).multiplyScalar(2.2) });
    group.add(base, col);
    for (const [y, rad] of [[1.0, 5.1], [9, 1.6], [16.5, 1.2]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.09, 8, 64), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      group.add(ring);
    }
    world.addCircle(0, 0, 5.5);
    const guide = new THREE.Mesh(new THREE.RingGeometry(17.7, 18, 96), new THREE.MeshStandardMaterial({ color: 0xc8cbd0, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    guide.rotation.x = -Math.PI / 2;
    guide.position.y = 0.02;
    group.add(guide);
    const pl = new THREE.PointLight(0x2de2ff, 120, 60, 1.8);
    pl.position.set(0, 9, 0);
    group.add(pl);
  }

  // ---- street lamps
  const lamps = [];
  for (const r of ROADS) {
    for (let k = 0; k < ROADS.length - 1; k++) {
      const a = ROADS[k] + ROAD / 2;
      for (const t of [a + 12, a + 52]) {
        for (const s of [-1, 1]) {
          if (Math.abs(r) === RING && Math.sign(r) === s) continue; // ring road: lamps on the city side only
          lamps.push({ x: r + s * (ROAD / 2 + 1.1), z: t, dx: -s, dz: 0 });
          lamps.push({ x: t, z: r + s * (ROAD / 2 + 1.1), dx: 0, dz: -s });
        }
      }
    }
  }
  {
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.13, 8.6, 8);
    poleGeo.translate(0, 4.3, 0);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.6);
    armGeo.translate(0, 8.55, 1.2);
    const headGeo = new THREE.BoxGeometry(0.5, 0.12, 1.1);
    headGeo.translate(0, 8.45, 2.3);
    const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.7 });
    const poles = new THREE.InstancedMesh(mergeGeometries([poleGeo, armGeo]), metal, lamps.length);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc98a).multiplyScalar(3.2) }), lamps.length);
    const poolGeo = new THREE.PlaneGeometry(26, 26);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(
      poolGeo,
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,190,120,1)', 'rgba(255,190,120,0)'), transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      lamps.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    lamps.forEach((l, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(l.dx, l.dz));
      m.compose(new THREE.Vector3(l.x, 0, l.z), q, one);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      l.hx = l.x + l.dx * 2.3;
      l.hz = l.z + l.dz * 2.3;
      m.compose(new THREE.Vector3(l.hx + l.dx * 2, 0.03, l.hz + l.dz * 2), new THREE.Quaternion(), one);
      pools.setMatrixAt(i, m);
      world.addCircle(l.x, l.z, 0.2);
    });
    poles.castShadow = true;
    group.add(poles, heads, pools);
  }
  // a few real lights that hop to the lamps nearest the car
  const lampLights = [0, 1, 2].map(() => {
    const p = new THREE.PointLight(0xffc48a, 95, 36, 1.6);
    p.position.set(0, 8.3, 0);
    group.add(p);
    return p;
  });

  // ---- neon signs
  {
    const words = [
      ['DRIFT', '#ff3df2'], ['ドリフト', '#2de2ff'], ['RAMEN', '#ffb13d'], ['ラーメン', '#ff4d4d'], ['HOTEL', '#7dff6a'],
      ['24H', '#2de2ff'], ['PARKING', '#ffe14d'], ['カラオケ', '#ff3df2'], ['BAR', '#ff5a3c'], ['GARAGE', '#2de2ff'],
      ['走り屋', '#ff3df2'], ['TYRES', '#ffe14d'], ['SUSHI', '#7dff6a'], ['峠', '#ff4d4d'], ['NIGHT RUN', '#b46bff'],
    ];
    const textures = words.map(([t, c]) => textTexture(t, { color: c }));
    const inner = buildings.filter((b) => !b.outer);
    for (let i = 0; i < 46; i++) {
      const b = inner[Math.floor(rand() * inner.length)];
      const tex = textures[i % textures.length];
      const w = 7 + rand() * 6;
      const hgt = w * 0.3;
      const y = 5 + rand() * Math.min(18, b.h - 8);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.9, 1.9, 1.9), side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), mat);
      const face = Math.floor(rand() * 4);
      if (face === 0) mesh.position.set(b.cx + b.hx + 0.3, y, b.cz), (mesh.rotation.y = Math.PI / 2);
      else if (face === 1) mesh.position.set(b.cx - b.hx - 0.3, y, b.cz), (mesh.rotation.y = -Math.PI / 2);
      else if (face === 2) mesh.position.set(b.cx, y, b.cz + b.hz + 0.3);
      else mesh.position.set(b.cx, y, b.cz - b.hz - 0.3), (mesh.rotation.y = Math.PI);
      group.add(mesh);
    }
  }

  // ---- interface
  const nearestRoad = (v) => {
    let best = ROADS[0];
    for (const r of ROADS) if (Math.abs(v - r) < Math.abs(v - best)) best = r;
    return best;
  };
  const lim = RING;
  const tmp = [];

  return {
    id: 'city',
    group,
    world,
    env,
    sun,
    sunDir: moonDir,
    shadowSize: 70,
    night: true,
    fog: new THREE.FogExp2(0x090b17, 0.0042),
    exposure: 1.05,
    bloom: { strength: 0.6, radius: 0.55, threshold: 1.0 },
    smokeColor: 0x9aa3b5,
    yOffset: 0,
    spawn: { x: 0.5 * PITCH + 4.5, z: -RING + 30, yaw: 0 },
    surfaceAt(x, z, slot, out) {
      out.y = 0;
      out.mu = 1;
      out.rr = 0.013;
      out.sx = 0;
      out.sz = 0;
      out.kind = 0;
      return out;
    },
    resetPose(x, z) {
      const rx = nearestRoad(x);
      const rz = nearestRoad(z);
      const cx = Math.max(-lim, Math.min(lim, x));
      const cz = Math.max(-lim, Math.min(lim, z));
      if (Math.abs(x - rx) < Math.abs(z - rz)) return { x: rx + 4.5, z: cz, yaw: 0 };
      return { x: cx, z: rz - 4.5, yaw: Math.PI / 2 };
    },
    minimap: {
      bounds: { minX: -EDGE - 6, maxX: EDGE + 6, minZ: -EDGE - 6, maxZ: EDGE + 6 },
      // drawn in world units (x, z); the HUD supplies the transform
      draw(ctx) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(-EDGE, -EDGE, 2 * EDGE, 2 * EDGE);
        ctx.fillStyle = 'rgba(8,10,16,0.92)';
        for (const b of buildings) {
          if (b.outer) continue;
          ctx.fillRect(b.cx - b.hx, b.cz - b.hz, b.hx * 2, b.hz * 2);
        }
        ctx.strokeStyle = '#2de2ff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, 7);
        ctx.stroke();
      },
    },
    update(dt, time, camera, car) {
      sky.position.copy(camera.position);
      if (!car) return;
      // three nearest lamps light the car
      tmp.length = 0;
      for (const l of lamps) {
        const d = (l.hx - car.x) ** 2 + (l.hz - car.z) ** 2;
        if (d < 3600) tmp.push([d, l]);
      }
      tmp.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < lampLights.length; i++) {
        const e = tmp[i];
        if (e) {
          lampLights[i].position.set(e[1].hx, 8.2, e[1].hz);
          lampLights[i].visible = true;
        } else lampLights[i].visible = false;
      }
    },
    dispose() {
      disposeGroup(group);
      env.dispose();
    },
  };
}
