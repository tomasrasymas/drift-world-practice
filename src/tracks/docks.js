// Container terminal by day: a wide concrete apron with a painted skidpad,
// figure-eight islands, a container canyon and a soaked low-grip pad.

import * as THREE from 'three';
import { CollisionWorld } from '../physics/collision.js';
import { rng, makeSky, envFromSky, concreteTexture, textTexture, disposeGroup } from './common.js';

const HX = 172; // half extents of the apron
const HZ = 116;
const WET = { minX: 66, maxX: 158, minZ: 22, maxZ: 100 };

function ribTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 256; x++) {
    const v = 150 + 85 * Math.sin((x / 256) * Math.PI * 2 * 16);
    ctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    ctx.fillRect(x, 0, 1, 128);
  }
  const rand = rng(3);
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(60,40,25,${rand() * 0.12})`;
    ctx.fillRect(rand() * 256, rand() * 128, 4 + rand() * 30, 2 + rand() * 40);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, 256, 3);
  ctx.fillRect(0, 125, 256, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function createDocks({ renderer }) {
  const group = new THREE.Group();
  const world = new CollisionWorld();
  const rand = rng(77123);

  // ---- sky and light
  const sunDir = new THREE.Vector3(0.42, 0.7, -0.38).normalize();
  const sky = makeSky({ top: 0x2a66c8, horizon: 0xb9d3ea, bottom: 0x8497a6, sunDir, sunColor: 0xfff3d8, sunSize: 0.0012, sunGlow: 0.5 });
  group.add(sky);
  const env = envFromSky(renderer, sky, 0x77736c);
  group.add(new THREE.HemisphereLight(0xcfe0ff, 0x7b7468, 0.85));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
  group.add(sun, sun.target);

  // ---- apron
  const slab = concreteTexture({ seed: 21, base: 134 });
  slab.repeat.set((HX * 2 + 80) / 8, (HZ * 2 + 80) / 8);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 80, HZ * 2 + 80), new THREE.MeshStandardMaterial({ map: slab, roughness: 0.82 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // soaked pad: darker and glossy
  {
    const w = WET.maxX - WET.minX;
    const d = WET.maxZ - WET.minZ;
    const wetTex = concreteTexture({ seed: 22, base: 70 });
    wetTex.repeat.set(w / 8, d / 8);
    const wet = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ map: wetTex, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    wet.rotation.x = -Math.PI / 2;
    wet.position.set((WET.minX + WET.maxX) / 2, 0.01, (WET.minZ + WET.maxZ) / 2);
    wet.receiveShadow = true;
    group.add(wet);
  }

  // water
  {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1200), new THREE.MeshStandardMaterial({ color: 0x1d3f4f, roughness: 0.12, metalness: 0.2, envMapIntensity: 1.3 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -1.6, HZ + 600 + 2);
    group.add(water);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 80, 3, 2), new THREE.MeshStandardMaterial({ color: 0x5d5f5e, roughness: 0.9 }));
    quay.position.set(0, -1.5, HZ + 2.6);
    group.add(quay);
    // land behind the sheds so the horizon is not empty
    const land = new THREE.Mesh(new THREE.PlaneGeometry(2400, 900), new THREE.MeshStandardMaterial({ color: 0x6f6c63, roughness: 1 }));
    land.rotation.x = -Math.PI / 2;
    land.position.set(0, -0.05, -HZ - 480);
    group.add(land);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(900, HZ * 2 + 90), new THREE.MeshStandardMaterial({ color: 0x6f6c63, roughness: 1 }));
      side.rotation.x = -Math.PI / 2;
      side.position.set(s * (HX + 40 + 450), -0.05, 0);
      group.add(side);
    }
  }

  // ---- painted lines
  const paint = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
  const yellow = paint(0xd9a514);
  const whiteP = paint(0xdedfda);
  const ring = (x, z, r, w, mat) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r - w / 2, r + w / 2, 96), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    m.receiveShadow = true;
    group.add(m);
  };
  const line = (x, z, sx, sz, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    m.receiveShadow = true;
    group.add(m);
  };
  const SKID = { x: -108, z: -6 };
  ring(SKID.x, SKID.z, 16, 0.3, whiteP);
  ring(SKID.x, SKID.z, 30, 0.3, yellow);
  ring(SKID.x, SKID.z, 44, 0.2, whiteP);
  // bay grid
  for (let x = -40; x <= 60; x += 20) line(x, -52, 0.18, 70, yellow);
  line(10, -87, 100, 0.18, yellow);
  line(10, -17, 100, 0.18, yellow);
  // wet pad border
  line((WET.minX + WET.maxX) / 2, WET.minZ, WET.maxX - WET.minX, 0.3, yellow);
  line((WET.minX + WET.maxX) / 2, WET.maxZ, WET.maxX - WET.minX, 0.3, yellow);
  line(WET.minX, (WET.minZ + WET.maxZ) / 2, 0.3, WET.maxZ - WET.minZ, yellow);
  line(WET.maxX, (WET.minZ + WET.maxZ) / 2, 0.3, WET.maxZ - WET.minZ, yellow);
  for (const [text, x, z, w, rot] of [
    ['SKIDPAD', SKID.x, SKID.z + 52, 30, 0],
    ['WET', (WET.minX + WET.maxX) / 2, WET.minZ - 6, 14, 0],
    ['DRIFT ZONE', -20, -100, 44, 0],
  ]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.3),
      new THREE.MeshStandardMaterial({ map: textTexture(text, { color: '#e9e9e2' }), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.PI + rot;
    m.position.set(x, 0.016, z);
    group.add(m);
  }

  // ---- containers
  const C20 = { len: 6.06, w: 2.44, h: 2.59 };
  const C40 = { len: 12.19, w: 2.44, h: 2.59 };
  const colors = [0x9c3b2a, 0x1f5fa8, 0x2f7a4a, 0xd97a1c, 0xd8d6cf, 0xc2a019, 0x7a2f3a, 0x3b4a57];
  const boxes = { 20: [], 40: [] };
  const mapRects = [];
  // A stack is `wide` containers side by side, `high` tall, long axis along z
  // before rotation.
  const addStack = (cx, cz, angle, size, wide, high) => {
    const c = size === 20 ? C20 : C40;
    const gap = 0.12;
    const s = Math.sin(angle);
    const co = Math.cos(angle);
    for (let i = 0; i < wide; i++) {
      const lx = (i - (wide - 1) / 2) * (c.w + gap);
      const levels = Math.max(1, high - (rand() < 0.3 ? 1 : 0));
      for (let k = 0; k < levels; k++) {
        boxes[size].push({ x: cx + lx * co, z: cz - lx * s, y: k * c.h, angle, color: colors[Math.floor(rand() * colors.length)] });
      }
    }
    const hx = (wide * (c.w + gap)) / 2;
    world.addBox(cx, cz, hx, c.len / 2, angle);
    mapRects.push({ cx, cz, hx, hz: c.len / 2, angle });
  };

  // figure-eight islands
  addStack(-28, 22, 0, 20, 2, 2);
  addStack(34, 22, 0, 20, 2, 2);
  // container canyon, south-east
  for (let i = 0; i < 6; i++) addStack(70 + i * 15, -96, Math.PI / 2, 40, 2, 3);
  for (let i = 0; i < 4; i++) addStack(84 + i * 15, -62, Math.PI / 2, 40, 2, 2);
  addStack(150, -62, 0, 40, 2, 3);
  addStack(150, -30, 0, 40, 3, 2);
  addStack(72, -34, 0.5, 20, 2, 2);
  addStack(104, -30, -0.35, 20, 1, 2);
  // scattered along the south and west edges
  for (let i = 0; i < 7; i++) addStack(-150 + i * 14, -104, Math.PI / 2, 40, 2, 2 + Math.floor(rand() * 2));
  for (let i = 0; i < 4; i++) addStack(-162, -60 + i * 30, 0, 40, 2, 2 + Math.floor(rand() * 2));
  addStack(-60, 70, 0.3, 40, 2, 2);
  addStack(4, 78, -0.25, 20, 3, 2);
  addStack(-150, 92, Math.PI / 2, 40, 2, 3);

  {
    const tex = ribTexture();
    for (const size of [20, 40]) {
      const c = size === 20 ? C20 : C40;
      const g = new THREE.BoxGeometry(c.w, c.h, c.len);
      g.translate(0, c.h / 2, 0);
      const uv = g.attributes.uv;
      for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) uv.setX(f * 4 + v, uv.getX(f * 4 + v) * (f < 2 ? size / 10 : 0.4));
      const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.25 }), boxes[size].length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const col = new THREE.Color();
      boxes[size].forEach((b, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.angle);
        m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.setHex(b.color));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ---- sheds along the south side, walls east and west
  {
    const shedMat = new THREE.MeshStandardMaterial({ map: ribTexture(), color: 0x8f9aa3, roughness: 0.7, metalness: 0.3 });
    shedMat.map.repeat.set(14, 1);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.4 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2c3a4a, roughness: 0.5, metalness: 0.5 });
    for (let i = -1; i <= 1; i++) {
      const shed = new THREE.Mesh(new THREE.BoxGeometry(104, 15, 44), [shedMat, shedMat, roofMat, roofMat, shedMat, shedMat]);
      shed.position.set(i * 112, 7.5, -HZ - 24);
      shed.castShadow = true;
      shed.receiveShadow = true;
      group.add(shed);
      for (let k = -1; k <= 1; k++) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 0.3), doorMat);
        door.position.set(i * 112 + k * 30, 4.5, -HZ - 1.9);
        group.add(door);
      }
    }
    world.addBox(0, -HZ - 6, HX + 40, 4.4);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8b8880, roughness: 0.9 });
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.2, HZ * 2 + 6), wallMat);
      wall.position.set(s * (HX + 0.6), 1.6, 0);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
      world.addBox(s * (HX + 5), 0, 5, HZ + 20);
    }
  }

  // ---- quay: barrier, bollards, gantry cranes, a ship
  {
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, 0.85, 0.6), new THREE.MeshStandardMaterial({ color: 0xa9a79f, roughness: 0.85 }));
    barrier.position.set(0, 0.42, HZ - 0.3);
    barrier.castShadow = true;
    group.add(barrier);
    world.addBox(0, HZ + 4.4, HX + 20, 5);

    const steel = new THREE.MeshStandardMaterial({ color: 0xd9541e, roughness: 0.5, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.5 });
    for (const cx of [-70, 60]) {
      const crane = new THREE.Group();
      const legs = [
        [-14, 0], [14, 0], [-14, -22], [14, -22],
      ];
      for (const [lx, lz] of legs) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 46, 1.6), steel);
        leg.position.set(lx, 23, lz);
        leg.castShadow = true;
        crane.add(leg);
        world.addBox(cx + lx, HZ - 8 + lz, 1.0, 1.0);
        mapRects.push({ cx: cx + lx, cz: HZ - 8 + lz, hx: 1.2, hz: 1.2, angle: 0 });
      }
      for (const lz of [0, -22]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(30, 2, 1.8), steel);
        beam.position.set(0, 45, lz);
        crane.add(beam);
        const low = new THREE.Mesh(new THREE.BoxGeometry(30, 1.2, 1.2), steel);
        low.position.set(0, 12, lz);
        crane.add(low);
      }
      const boom = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 96), steel);
      boom.position.set(0, 48, 14);
      boom.castShadow = true;
      crane.add(boom);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 6), dark);
      cab.position.set(0, 44.5, 10);
      crane.add(cab);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 22, 1.4), steel);
      mast.position.set(0, 60, -11);
      crane.add(mast);
      crane.position.set(cx, 0, HZ - 8);
      group.add(crane);
    }

    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(250, 16, 34), new THREE.MeshStandardMaterial({ color: 0x1c2330, roughness: 0.6, metalness: 0.3 }));
    hull.position.y = 5;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(250.2, 3, 34.2), new THREE.MeshStandardMaterial({ color: 0x8c2a22, roughness: 0.7 }));
    stripe.position.y = -1;
    const house = new THREE.Mesh(new THREE.BoxGeometry(18, 22, 30), new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.6 }));
    house.position.set(-98, 24, 0);
    ship.add(hull, stripe, house);
    const cg = new THREE.BoxGeometry(12.19, 2.59, 2.44);
    const stack = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.2 }), 12 * 5 * 10);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    for (let ix = 0; ix < 12; ix++) {
      const tall = 2 + Math.floor(rand() * 4);
      for (let iy = 0; iy < 5; iy++) {
        for (let iz = 0; iz < 10; iz++) {
          if (iy >= tall) m.makeScale(0, 0, 0);
          else m.makeTranslation(-72 + ix * 13.4, 14.4 + iy * 2.62, -11.5 + iz * 2.55);
          stack.setMatrixAt(n, m);
          stack.setColorAt(n, col.setHex(colors[Math.floor(rand() * colors.length)]));
          n++;
        }
      }
    }
    ship.add(stack);
    ship.position.set(-10, 0, HZ + 34);
    group.add(ship);
  }

  // ---- cones: knocked about by the car, purely cosmetic
  const cones = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    cones.push({ x: SKID.x + Math.cos(a) * 30, z: SKID.z + Math.sin(a) * 30 });
  }
  for (let i = 0; i < 9; i++) cones.push({ x: -48 + i * 13, z: -52 });
  cones.push({ x: SKID.x, z: SKID.z });
  const coneGeo = new THREE.ConeGeometry(0.19, 0.62, 12);
  coneGeo.translate(0, 0.31, 0);
  const coneMesh = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xf2600c, roughness: 0.6 }), cones.length);
  coneMesh.castShadow = true;
  coneMesh.frustumCulled = false;
  group.add(coneMesh);
  const cm = new THREE.Matrix4();
  const cq = new THREE.Quaternion();
  const ce = new THREE.Euler();
  const cOne = new THREE.Vector3(1, 1, 1);
  const cPos = new THREE.Vector3();
  const writeCone = (c, i) => {
    ce.set(c.rx, 0, c.rz);
    cq.setFromEuler(ce);
    cPos.set(c.x, c.y, c.z);
    cm.compose(cPos, cq, cOne);
    coneMesh.setMatrixAt(i, cm);
  };
  cones.forEach((c, i) => {
    Object.assign(c, { y: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, wx: 0, wz: 0, live: false });
    writeCone(c, i);
  });

  const inWet = (x, z) => x > WET.minX && x < WET.maxX && z > WET.minZ && z < WET.maxZ;

  return {
    id: 'docks',
    group,
    world,
    env,
    sun,
    sunDir,
    shadowSize: 80,
    night: false,
    fog: new THREE.Fog(0xc0d3e4, 260, 1500),
    exposure: 0.92,
    bloom: { strength: 0.1, radius: 0.4, threshold: 2.2 },
    smokeColor: 0xe9ebee,
    yOffset: 0,
    spawn: { x: -78, z: -48, yaw: Math.PI / 2 },
    surfaceAt(x, z, slot, out) {
      out.y = 0;
      out.sx = 0;
      out.sz = 0;
      if (inWet(x, z)) {
        out.mu = 0.6;
        out.rr = 0.016;
        out.kind = 2;
      } else {
        out.mu = 0.98;
        out.rr = 0.013;
        out.kind = 0;
      }
      return out;
    },
    resetPose(x, z) {
      const cx = Math.max(-HX + 8, Math.min(HX - 8, x));
      const cz = Math.max(-HZ + 8, Math.min(HZ - 8, z));
      // walk toward the middle of the apron until the spot is clear
      for (let t = 0; t <= 1; t += 0.1) {
        const px = cx * (1 - t);
        const pz = cz * (1 - t) - 52 * t;
        if (!world.blocked(px, pz, 3.2)) return { x: px, z: pz, yaw: Math.atan2(-px, -pz - 52) };
      }
      return this.spawn;
    },
    minimap: {
      bounds: { minX: -HX - 4, maxX: HX + 4, minZ: -HZ - 4, maxZ: HZ + 4 },
      draw(ctx) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(-HX, -HZ, HX * 2, HZ * 2);
        ctx.fillStyle = 'rgba(45,170,255,0.3)';
        ctx.fillRect(WET.minX, WET.minZ, WET.maxX - WET.minX, WET.maxZ - WET.minZ);
        ctx.strokeStyle = 'rgba(255,210,60,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(SKID.x, SKID.z, 30, 0, 7);
        ctx.stroke();
        ctx.fillStyle = 'rgba(8,10,16,0.95)';
        for (const r of mapRects) {
          ctx.save();
          ctx.translate(r.cx, r.cz);
          ctx.rotate(-r.angle);
          ctx.fillRect(-r.hx, -r.hz, r.hx * 2, r.hz * 2);
          ctx.restore();
        }
      },
    },
    update(dt, time, camera, car) {
      sky.position.copy(camera.position);
      if (!car) return;
      const sinY = Math.sin(car.yaw);
      const cosY = Math.cos(car.yaw);
      const lf = car.a + car.spec.overhangFront;
      const lr = car.b + car.spec.overhangRear;
      const hw = car.spec.width / 2;
      let dirty = false;
      for (let i = 0; i < cones.length; i++) {
        const c = cones[i];
        const dx = c.x - car.x;
        const dz = c.z - car.z;
        if (c.y < 0.8 && Math.abs(dx) < 4 && Math.abs(dz) < 4) {
          const px = dx * sinY + dz * cosY;
          const py = dx * cosY - dz * sinY;
          if (px < lf + 0.15 && px > -lr - 0.15 && Math.abs(py) < hw + 0.15) {
            const pvx = car.vx + car.yawRate * dz;
            const pvz = car.vz - car.yawRate * dx;
            const sp = Math.hypot(pvx, pvz);
            if (sp > 0.5) {
              c.vx = pvx * 1.15 + (Math.random() - 0.5) * 2;
              c.vz = pvz * 1.15 + (Math.random() - 0.5) * 2;
              c.vy = 1.5 + Math.min(4, sp * 0.25);
              c.wx = (Math.random() - 0.5) * 14;
              c.wz = (Math.random() - 0.5) * 14;
              c.live = true;
            }
            // shove it out of the car sideways
            const side = py >= 0 ? 1 : -1;
            const push = hw + 0.2 - Math.abs(py);
            c.x += cosY * side * push;
            c.z += -sinY * side * push;
            dirty = true;
          }
        }
        if (c.live) {
          c.vy -= 9.81 * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.z += c.vz * dt;
          c.rx += c.wx * dt;
          c.rz += c.wz * dt;
          if (c.y <= 0) {
            c.y = 0;
            c.vy = -c.vy * 0.3;
            const f = Math.max(0, 1 - 5 * dt);
            c.vx *= f;
            c.vz *= f;
            c.wx *= f;
            c.wz *= f;
            if (Math.abs(c.vy) < 0.6 && Math.hypot(c.vx, c.vz) < 0.3) {
              c.live = false;
              c.vy = 0;
              // come to rest lying on its side
              c.rx = Math.PI / 2;
            }
          }
          c.x = Math.max(-HX + 1, Math.min(HX - 1, c.x));
          c.z = Math.max(-HZ + 1, Math.min(HZ - 1, c.z));
          dirty = true;
        }
        if (dirty) writeCone(c, i);
      }
      if (dirty) coneMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      disposeGroup(group);
      env.dispose();
    },
  };
}
