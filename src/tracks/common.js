// Shared building blocks for the locations: sky, procedural textures, noise.

import * as THREE from 'three';

// ---- deterministic random / noise ------------------------------------------

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z, octaves = 4) {
  let amp = 0.5;
  let f = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- sky ---------------------------------------------------------------------

export function makeSky({ top, horizon, bottom, sunDir, sunColor = 0xffffff, sunSize = 0.02, sunGlow = 0.4, stars = 0 }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) },
      horizon: { value: new THREE.Color(horizon) },
      bottom: { value: new THREE.Color(bottom) },
      sunDir: { value: sunDir.clone().normalize() },
      sunColor: { value: new THREE.Color(sunColor) },
      sunSize: { value: sunSize },
      sunGlow: { value: sunGlow },
      stars: { value: stars },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; uniform float sunGlow; uniform float stars;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h * 3.0, 0.0, 1.0), 0.6));
        float c = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(c, 6.0) * sunGlow * 0.35 + pow(c, 60.0) * sunGlow);
        col += sunColor * smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.55, c) * 6.0;
        if (stars > 0.0 && h > 0.0) {
          vec3 g = floor(d * 260.0);
          float s = hash(g);
          col += vec3(step(0.9975, s)) * stars * smoothstep(0.02, 0.3, h) * (0.4 + 0.6 * hash(g + 3.1));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Prefiltered environment map from a sky (plus an optional ground colour), so
// paint and glass reflect the location they are in.
export function envFromSky(renderer, sky, groundColor, extras = []) {
  const scene = new THREE.Scene();
  const clone = sky.clone();
  scene.add(clone);
  for (const e of extras) scene.add(e);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(900, 24),
    new THREE.MeshBasicMaterial({ color: groundColor }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  scene.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0, 0.5, 2000).texture;
  pm.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
  return tex;
}

// ---- textures ----------------------------------------------------------------

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, repeatX = 1, repeatY = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(ctx, w, h, base, spread, count, rand, sizeMax = 2) {
  for (let i = 0; i < count; i++) {
    const v = Math.max(0, Math.min(255, base + (rand() - 0.5) * spread));
    ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v * 1.02) | 0},${0.25 + rand() * 0.5})`;
    const s = 1 + rand() * sizeMax;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

export function asphaltTexture({ base = 52, seed = 1, size = 512 } = {}) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  ctx.fillStyle = `rgb(${base},${base},${base + 2})`;
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, base, 46, size * size * 0.35, rand);
  // patches and tar seams
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? 20 : 90},${rand() < 0.5 ? 20 : 90},${rand() < 0.5 ? 22 : 92},0.06)`;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 30 + rand() * 90, 20 + rand() * 60, rand() * 3, 0, 7);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(10,10,10,0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    let x = rand() * size;
    let y = rand() * size;
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (rand() - 0.5) * 90;
      y += (rand() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return finish(c);
}

// Road strip for a ribbon mesh: u across the width, v along the length.
export function roadStripTexture({ lanes = 2, edge = true, base = 50, dash = true, double = false } = {}) {
  const w = 512;
  const h = 1024;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rand = rng(7);
  ctx.fillStyle = `rgb(${base},${base},${base + 2})`;
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, base, 44, w * h * 0.3, rand);
  // tyre-polished wheel tracks
  for (let l = 0; l < lanes; l++) {
    const cx = ((l + 0.5) / lanes) * w;
    for (const off of [-0.19, 0.19]) {
      const g = ctx.createLinearGradient(cx + off * (w / lanes) - 22, 0, cx + off * (w / lanes) + 22, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }
  ctx.fillStyle = 'rgba(232,232,224,0.92)';
  if (edge) {
    ctx.fillRect(w * 0.03, 0, 9, h);
    ctx.fillRect(w * 0.97 - 9, 0, 9, h);
  }
  ctx.fillStyle = 'rgba(236,196,58,0.95)';
  if (double) {
    ctx.fillRect(w / 2 - 9, 0, 6, h);
    ctx.fillRect(w / 2 + 3, 0, 6, h);
  } else if (dash) {
    ctx.fillStyle = 'rgba(232,232,224,0.92)';
    ctx.fillRect(w / 2 - 4, 0, 8, h * 0.45);
  }
  return finish(c);
}

export function concreteTexture({ seed = 3, base = 128, joints = true } = {}) {
  const size = 512;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  ctx.fillStyle = `rgb(${base},${base},${base - 3})`;
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, base, 38, size * size * 0.25, rand, 3);
  for (let i = 0; i < 18; i++) {
    const dark = rand() < 0.65;
    ctx.fillStyle = dark ? 'rgba(30,30,28,0.03)' : 'rgba(230,230,225,0.03)';
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 60 + rand() * 160, 40 + rand() * 120, rand() * 3, 0, 7);
    ctx.fill();
  }
  if (joints) {
    ctx.strokeStyle = 'rgba(25,25,25,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, size, size);
  }
  return finish(c);
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.35)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function textTexture(text, { color = '#ff3df2', font = 'bold 120px "Arial Black", Arial, sans-serif', w = 512, h = 160, bg = null } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  const m = ctx.measureText(text);
  const scale = Math.min(1, (w * 0.9) / m.width);
  ctx.save();
  ctx.translate(w / 2, h / 2 + 4);
  ctx.scale(scale, 1);
  ctx.fillText(text, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.shadowBlur = 0;
  ctx.fillText(text, 0, 0);
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Box whose side-face UVs are scaled to real size, so one tiling facade
// texture can serve buildings of any proportion. Top face UVs collapse to a
// single texel.
export function facadeBox(w, h, d, tileW, tileH, uOffset = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; four vertices each
  const faceW = [d, d, 0, 0, w, w];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      if (f === 2 || f === 3) uv.setXY(i, 0.001, 0.001);
      else uv.setXY(i, uOffset + (uv.getX(i) * faceW[f]) / tileW, (uv.getY(i) * h) / tileH);
    }
  }
  g.translate(0, h / 2, 0);
  return g;
}

export function disposeGroup(group) {
  const seen = new Set();
  group.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture) v.dispose();
      }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture) u.value.dispose();
      m.dispose();
    }
  });
}
