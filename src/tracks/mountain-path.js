// Centreline of the mountain pass: a closed 2.1 km loop. Each control point
// is [x, z]; elevation is applied along the length in samplePath().

import * as THREE from 'three';

export const CONTROL = [
  [-240, -150],
  [-100, -185],
  [40, -165],
  [150, -190],
  [250, -130],
  [270, -30],
  [200, 40],
  [100, 30],
  [40, 80],
  [70, 160],
  [160, 190],
  [210, 260],
  [140, 330],
  [20, 320],
  [-60, 250],
  [-40, 160],
  [-130, 110],
  [-140, 20],
  [-230, -10],
  [-300, -70],
];

export const ROAD_HALF = 5.5;
export const SHOULDER = 1.4;
export const SPACING = 1.5;
export const CLIMB = 60;

// Evenly spaced samples along the loop with tangents and curvature.
export function samplePath() {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map((p) => new THREE.Vector3(p[0], 0, p[1])),
    true,
    'centripetal',
  );
  curve.arcLengthDivisions = 4000;
  const length = curve.getLength();
  const n = Math.round(length / SPACING);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = new Float32Array(n);
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    curve.getPointAt(i / n, p);
    x[i] = p.x;
    y[i] = p.y;
    z[i] = p.z;
  }
  // Elevation follows a single smooth rise and fall around the loop, which
  // keeps the gradient even (about 9% at its steepest).
  for (let i = 0; i < n; i++) y[i] = (CLIMB / 2) * (1 - Math.cos((2 * Math.PI * i) / n));
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    const b = (i + 1) % n;
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const l = Math.hypot(dx, dz);
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  return { n, x, y, z, tx, tz, length, step: length / n };
}
