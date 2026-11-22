// Planar rigid-body vehicle model with four individually rotating wheels.
//
// Frames: the world plane is Three.js (x, z). Heading `yaw` is a rotation about
// +y, so forward = (sin yaw, cos yaw) and left = (cos yaw, -sin yaw). Body-frame
// quantities follow ISO convention: x forward, y left, yaw positive to the left.
//
// What is modelled:
//  - combined-slip tyres with load sensitivity and lateral relaxation
//  - dynamic load transfer through roll and pitch states of the sprung mass
//  - engine torque curve, turbo lag, rev limiter, engine braking
//  - clutch, gearbox, clutch-type limited slip differential, brakes with ABS
//    solved together as Coulomb friction constraints (sequential impulses), so
//    a locked clutch or a locked wheel is exact instead of a stiff spring
//  - aerodynamic drag and downforce, rolling resistance, road gradient

import { createTire, tireForce } from './tire.js';

const GRAV = 9.81;
const AIR = 1.225;
const V_LOW = 1.0; // slip denominator floor, m/s
const RELAX_LEN = 0.28; // lateral relaxation length, m
const RPM = 30 / Math.PI;
const STEER_LEAD = 0.14; // s of slip-angle lead in the countersteer assist

const FL = 0;
const FR = 1;
const RL = 2;
const RR = 3;

const t0 = { fx: 0, fy: 0 };
const t1 = { fx: 0, fy: 0 };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

function lookup(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  const n = curve.length;
  if (x >= curve[n - 1][0]) return curve[n - 1][1];
  for (let i = 1; i < n; i++) {
    if (x <= curve[i][0]) {
      const a = curve[i - 1];
      const b = curve[i];
      return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }
  }
  return curve[n - 1][1];
}

export class Vehicle {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.transmission = opts.transmission ?? 'auto';
    this.steerAssist = opts.steerAssist ?? 1;
    this.absEnabled = opts.abs ?? true;

    const s = spec;
    this.mass = s.mass;
    this.L = s.wheelbase;
    this.a = s.wheelbase * (1 - s.frontWeight); // CG to front axle
    this.b = s.wheelbase - this.a; // CG to rear axle
    this.Iz = s.mass * this.a * this.b * (s.yawInertiaK ?? 1);
    this.h = s.cgHeight;

    // Roll and pitch: stiffness from the steady-state gradient (deg per g),
    // inertia from the natural frequency, damping from the damping ratio.
    const rad = Math.PI / 180;
    this.Kr = (s.mass * GRAV * s.cgHeight) / (s.rollGradientDeg * rad);
    this.Ir = this.Kr / (2 * Math.PI * s.rollFreq) ** 2;
    this.Cr = 2 * s.rollDamping * Math.sqrt(this.Kr * this.Ir);
    this.Kp = (s.mass * GRAV * s.cgHeight) / (s.pitchGradientDeg * rad);
    this.Ip = this.Kp / (2 * Math.PI * s.pitchFreq) ** 2;
    this.Cp = 2 * s.pitchDamping * Math.sqrt(this.Kp * this.Ip);

    this.tireF = createTire({ ...s.tireFront, Fz0: (s.mass * GRAV * s.frontWeight) / 2 });
    this.tireR = createTire({ ...s.tireRear, Fz0: (s.mass * GRAV * (1 - s.frontWeight)) / 2 });

    this.wheels = [0, 1, 2, 3].map((i) => {
      const front = i < 2;
      const left = i % 2 === 0;
      return {
        front,
        left,
        px: front ? this.a : -this.b,
        py: ((front ? s.trackFront : s.trackRear) / 2) * (left ? 1 : -1),
        R: front ? s.wheelRadiusFront : s.wheelRadiusRear,
        I: front ? s.wheelInertiaFront : s.wheelInertiaRear,
        tire: front ? this.tireF : this.tireR,
        omega: 0,
        angle: 0, // accumulated spin, for rendering
        steer: 0,
        sy: 0, // relaxed lateral slip
        sx: 0,
        Fz: 0,
        fx: 0,
        fy: 0,
        k: 0,
        abs: 1,
        slide: 0, // contact patch sliding speed, m/s
        rho: 0, // combined slip relative to peak
        vx: 0,
      };
    });

    this.env = { mu: [1, 1, 1, 1], rr: [0.013, 0.013, 0.013, 0.013], slopeX: 0, slopeZ: 0 };
    this.input = { accel: 0, decel: 0, steer: 0, handbrake: 0 };
    this.events = { shift: 0, blowoff: false, limiter: false };

    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.roll = 0;
    this.rollRate = 0;
    this.pitch = 0;
    this.pitchRate = 0;
    this.ax = 0;
    this.ay = 0;
    this.u = 0;
    this.v = 0;
    this.speed = 0;
    this.steer = 0;
    this._betaPrev = 0;
    this._betaRate = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.engineOmega = this.spec.engine.idle / RPM;
    this.boost = 0;
    this.gear = 1;
    this.clutch = 0;
    this.clutchLocked = false;
    this.shiftTimer = 0;
    this.sinceShift = 1;
    this.shiftDir = 0;
    this.limiterTimer = 0;
    this.dirTimer = 0;
    this.driveTorque = 0;
    this.engineTorqueNow = 0;
    for (const w of this.wheels) {
      w.omega = 0;
      w.sy = 0;
      w.sx = 0;
      w.fx = 0;
      w.fy = 0;
      w.abs = 1;
      w.slide = 0;
      w.rho = 0;
      w.steer = 0;
    }
  }

  get rpm() {
    return this.engineOmega * RPM;
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  // Angle between where the car points and where it travels (rad, signed).
  get driftAngle() {
    if (this.speed < 2) return 0;
    return Math.atan2(this.v, Math.abs(this.u));
  }

  gearRatio(g = this.gear) {
    const s = this.spec;
    if (g > 0) return s.gears[g - 1] * s.finalDrive;
    if (g < 0) return -s.reverse * s.finalDrive;
    return 0;
  }

  gearLabel() {
    return this.gear > 0 ? String(this.gear) : this.gear < 0 ? 'R' : 'N';
  }

  shiftUp() {
    this._requestShift(this.gear + 1);
  }

  shiftDown() {
    this._requestShift(this.gear - 1);
  }

  _requestShift(target) {
    const s = this.spec;
    if (this.shiftTimer > 0) return false;
    if (target > s.gears.length || target < -1 || target === this.gear) return false;
    const rearSpeed = ((this.wheels[RL].omega + this.wheels[RR].omega) / 2) * s.wheelRadiusRear;
    if (target === -1 && rearSpeed > 2.5) return false;
    if (target > 0 && target < this.gear) {
      // refuse a downshift that would over-rev the engine
      const rpmAfter =
        Math.abs((this.wheels[RL].omega + this.wheels[RR].omega) / 2) * this.gearRatio(target) * RPM;
      if (rpmAfter > s.engine.redline * 1.06) return false;
    }
    this.shiftDir = target > this.gear ? 1 : -1;
    this.gear = target;
    this.shiftTimer = target === 0 ? 0.05 : s.shiftTime;
    this.sinceShift = 0;
    this.events.shift = this.shiftDir;
    return true;
  }

  // ---- driver aids and powertrain control -------------------------------

  _control(dt, u, speed) {
    const s = this.spec;
    const e = s.engine;
    const inp = this.input;
    let throttle = inp.accel;
    let brake = inp.decel;

    const wd = (this.wheels[RL].omega + this.wheels[RR].omega) / 2;

    if (this.transmission === 'auto') {
      const stopped = speed < 0.7 && Math.abs(wd * s.wheelRadiusRear) < 1.2;
      if (this.gear >= 0) {
        if (this.gear === 0 && inp.accel > 0.1) this._requestShift(1);
        if (stopped && inp.decel > 0.5 && inp.accel < 0.1) {
          this.dirTimer += dt;
          if (this.dirTimer > 0.18) {
            this.shiftTimer = 0;
            this._requestShift(-1);
            this.dirTimer = 0;
          }
        } else this.dirTimer = 0;
      } else {
        throttle = inp.decel;
        brake = inp.accel;
        if (stopped && inp.accel > 0.5 && inp.decel < 0.1) {
          this.dirTimer += dt;
          if (this.dirTimer > 0.18) {
            this.shiftTimer = 0;
            this._requestShift(1);
            this.dirTimer = 0;
          }
        } else this.dirTimer = 0;
      }

      if (this.gear >= 1 && this.shiftTimer <= 0 && this.sinceShift > 0.45) {
        const ratio = this.gearRatio();
        const groundRpm = (Math.abs(u) / s.wheelRadiusRear) * ratio * RPM;
        const rpm = this.rpm;
        const upAt = e.redline * lerp(0.5, 0.965, throttle);
        // Hold the gear while the car is sideways; straight-line wheelspin
        // still shifts up at the red line like any automatic.
        const sliding = Math.abs(this.driftAngle) > 0.2 && speed > 6;
        if (this.gear < s.gears.length) {
          if (groundRpm > e.redline * 0.985) this._requestShift(this.gear + 1);
          else if (!sliding && rpm > upAt && groundRpm > upAt * 0.82) this._requestShift(this.gear + 1);
        }
        if (this.gear > 1 && this.shiftTimer <= 0) {
          const step = s.gears[this.gear - 2] / s.gears[this.gear - 1];
          const downAt = e.redline * lerp(0.26, 0.52, throttle);
          if (
            groundRpm < downAt &&
            groundRpm * step < upAt * 0.82 &&
            rpm * step < e.redline * 0.97
          ) {
            this._requestShift(this.gear - 1);
          }
        }
      }
    }

    // hill hold: keep the car parked on a gradient until the driver asks to move
    if (speed < 0.6 && inp.accel < 0.05 && inp.decel < 0.05 && this.gear !== 0) brake = Math.max(brake, 0.5);

    this.sinceShift += dt;

    // Shifting: cut on the way up, blip to match revs on the way down.
    let shifting = false;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      shifting = true;
      if (this.shiftDir > 0) throttle = 0;
      else if (this.gear > 0) {
        const target = Math.abs(wd) * this.gearRatio() * RPM;
        throttle = clamp((target - this.rpm) / 1200, 0, 1);
      }
    }

    // Rev limiter: hard fuel cut with a short hold, as on a real ECU.
    const rpm = this.rpm;
    if (rpm >= e.redline) {
      this.limiterTimer = 0.055;
      this.events.limiter = true;
    }
    if (this.limiterTimer > 0) {
      this.limiterTimer -= dt;
      throttle = 0;
    }

    // Automatic clutch: opens for the handbrake, for shifts and near idle,
    // and slips against engine speed for launches.
    let target;
    const inRpm = Math.abs(wd * this.gearRatio()) * RPM;
    if (this.gear === 0 || shifting || inp.handbrake > 0.5) {
      target = 0;
      this.clutchLocked = false;
    } else {
      if (inRpm < e.idle + 60) this.clutchLocked = false;
      else if (this.clutch > 0.3 && Math.abs(rpm - inRpm) < 150) this.clutchLocked = true;
      if (this.clutchLocked) target = 1;
      else if (throttle < 0.04 && inRpm < e.idle + 100) target = 0;
      else {
        // slipping launch: hold the engine near a launch speed that rises with throttle
        const hi = lerp(e.idle + 700, s.launchSlipRpm, throttle * throttle);
        const lo = Math.max(e.idle + 150, hi - 900);
        target = clamp((rpm - lo) / (hi - lo), 0, 1);
        target *= target;
      }
    }
    const rate = target > this.clutch ? 9 : 25;
    this.clutch += clamp(target - this.clutch, -rate * dt, rate * dt);

    // Turbo boost state.
    if (e.turbo) {
      const sp = smooth01((rpm - e.turbo.spoolLo) / (e.turbo.spoolHi - e.turbo.spoolLo));
      const bt = throttle * sp;
      const tau = bt > this.boost ? e.turbo.lag * (1.7 - 0.7 * sp) : 0.3;
      const before = this.boost;
      this.boost += (bt - this.boost) * Math.min(1, dt / tau);
      if (before > 0.55 && throttle < 0.1 && this.throttle >= 0.1) this.events.blowoff = true;
    }

    this.throttle = throttle;
    this.brake = brake;
    this.handbrake = inp.handbrake;
  }

  _engineTorque(rpm, thr) {
    const e = this.spec.engine;
    let full = lookup(e.curve, rpm);
    if (e.turbo) full *= e.turbo.naFraction + (1 - e.turbo.naFraction) * this.boost;
    const fric = e.frictionBase + (e.frictionPerKrpm * rpm) / 1000;
    let T = thr * (full + fric) - fric;
    const idleBlend = clamp((e.idle + 250 - rpm) / 250, 0, 1);
    T += idleBlend * (fric + Math.max(0, e.idle - rpm) * 0.8);
    return T;
  }

  _steer(dt, u, v, r, speed) {
    const s = this.spec;
    const lock = s.steerLock;
    // Direction the front axle is actually travelling, in the body frame.
    // Letting the wheels follow it is what a driver does when the wheel is
    // allowed to spin through the hands in a slide (caster self-steer).
    let travel = 0;
    if (u > 1.5) {
      const fade = smooth01((u - 1.5) / 4) * this.steerAssist;
      const beta = Math.atan2(v, u);
      // slip-angle rate, lightly filtered: the anticipation a driver adds on
      // top of simply following the slide
      const raw = clamp((beta - this._betaPrev) / dt, -6, 6);
      this._betaRate += (raw - this._betaRate) * Math.min(1, dt * 30);
      this._betaPrev = beta;
      travel = (Math.atan2(v + r * this.a, u) + this._betaRate * STEER_LEAD) * fade;
    } else {
      this._betaPrev = 0;
      this._betaRate = 0;
    }
    const range = lerp(lock, s.steerHighSpeed, smooth01((speed - 3) / 15));
    // With the assist on, steering further into a slide loses authority as
    // the angle builds, so a held key settles at a big angle instead of
    // spinning the car. Countersteer is never limited.
    let gain = 1;
    if (this.steerAssist > 0 && u > 3) {
      const beta = Math.atan2(v, u);
      if (this.input.steer * beta < 0) gain = 1 - this.steerAssist * smooth01((Math.abs(beta) - 0.4) / 0.45);
    }
    const target = clamp(travel + this.input.steer * range * gain, -lock, lock);
    const rate = 3.4;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);

    // Partial Ackermann.
    const d = this.steer;
    const W = this.wheels;
    if (Math.abs(d) > 1e-4) {
      const R0 = this.L / Math.tan(d);
      const half = s.trackFront / 2;
      const dl = Math.atan(this.L / (R0 - half));
      const dr = Math.atan(this.L / (R0 + half));
      W[FL].steer = d + (dl - d) * 0.5;
      W[FR].steer = d + (dr - d) * 0.5;
    } else {
      W[FL].steer = d;
      W[FR].steer = d;
    }
  }

  // ---- one physics step ---------------------------------------------------

  step(dt) {
    const s = this.spec;
    const W = this.wheels;
    const env = this.env;
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const u = this.vx * sinY + this.vz * cosY;
    const v = this.vx * cosY - this.vz * sinY;
    const r = this.yawRate;
    const speed = Math.hypot(u, v);
    this.u = u;
    this.v = v;
    this.speed = speed;

    this._control(dt, u, speed);
    this._steer(dt, u, v, r, speed);

    // -- vertical loads
    const q = 0.5 * AIR * speed * speed;
    const down = q * s.clA;
    const Wf = ((this.mass * GRAV * this.b) / this.L + down * s.aeroBalance) * 0.5;
    const Wr = ((this.mass * GRAV * this.a) / this.L + down * (1 - s.aeroBalance)) * 0.5;
    const longT = ((this.Kp * this.pitch + this.Cp * this.pitchRate) / this.L) * 0.5;
    const latT = this.Kr * this.roll + this.Cr * this.rollRate;
    const latF = (latT * s.rollStiffFront) / s.trackFront;
    const latR = (latT * (1 - s.rollStiffFront)) / s.trackRear;
    W[FL].Fz = Math.max(0, Wf - longT - latF);
    W[FR].Fz = Math.max(0, Wf - longT + latF);
    W[RL].Fz = Math.max(0, Wr + longT - latR);
    W[RR].Fz = Math.max(0, Wr + longT + latR);

    // -- tyre forces at the current state, plus dFx/domega for the solver
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const vbx = u - r * w.py;
      const vby = v + r * w.px;
      const cs = Math.cos(w.steer);
      const sn = Math.sin(w.steer);
      const vwx = vbx * cs + vby * sn;
      const vwy = -vbx * sn + vby * cs;
      w.vx = vwx;
      const wr = w.omega * w.R;
      const D = Math.max(Math.abs(vwx), Math.abs(wr), V_LOW);
      const sx = (wr - vwx) / D;
      const syTarget = -vwy / D;
      // lateral relaxation: the carcass needs rolling distance to build force
      w.sy += (syTarget - w.sy) * Math.min(1, (dt * Math.max(Math.abs(vwx), 8)) / RELAX_LEN);
      w.sx = sx;
      const mu = env.mu[i];
      tireForce(w.tire, w.Fz, sx, w.sy, mu, t0);
      const dOmega = 0.5;
      tireForce(w.tire, w.Fz, sx + (dOmega * w.R) / D, w.sy, mu, t1);
      w.fx0 = t0.fx;
      w.fy = t0.fy;
      w.k = Math.max(0, (t1.fx - t0.fx) / dOmega);
      w.rho = Math.hypot(sx / w.tire.kPeak, w.sy / w.tire.aPeak);
      w.slide = Math.hypot(wr - vwx, vwy);

      // ABS on the service brake only
      if (this.absEnabled && this.brake > 0.05 && speed > 3 && sx < -0.14) w.abs = Math.max(0.15, w.abs - dt * 18);
      else w.abs = Math.min(1, w.abs + dt * 5);
    }

    this._solveDrivetrain(dt);

    // -- sum forces on the body
    let FX = 0;
    let FY = 0;
    let MZ = 0;
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const cs = Math.cos(w.steer);
      const sn = Math.sin(w.steer);
      const roll = -env.rr[i] * w.Fz * Math.tanh(w.vx * 2);
      const fxw = w.fx + roll;
      const fxb = fxw * cs - w.fy * sn;
      const fyb = fxw * sn + w.fy * cs;
      FX += fxb;
      FY += fyb;
      MZ += w.px * fyb - w.py * fxb;
    }
    if (speed > 0.01) {
      const drag = q * s.cdA;
      FX -= (drag * u) / speed;
      FY -= (drag * v) / speed;
    }

    const ax = FX / this.mass;
    const ay = FY / this.mass;
    this.ax = ax;
    this.ay = ay;

    // -- integrate (semi-implicit Euler)
    this.vx += (ax * sinY + ay * cosY - GRAV * env.slopeX) * dt;
    this.vz += (ax * cosY - ay * sinY - GRAV * env.slopeZ) * dt;
    this.yawRate += (MZ / this.Iz) * dt;

    // settle to a clean stop instead of creeping on numerical residue
    if (speed < 0.35 && this.throttle < 0.02 && Math.abs(env.slopeX) + Math.abs(env.slopeZ) < 0.01) {
      const d = Math.max(0, 1 - 6 * dt);
      this.vx *= d;
      this.vz *= d;
      this.yawRate *= d;
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.yaw += this.yawRate * dt;

    this.rollRate += ((this.mass * ay * this.h - this.Kr * this.roll - this.Cr * this.rollRate) / this.Ir) * dt;
    this.roll += this.rollRate * dt;
    this.pitchRate += ((this.mass * ax * this.h - this.Kp * this.pitch - this.Cp * this.pitchRate) / this.Ip) * dt;
    this.pitch += this.pitchRate * dt;

    for (let i = 0; i < 4; i++) W[i].angle += W[i].omega * dt;
  }

  // Engine, clutch, differential, brakes and tyre reaction solved together.
  // Each coupling is a friction constraint with a torque capacity; the tyre is
  // a soft constraint using its local stiffness. Gauss-Seidel over a handful
  // of unknowns converges in a few passes and is unconditionally stable.
  _solveDrivetrain(dt) {
    const s = this.spec;
    const W = this.wheels;
    const e = s.engine;
    const G = this.gearRatio();
    const eta = s.driveEfficiency;
    const Ie = e.inertia;

    const Te = this._engineTorque(this.rpm, this.throttle);
    this.engineTorqueNow = Te;
    let we = this.engineOmega + (dt * Te) / Ie;

    const clutchCap = s.clutchMax * this.clutch * dt;
    const om0 = [W[0].omega, W[1].omega, W[2].omega, W[3].omega];
    const om = om0.slice();
    const jt = [0, 0, 0, 0];
    const jb = [0, 0, 0, 0];
    const brakeCap = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      let cap = this.brake * (w.front ? s.brakeFront : s.brakeRear) * w.abs;
      if (!w.front) cap += this.handbrake * s.handbrake;
      brakeCap[i] = cap * dt;
    }
    let jc = 0;
    let jl = 0;
    const Iw = W[RL].I;

    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < 4; i++) {
        const w = W[i];
        // tyre reaction, linearised about the start-of-step wheel speed
        const c = (dt * w.R * w.k) / w.I;
        const jNew = (-dt * w.R * (w.fx0 + w.k * (om[i] - jt[i] / w.I - om0[i]))) / (1 + c);
        om[i] += (jNew - jt[i]) / w.I;
        jt[i] = jNew;
        // brake
        if (brakeCap[i] > 0) {
          const jbNew = clamp(jb[i] - om[i] * w.I, -brakeCap[i], brakeCap[i]);
          om[i] += (jbNew - jb[i]) / w.I;
          jb[i] = jbNew;
        }
      }
      if (G !== 0 && clutchCap > 0) {
        const slip = we - (G * (om[RL] + om[RR])) / 2;
        const denom = 1 / Ie + (G * G * eta) / (2 * Iw);
        const jcNew = clamp(jc + slip / denom, -clutchCap, clutchCap);
        const dj = jcNew - jc;
        we -= dj / Ie;
        const dw = (dj * G * eta) / 2 / Iw;
        om[RL] += dw;
        om[RR] += dw;
        jc = jcNew;
      }
      {
        const td = Math.abs(jc * G);
        const cap = s.diff.preload * dt + td * (jc >= 0 ? s.diff.lockAccel : s.diff.lockCoast);
        const jlNew = clamp(jl + ((om[RL] - om[RR]) * Iw) / 2, -cap, cap);
        const dj = jlNew - jl;
        om[RL] -= dj / Iw;
        om[RR] += dj / Iw;
        jl = jlNew;
      }
    }

    for (let i = 0; i < 4; i++) {
      W[i].omega = om[i];
      W[i].fx = -jt[i] / (dt * W[i].R);
    }
    this.driveTorque = (jc * G * eta) / dt;
    this.engineOmega = Math.max(we, (e.idle * 0.55) / RPM);
  }
}
