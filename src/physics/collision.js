// 2D collision between the car's footprint and static scenery: convex
// polygons (buildings, containers, barriers) and circles (poles, trees).
// Separating-axis test for detection, a single impulse with Coulomb friction
// for the response.

const CELL = 14;
const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);

export class CollisionWorld {
  constructor() {
    this.cells = new Map();
    this.shapes = [];
    this._stamp = 0;
    this._found = [];
    this._car = new Float64Array(8);
  }

  _insert(shape) {
    shape.stamp = 0;
    this.shapes.push(shape);
    const x0 = Math.floor(shape.minX / CELL);
    const x1 = Math.floor(shape.maxX / CELL);
    const z0 = Math.floor(shape.minZ / CELL);
    const z1 = Math.floor(shape.maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(shape);
      }
    }
    return shape;
  }

  // Box centred at (cx, cz); hx / hz are half extents along its local x / z,
  // rotated by `angle` about the vertical axis.
  addBox(cx, cz, hx, hz, angle = 0, props = {}) {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const pts = new Float64Array(8);
    const local = [-hx, -hz, hx, -hz, hx, hz, -hx, hz];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const lx = local[i * 2];
      const lz = local[i * 2 + 1];
      const x = cx + lx * c + lz * s;
      const z = cz - lx * s + lz * c;
      pts[i * 2] = x;
      pts[i * 2 + 1] = z;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return this._insert({ type: 0, pts, n: 4, minX, maxX, minZ, maxZ, ...props });
  }

  // Wall from (x1,z1) to (x2,z2). `side` shifts the thickness to one side so a
  // barrier can be thick without eating into the road: +1 is to the left of
  // the direction of travel along the segment, -1 to the right, 0 centred.
  addWall(x1, z1, x2, z2, thickness = 0.8, side = 0, props = {}) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    const angle = Math.atan2(dx, dz);
    // left of direction (dx,dz) in the x-z plane (y up) is (dz, -dx)
    const ox = (dz / len) * (thickness / 2) * side;
    const oz = (-dx / len) * (thickness / 2) * side;
    return this.addBox((x1 + x2) / 2 + ox, (z1 + z2) / 2 + oz, thickness / 2, len / 2, angle, props);
  }

  addCircle(x, z, r, props = {}) {
    return this._insert({ type: 1, x, z, r, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, ...props });
  }

  query(minX, minZ, maxX, maxZ) {
    const out = this._found;
    out.length = 0;
    const stamp = ++this._stamp;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(key(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const sh = list[i];
          if (sh.stamp === stamp) continue;
          sh.stamp = stamp;
          if (sh.maxX < minX || sh.minX > maxX || sh.maxZ < minZ || sh.minZ > maxZ) continue;
          out.push(sh);
        }
      }
    }
    return out;
  }

  // True if a disc at (x, z) overlaps any solid shape. Used to keep spawn and
  // reset points clear.
  blocked(x, z, r) {
    const list = this.query(x - r, z - r, x + r, z + r);
    for (const sh of list) {
      if (sh.type === 1) {
        if (Math.hypot(sh.x - x, sh.z - z) < sh.r + r) return true;
      } else {
        const c = closestOnPoly(sh.pts, sh.n, x, z);
        if (c.inside || c.dist < r) return true;
      }
    }
    return false;
  }

  // Resolve the vehicle against the world. Returns the hardest normal impact
  // speed (m/s) seen, 0 if nothing was hit.
  resolveVehicle(car) {
    const s = car.spec;
    const sinY = Math.sin(car.yaw);
    const cosY = Math.cos(car.yaw);
    const lf = car.a + s.overhangFront;
    const lr = car.b + s.overhangRear;
    const hw = s.width / 2;
    const P = this._car;
    const corners = [lf, hw, lf, -hw, -lr, -hw, -lr, hw];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const px = corners[i * 2];
      const py = corners[i * 2 + 1];
      const x = car.x + px * sinY + py * cosY;
      const z = car.z + px * cosY - py * sinY;
      P[i * 2] = x;
      P[i * 2 + 1] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const list = this.query(minX, minZ, maxX, maxZ);
    let impact = 0;
    for (let i = 0; i < list.length; i++) {
      const sh = list[i];
      let hit;
      if (sh.type === 0) hit = polyPoly(P, 4, sh.pts, sh.n);
      else hit = polyCircle(P, 4, sh);
      if (!hit) continue;
      const { nx, nz, depth, cx, cz } = hit;
      const rx = cx - car.x;
      const rz = cz - car.z;
      const vpx = car.vx + car.yawRate * rz;
      const vpz = car.vz - car.yawRate * rx;
      const vn = vpx * nx + vpz * nz;

      // push out
      car.x += nx * depth;
      car.z += nz * depth;
      for (let k = 0; k < 4; k++) {
        P[k * 2] += nx * depth;
        P[k * 2 + 1] += nz * depth;
      }

      if (vn < 0) {
        const e = sh.restitution ?? 0.12;
        const mu = sh.friction ?? 0.35;
        const rn = rz * nx - rx * nz;
        const kn = 1 / car.mass + (rn * rn) / car.Iz;
        const j = (-(1 + e) * vn) / kn;
        car.vx += (j * nx) / car.mass;
        car.vz += (j * nz) / car.mass;
        car.yawRate += (rn * j) / car.Iz;

        const tx = -nz;
        const tz = nx;
        const vt = vpx * tx + vpz * tz;
        const rt = rz * tx - rx * tz;
        const kt = 1 / car.mass + (rt * rt) / car.Iz;
        let jt = -vt / kt;
        const lim = mu * j;
        if (jt > lim) jt = lim;
        else if (jt < -lim) jt = -lim;
        car.vx += (jt * tx) / car.mass;
        car.vz += (jt * tz) / car.mass;
        car.yawRate += (rt * jt) / car.Iz;

        if (-vn > impact) impact = -vn;
      }
    }
    return impact;
  }
}

const hitOut = { nx: 0, nz: 0, depth: 0, cx: 0, cz: 0 };
const closeOut = { x: 0, z: 0, dist: 0, inside: false };

function inside(P, n, x, z) {
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = (P[j * 2] - P[i * 2]) * (z - P[i * 2 + 1]) - (P[j * 2 + 1] - P[i * 2 + 1]) * (x - P[i * 2]);
    if (cr !== 0) {
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

function closestOnPoly(P, n, x, z) {
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = P[i * 2];
    const az = P[i * 2 + 1];
    const ex = P[j * 2] - ax;
    const ez = P[j * 2 + 1] - az;
    let t = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t;
    const qz = az + ez * t;
    const d = (qx - x) * (qx - x) + (qz - z) * (qz - z);
    if (d < best) {
      best = d;
      bx = qx;
      bz = qz;
    }
  }
  closeOut.x = bx;
  closeOut.z = bz;
  closeOut.dist = Math.sqrt(best);
  closeOut.inside = inside(P, n, x, z);
  return closeOut;
}

// A is the car, B the obstacle. Normal points from B toward A.
function polyPoly(A, nA, B, nB) {
  let best = Infinity;
  let bnx = 0;
  let bnz = 0;
  for (let pass = 0; pass < 2; pass++) {
    const P = pass === 0 ? B : A;
    const n = pass === 0 ? nB : nA;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let ax = P[j * 2 + 1] - P[i * 2 + 1];
      let az = -(P[j * 2] - P[i * 2]);
      const len = Math.hypot(ax, az);
      if (len < 1e-9) continue;
      ax /= len;
      az /= len;
      let minA = Infinity;
      let maxA = -Infinity;
      for (let k = 0; k < nA; k++) {
        const d = A[k * 2] * ax + A[k * 2 + 1] * az;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (let k = 0; k < nB; k++) {
        const d = B[k * 2] * ax + B[k * 2 + 1] * az;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      const o1 = maxA - minB; // push A toward -axis
      const o2 = maxB - minA; // push A toward +axis
      if (o1 <= 0 || o2 <= 0) return null;
      if (o1 < o2) {
        if (o1 < best - 1e-9) {
          best = o1;
          bnx = -ax;
          bnz = -az;
        }
      } else if (o2 < best - 1e-9) {
        best = o2;
        bnx = ax;
        bnz = az;
      }
    }
  }

  // contact point: centroid of the vertices caught inside the other shape
  let cx = 0;
  let cz = 0;
  let count = 0;
  for (let k = 0; k < nA; k++) {
    if (inside(B, nB, A[k * 2], A[k * 2 + 1])) {
      cx += A[k * 2];
      cz += A[k * 2 + 1];
      count++;
    }
  }
  for (let k = 0; k < nB; k++) {
    if (inside(A, nA, B[k * 2], B[k * 2 + 1])) {
      cx += B[k * 2];
      cz += B[k * 2 + 1];
      count++;
    }
  }
  if (count === 0) {
    // corner poking through a thin wall: use the car's deepest vertex
    let deepest = Infinity;
    for (let k = 0; k < nA; k++) {
      const d = A[k * 2] * bnx + A[k * 2 + 1] * bnz;
      if (d < deepest) {
        deepest = d;
        cx = A[k * 2];
        cz = A[k * 2 + 1];
      }
    }
    count = 1;
  }
  hitOut.nx = bnx;
  hitOut.nz = bnz;
  hitOut.depth = best;
  hitOut.cx = cx / count;
  hitOut.cz = cz / count;
  return hitOut;
}

function polyCircle(A, nA, c) {
  const q = closestOnPoly(A, nA, c.x, c.z);
  if (!q.inside && q.dist >= c.r) return null;
  let nx;
  let nz;
  let depth;
  if (q.inside) {
    const d = q.dist || 1e-6;
    nx = (c.x - q.x) / d;
    nz = (c.z - q.z) / d;
    depth = c.r + q.dist;
  } else {
    const d = q.dist || 1e-6;
    nx = (q.x - c.x) / d;
    nz = (q.z - c.z) / d;
    depth = c.r - q.dist;
  }
  hitOut.nx = nx;
  hitOut.nz = nz;
  hitOut.depth = depth;
  hitOut.cx = q.x;
  hitOut.cz = q.z;
  return hitOut;
}
