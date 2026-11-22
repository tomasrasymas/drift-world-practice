// Tyre smoke and skid marks.

import * as THREE from 'three';

// ---- skid marks: a ring buffer of ground quads, one strip per wheel --------

const MAX_QUADS = 6000;

export class SkidMarks {
  constructor() {
    this.pos = new Float32Array(MAX_QUADS * 12);
    this.col = new Float32Array(MAX_QUADS * 16);
    const idx = new Uint32Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.next = 0;
    this.wheels = [0, 1, 2, 3].map(() => ({ on: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, cx: 0, cz: 0, a: 0 }));
  }

  // (x, y, z): contact point; (ax, az): unit vector across the tyre; half: half tread width
  update(i, x, y, z, ax, az, half, intensity) {
    const w = this.wheels[i];
    if (intensity < 0.06) {
      w.on = false;
      return;
    }
    const lx = x + ax * half;
    const lz = z + az * half;
    const rx = x - ax * half;
    const rz = z - az * half;
    const yy = y + 0.022;
    if (!w.on) {
      Object.assign(w, { on: true, lx, ly: yy, lz, rx, ry: yy, rz, cx: x, cz: z, a: intensity });
      return;
    }
    const d = Math.hypot(x - w.cx, z - w.cz);
    if (d < 0.3) return;
    if (d > 6) {
      // teleported (reset): start a fresh strip
      Object.assign(w, { lx, ly: yy, lz, rx, ry: yy, rz, cx: x, cz: z, a: intensity });
      return;
    }
    const q = this.next;
    this.next = (this.next + 1) % MAX_QUADS;
    const p = this.pos;
    const o = q * 12;
    p[o] = w.lx; p[o + 1] = w.ly; p[o + 2] = w.lz;
    p[o + 3] = w.rx; p[o + 4] = w.ry; p[o + 5] = w.rz;
    p[o + 6] = lx; p[o + 7] = yy; p[o + 8] = lz;
    p[o + 9] = rx; p[o + 10] = yy; p[o + 11] = rz;
    const c = this.col;
    const k = q * 16;
    const a0 = Math.min(0.78, w.a * 0.8);
    const a1 = Math.min(0.78, intensity * 0.8);
    for (let v = 0; v < 4; v++) {
      c[k + v * 4] = 0.02;
      c[k + v * 4 + 1] = 0.02;
      c[k + v * 4 + 2] = 0.022;
      c[k + v * 4 + 3] = v < 2 ? a0 : a1;
    }
    Object.assign(w, { lx, ly: yy, lz, rx, ry: yy, rz, cx: x, cz: z, a: intensity });
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  breakAll() {
    for (const w of this.wheels) w.on = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// ---- smoke: soft point sprites --------------------------------------------

const MAX_P = 700;

export class Smoke {
  constructor(color) {
    this.pos = new Float32Array(MAX_P * 3);
    this.data = new Float32Array(MAX_P * 2); // size, alpha
    this.vel = new Float32Array(MAX_P * 3);
    this.age = new Float32Array(MAX_P);
    this.life = new Float32Array(MAX_P);
    this.peak = new Float32Array(MAX_P);
    this.grow = new Float32Array(MAX_P);
    this.life.fill(0);
    this.next = 0;
    this.carry = [0, 0, 0, 0];
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.dataAttr = new THREE.BufferAttribute(this.data, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aData', this.dataAttr);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec2 aData;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(900.0, aData.x * uScale / max(0.5, -mv.z));
          vAlpha = aData.y;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = smoothstep(1.0, 0.15, d) * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * (0.82 + 0.18 * (1.0 - d)), a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(slot, rate, dt, x, y, z, vx, vy, vz, strength) {
    this.carry[slot] += rate * dt;
    while (this.carry[slot] >= 1) {
      this.carry[slot] -= 1;
      const i = this.next;
      this.next = (this.next + 1) % MAX_P;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.35;
      this.pos[i * 3 + 1] = y + 0.12 + Math.random() * 0.15;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.35;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * 1.6;
      this.vel[i * 3 + 1] = vy + 0.5 + Math.random() * 1.3;
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * 1.6;
      this.age[i] = 0;
      this.life[i] = 1.5 + Math.random() * 1.6;
      this.peak[i] = (0.1 + Math.random() * 0.12) * strength;
      this.grow[i] = 1.6 + Math.random() * 1.4;
      this.data[i * 2] = 0.7;
      this.data[i * 2 + 1] = 0;
    }
  }

  update(dt, camera, viewportHeight) {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const drag = Math.max(0, 1 - 1.8 * dt);
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.data[i * 2 + 1] = 0;
        continue;
      }
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] += (0.5 - this.vel[i * 3 + 1]) * Math.min(1, dt * 1.5);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.data[i * 2] = 0.7 + this.grow[i] * this.age[i] * (1.6 - t * 0.6);
      const fadeIn = Math.min(1, t * 9);
      this.data[i * 2 + 1] = this.peak[i] * fadeIn * (1 - t) * (1 - t);
    }
    this.posAttr.needsUpdate = true;
    this.dataAttr.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
