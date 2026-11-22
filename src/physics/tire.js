// Combined-slip tyre model.
//
// A normalised Magic Formula gives the force magnitude from the combined slip
// rho, where rho = 1 is the peak of the curve. Past the peak the force falls
// off gradually toward the sliding friction level, which is what makes a slide
// catchable rather than a cliff.
//
// Slips are defined on a shared denominator so the slip vector is proportional
// to the contact patch sliding velocity: a spinning wheel loses lateral grip
// (power oversteer) and a locked wheel just drags along its velocity vector.

export function createTire(p) {
  const C = p.C ?? 1.4;
  const E = p.E ?? 0;
  // Find B so the curve peaks exactly at rho = 1.
  const target = Math.tan(Math.PI / (2 * C));
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const f = mid - E * (mid - Math.atan(mid)) - target;
    if (f > 0) hi = mid;
    else lo = mid;
  }
  return {
    B: (lo + hi) / 2,
    C,
    E,
    mu: p.mu,
    muX: p.muX ?? 1.0,
    kPeak: p.kPeak ?? 0.11,
    aPeak: Math.tan(((p.peakSlipAngleDeg ?? 8) * Math.PI) / 180),
    loadSens: p.loadSens ?? 0.12,
    Fz0: p.Fz0 ?? 4000,
  };
}

// sx: longitudinal slip, sy: lateral slip (both already signed so that the
// force acts along +sx / +sy in the wheel frame). Writes out.fx / out.fy.
export function tireForce(t, Fz, sx, sy, muSurface, out) {
  if (Fz <= 0) {
    out.fx = 0;
    out.fy = 0;
    return out;
  }
  const nx = sx / t.kPeak;
  const ny = sy / t.aPeak;
  const rho = Math.sqrt(nx * nx + ny * ny);
  if (rho < 1e-7) {
    out.fx = 0;
    out.fy = 0;
    return out;
  }
  let sens = 1 - t.loadSens * (Fz / t.Fz0 - 1);
  if (sens < 0.72) sens = 0.72;
  else if (sens > 1.12) sens = 1.12;
  const mu = t.mu * muSurface * sens;

  const x = t.B * rho;
  const F = mu * Fz * Math.sin(t.C * Math.atan(x - t.E * (x - Math.atan(x))));

  // Direction: stiffness-weighted while gripping, pure sliding direction once
  // the whole contact patch is sliding.
  let dx = nx / rho;
  let dy = ny / rho;
  if (rho > 1) {
    const sl = Math.sqrt(sx * sx + sy * sy);
    let w = (rho - 1) / 3;
    if (w > 1) w = 1;
    w = w * w * (3 - 2 * w);
    dx += (sx / sl - dx) * w;
    dy += (sy / sl - dy) * w;
    const n = Math.sqrt(dx * dx + dy * dy);
    dx /= n;
    dy /= n;
  }
  out.fx = F * dx * t.muX;
  out.fy = F * dy;
  return out;
}
