// Mountain pass at golden hour: a 2.1 km loop with 60 m of climb, guardrails
// both sides, gravel shoulders and pine forest.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld } from '../physics/collision.js';
import { rng, fbm, smoothstep, makeSky, envFromSky, roadStripTexture, textTexture, disposeGroup } from './common.js';
import { samplePath, ROAD_HALF, SHOULDER } from './mountain-path.js';

const LIFT = 0.04; // road surface sits this far above the terrain mesh
const RAIL = ROAD_HALF + SHOULDER;
const GRID = 7;
const SIZE = 1500;
const CENTER = { x: -15, z: 70 };

export function createMountain({ renderer }) {
  const group = new THREE.Group();
  const world = new CollisionWorld();
  const rand = rng(909);
  const P = samplePath();
  const n = P.n;

  // ---- sky and light
  const sunDir = new THREE.Vector3(-0.62, 0.27, -0.74).normalize();
  const sky = makeSky({ top: 0x274a8f, horizon: 0xf0b383, bottom: 0x4b4038, sunDir, sunColor: 0xffc890, sunSize: 0.0016, sunGlow: 1.0 });
  group.add(sky);
  const env = envFromSky(renderer, sky, 0x4d4a35);
  group.add(new THREE.HemisphereLight(0xb9c9ff, 0x6b5a45, 0.85));
  const sun = new THREE.DirectionalLight(0xffd0a0, 3.0);
  group.add(sun, sun.target);

  // ---- spatial index over the centreline
  const CELL = 50;
  const buckets = new Map();
  const bkey = (ix, iz) => ix * 4096 + iz;
  for (let i = 0; i < n; i++) {
    const k = bkey(Math.floor(P.x[i] / CELL) + 2048, Math.floor(P.z[i] / CELL) + 2048);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(i);
  }
  // nearest sample within about 100 m, or -1
  const nearest = (x, z) => {
    const cx = Math.floor(x / CELL) + 2048;
    const cz = Math.floor(z / CELL) + 2048;
    let best = -1;
    let bd = Infinity;
    for (let ix = cx - 2; ix <= cx + 2; ix++) {
      for (let iz = cz - 2; iz <= cz + 2; iz++) {
        const b = buckets.get(bkey(ix, iz));
        if (!b) continue;
        for (let k = 0; k < b.length; k++) {
          const i = b[k];
          const d = (P.x[i] - x) ** 2 + (P.z[i] - z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    nearest.dist = Math.sqrt(bd);
    return best;
  };

  // ---- terrain
  const coarse = [];
  for (let i = 0; i < n; i += 40) coarse.push(i);
  const baseElevation = (x, z) => {
    let sw = 0;
    let sy = 0;
    for (const i of coarse) {
      const d2 = (P.x[i] - x) ** 2 + (P.z[i] - z) ** 2 + 400;
      const w = 1 / (d2 * d2);
      sw += w;
      sy += w * P.y[i];
    }
    return sy / sw;
  };
  const cells = Math.round(SIZE / GRID);
  const verts = cells + 1;
  const x0 = CENTER.x - SIZE / 2;
  const z0 = CENTER.z - SIZE / 2;
  const heights = new Float32Array(verts * verts);
  const roadDist = new Float32Array(verts * verts);
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const x = x0 + ix * GRID;
      const z = z0 + iz * GRID;
      const i = nearest(x, z);
      const d = i < 0 ? 999 : nearest.dist;
      let e = baseElevation(x, z);
      if (i >= 0) e += (P.y[i] - e) * (1 - smoothstep(12, 90, d));
      const hills = (fbm(x / 95 + 3.1, z / 95 + 7.7) - 0.43) * 52 + (fbm(x / 24, z / 24) - 0.5) * 7;
      const r = Math.hypot(x - CENTER.x, z - CENTER.z);
      const far = smoothstep(430, 720, r) * (70 + 190 * fbm(x / 250 + 11, z / 250 + 5));
      heights[iz * verts + ix] = e + hills * smoothstep(9, 75, d) + far;
      roadDist[iz * verts + ix] = d;
    }
  }
  const heightAt = (x, z) => {
    const fx = Math.min(cells - 1e-3, Math.max(0, (x - x0) / GRID));
    const fz = Math.min(cells - 1e-3, Math.max(0, (z - z0) / GRID));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = heights[iz * verts + ix];
    const b = heights[iz * verts + ix + 1];
    const c = heights[(iz + 1) * verts + ix];
    const d = heights[(iz + 1) * verts + ix + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
  {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, cells, cells);
    geo.rotateX(-Math.PI / 2);
    geo.translate(CENTER.x, 0, CENTER.z);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // PlaneGeometry rows run from -z to +z after the rotation, same as ours
      pos.setY(i, heights[i]);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const grassA = new THREE.Color(0x5b6a2c);
    const grassB = new THREE.Color(0x8a8440);
    const rock = new THREE.Color(0x6a6057);
    const dirt = new THREE.Color(0x7c6c56);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      c.copy(grassA).lerp(grassB, fbm(x / 40, z / 40, 3));
      c.lerp(rock, smoothstep(0.82, 0.6, nor.getY(i)));
      c.lerp(dirt, 1 - smoothstep(7, 15, roadDist[i]));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    terrain.receiveShadow = true;
    group.add(terrain);
  }

  // ---- road, shoulders, guardrails
  const leftX = (i) => P.tz[i];
  const leftZ = (i) => -P.tx[i];
  const ribbon = (offA, offB, yA, yB, vScale) => {
    const pos = [];
    const uv = [];
    const idx = [];
    for (let k = 0; k <= n; k++) {
      const i = k % n;
      const lx = leftX(i);
      const lz = leftZ(i);
      pos.push(P.x[i] + lx * offA, P.y[i] + yA, P.z[i] + lz * offA);
      pos.push(P.x[i] + lx * offB, P.y[i] + yB, P.z[i] + lz * offB);
      const v = (k * P.step) / vScale;
      uv.push(0, v, 1, v);
      if (k < n) {
        const a = k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  {
    const tex = roadStripTexture({ lanes: 2, double: true, base: 54 });
    const road = new THREE.Mesh(ribbon(ROAD_HALF, -ROAD_HALF, LIFT, LIFT, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86 }));
    road.receiveShadow = true;
    group.add(road);
    const gravel = new THREE.MeshStandardMaterial({ color: 0x8a7d68, roughness: 1 });
    for (const s of [1, -1]) {
      const g = s > 0 ? ribbon(RAIL + 1.6, ROAD_HALF, LIFT - 0.06, LIFT - 0.005, 10) : ribbon(-ROAD_HALF, -RAIL - 1.6, LIFT - 0.005, LIFT - 0.06, 10);
      const m = new THREE.Mesh(g, gravel);
      m.receiveShadow = true;
      group.add(m);
    }
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.38, metalness: 0.85, side: THREE.DoubleSide });
    const posts = [];
    const postGeo = new THREE.BoxGeometry(0.1, 0.8, 0.1);
    postGeo.translate(0, 0.4, 0);
    for (const s of [1, -1]) {
      const off = s * (RAIL + 0.05);
      const rail = new THREE.Mesh(ribbon(off, off, LIFT + 0.44, LIFT + 0.78, 4), railMat);
      rail.castShadow = true;
      group.add(rail);
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        const ax = P.x[i] + leftX(i) * off;
        const az = P.z[i] + leftZ(i) * off;
        const bx = P.x[j] + leftX(j) * off;
        const bz = P.z[j] + leftZ(j) * off;
        world.addWall(ax, az, bx, bz, 1.4, s);
        posts.push([ax + leftX(i) * s * 0.1, P.y[i] + LIFT, az + leftZ(i) * s * 0.1]);
      }
    }
    const postMesh = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x8d9195, roughness: 0.5, metalness: 0.7 }), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      postMesh.setMatrixAt(i, m);
    });
    group.add(postMesh);
  }

  // ---- start gantry
  {
    const i = 6;
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.5, metalness: 0.7 });
    for (const s of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.4, 0.4), metal);
      post.position.set(s * (RAIL + 1), 3.2, 0);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(RAIL * 2 + 2.4, 1.5, 0.3), metal);
    beam.position.y = 5.8;
    beam.castShadow = true;
    g.add(beam);
    for (const side of [1, -1]) {
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 1.25),
        new THREE.MeshBasicMaterial({ map: textTexture('峠  TOUGE PASS  峠', { color: '#ffb13d', w: 1024, h: 128, font: 'bold 92px "Arial Black", Arial, sans-serif' }), transparent: true }),
      );
      banner.position.set(0, 5.8, side * 0.17);
      if (side < 0) banner.rotation.y = Math.PI;
      g.add(banner);
    }
    g.position.set(P.x[i], P.y[i], P.z[i]);
    g.rotation.y = Math.atan2(P.tx[i], P.tz[i]);
    group.add(g);
  }

  // ---- forest
  {
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6);
    trunk.translate(0, 1.1, 0);
    const parts = [trunk];
    const tiers = [
      [2.3, 3.6, 1.5],
      [1.8, 3.2, 3.2],
      [1.25, 2.8, 4.9],
    ];
    for (const [r, h, y] of tiers) {
      const cone = new THREE.ConeGeometry(r, h, 7);
      cone.translate(0, y + h / 2, 0);
      parts.push(cone);
    }
    const brown = new THREE.Color(0x4a3524);
    parts.forEach((g, k) => {
      const c = new Float32Array(g.attributes.position.count * 3);
      const base = k === 0 ? brown : new THREE.Color(0x26401f).lerp(new THREE.Color(0x3d5a2a), k / 4);
      for (let i = 0; i < c.length; i += 3) {
        c[i] = base.r;
        c[i + 1] = base.g;
        c[i + 2] = base.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    });
    const treeGeo = mergeGeometries(parts);
    const spots = [];
    let guard = 0;
    while (spots.length < 3200 && guard++ < 60000) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 560;
      const x = CENTER.x + Math.cos(a) * r;
      const z = CENTER.z + Math.sin(a) * r;
      const i = nearest(x, z);
      if (i >= 0 && nearest.dist < RAIL + 4.5) continue;
      if (fbm(x / 60 + 20, z / 60, 3) < 0.4) continue; // clearings
      spots.push([x, heightAt(x, z) - 0.3, z, 0.75 + rand() * 1.1, rand() * 6.28]);
    }
    const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      q.setFromAxisAngle(up, s[4]);
      m.compose(new THREE.Vector3(s[0], s[1], s[2]), q, new THREE.Vector3(s[3], s[3] * (0.9 + rand() * 0.35), s[3]));
      trees.setMatrixAt(i, m);
      const t = 0.8 + rand() * 0.4;
      trees.setColorAt(i, col.setRGB(t, t, t * 0.92));
    });
    trees.castShadow = true;
    trees.receiveShadow = true;
    group.add(trees);
  }

  // ---- surface queries
  const hints = new Int32Array(8);
  const locate = (x, z, slot) => {
    let h = hints[slot];
    let best = h;
    let bd = Infinity;
    for (let k = -24; k <= 24; k++) {
      const i = (h + k + n) % n;
      const d = (P.x[i] - x) ** 2 + (P.z[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (bd > 900) {
      for (let i = 0; i < n; i++) {
        const d = (P.x[i] - x) ** 2 + (P.z[i] - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    hints[slot] = best;
    return best;
  };

  return {
    id: 'mountain',
    group,
    world,
    env,
    sun,
    sunDir,
    shadowSize: 90,
    night: false,
    fog: new THREE.FogExp2(0xdfb48f, 0.00105),
    exposure: 0.95,
    bloom: { strength: 0.28, radius: 0.7, threshold: 0.95 },
    smokeColor: 0xf0e2d2,
    yOffset: LIFT,
    spawn: { x: P.x[16] - leftX(16) * 2.6, z: P.z[16] - leftZ(16) * 2.6, yaw: Math.atan2(P.tx[16], P.tz[16]) },
    surfaceAt(x, z, slot, out) {
      const i = locate(x, z, slot);
      // project onto the neighbouring segment for a smooth height
      const dx = x - P.x[i];
      const dz = z - P.z[i];
      const along = dx * P.tx[i] + dz * P.tz[i];
      const j = along >= 0 ? (i + 1) % n : (i + n - 1) % n;
      const t = Math.min(1, Math.abs(along) / P.step);
      const lat = dx * leftX(i) + dz * leftZ(i);
      const grade = (P.y[(i + 1) % n] - P.y[(i + n - 1) % n]) / (2 * P.step);
      out.y = P.y[i] + (P.y[j] - P.y[i]) * t + LIFT;
      out.sx = grade * P.tx[i];
      out.sz = grade * P.tz[i];
      if (Math.abs(lat) <= ROAD_HALF) {
        out.mu = 1;
        out.rr = 0.013;
        out.kind = 0;
      } else {
        out.mu = 0.62;
        out.rr = 0.04;
        out.kind = 1;
      }
      return out;
    },
    resetPose(x, z) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (P.x[i] - x) ** 2 + (P.z[i] - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return { x: P.x[best] - leftX(best) * 2.6, z: P.z[best] - leftZ(best) * 2.6, yaw: Math.atan2(P.tx[best], P.tz[best]) };
    },
    minimap: {
      bounds: { minX: -330, maxX: 300, minZ: -220, maxZ: 360 },
      draw(ctx) {
        ctx.lineJoin = 'round';
        for (const [w, c] of [[26, 'rgba(8,10,16,0.9)'], [13, 'rgba(255,255,255,0.78)']]) {
          ctx.strokeStyle = c;
          ctx.lineWidth = w;
          ctx.beginPath();
          for (let i = 0; i < n; i += 4) {
            if (i === 0) ctx.moveTo(P.x[i], P.z[i]);
            else ctx.lineTo(P.x[i], P.z[i]);
          }
          ctx.closePath();
          ctx.stroke();
        }
        ctx.fillStyle = '#ffb13d';
        ctx.fillRect(P.x[6] - 12, P.z[6] - 12, 24, 24);
      },
    },
    update(dt, time, camera) {
      sky.position.copy(camera.position);
    },
    dispose() {
      disposeGroup(group);
      env.dispose();
    },
  };
}
