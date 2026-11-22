// Headless sanity checks for the vehicle model against real-world figures.
import { Vehicle } from '../src/physics/vehicle.js';
import { CARS } from '../src/cars/specs.js';

const DT = 1 / 1000;
const f = (x, n = 2) => x.toFixed(n);

function run(car, seconds, drive, each) {
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    drive(car, t);
    car.step(DT);
    if (each && each(car, t) === false) return t;
  }
  return seconds;
}

for (const spec of CARS) {
  console.log(`\n=== ${spec.brand} ${spec.name} ===`);

  // 0-100, 0-200, quarter mile
  {
    const car = new Vehicle(spec);
    let t100 = 0, t200 = 0, tq = 0, vq = 0;
    run(car, 30, (c) => { c.input.accel = 1; }, (c, t) => {
      if (!t100 && c.speedKmh >= 100) t100 = t;
      if (!t200 && c.speedKmh >= 200) t200 = t;
      if (!tq && c.z >= 402.3) { tq = t; vq = c.speedKmh; }
    });
    console.log(`0-100 ${f(t100)}s  0-200 ${f(t200)}s  1/4mi ${f(tq)}s @ ${f(vq, 0)} km/h  v(30s) ${f(car.speedKmh, 0)} km/h gear ${car.gearLabel()}`);
  }

  // top speed
  {
    const car = new Vehicle(spec);
    car.vz = 70; for (const w of car.wheels) w.omega = 70 / w.R; car.gear = spec.gears.length - 1;
    run(car, 90, (c) => { c.input.accel = 1; });
    console.log(`top speed ~${f(car.speedKmh, 0)} km/h in gear ${car.gearLabel()} @ ${f(car.rpm, 0)} rpm`);
  }

  // braking 100-0
  {
    const car = new Vehicle(spec);
    car.vz = 100 / 3.6; for (const w of car.wheels) w.omega = car.vz / w.R; car.gear = 3;
    const z0 = car.z;
    const t = run(car, 10, (c) => { c.input.decel = 1; c.input.accel = 0; if (c.gear < 0) c.input.decel = 0; }, (c) => c.speed > 0.3 && c.gear > 0);
    console.log(`100-0 braking ${f(car.z - z0, 1)} m in ${f(t)}s`);
  }

  // steady-state skidpad: 40 m radius, slowly increase speed with a steering controller
  {
    const car = new Vehicle(spec, { steerAssist: 0 });
    car.vz = 10; for (const w of car.wheels) w.omega = 10 / w.R; car.gear = 2;
    let maxLat = 0;
    let target = 10;
    run(car, 40, (c, t) => {
      target = 10 + t * 0.5;
      c.input.accel = c.speed < target ? 0.6 : 0;
      // hold radius 40 around (40,0): turning left means centre on the left = +x at yaw 0
      const dx = c.x - 40, dz = c.z;
      const dist = Math.hypot(dx, dz);
      c.input.steer = Math.max(-1, Math.min(1, (dist - 40) * 0.25 + 0.12 + c.speed * 0.004));
    }, (c) => { if (Math.abs(c.driftAngle) < 0.12) maxLat = Math.max(maxLat, Math.abs(c.ay) / 9.81); });
    console.log(`skidpad max lateral ${f(maxLat)} g`);
  }

  // drift with a skilled (analog) driver, then with keyboard-style on/off keys
  for (const mode of ['analog', 'keys', 'naive']) {
    for (const [gear, kmh] of [[2, 70], [3, 110]]) {
      const car = new Vehicle(spec, { transmission: 'manual' });
      const v0 = kmh / 3.6;
      car.vz = v0; for (const w of car.wheels) w.omega = v0 / w.R; car.gear = gear;
      const log = [];
      let inDrift = 0, total = 0, steerK = 0, thrK = 0, prevBeta = 0, maxBeta = 0;
      run(car, 14, (c, t) => {
        const beta = -c.driftAngle * 57.3;
        const rate = (beta - prevBeta) / DT; prevBeta = beta;
        c.input.handbrake = 0;
        let st, th;
        if (t < 0.4) { st = 0; th = 1; }
        else if (t < 0.9) { st = 1; th = 1; c.input.handbrake = t > 0.45 && t < 0.75 ? 1 : 0; }
        else if (mode === 'analog') {
          st = Math.max(-1, Math.min(1, 0.35 + (35 - beta) * 0.05 - rate * 0.012));
          th = Math.max(0, Math.min(1, 0.75 + (35 - beta) * 0.03));
        } else if (mode === 'keys') {
          st = beta < 25 ? 1 : beta > 45 ? -1 : 0;
          th = beta > 50 ? 0 : beta > 38 ? (Math.floor(t * 8) % 2 ? 1 : 0) : 1;
        } else {
          // naive: just hold throttle and steer into the corner
          st = 1; th = 1;
        }
        // keyboard smoothing as the game applies it
        if (mode !== 'analog') {
          steerK += Math.max(-DT * 6, Math.min(DT * 6, st - steerK));
          thrK += Math.max(-DT * 8, Math.min(DT * 5, th - thrK));
          st = steerK; th = thrK;
        }
        c.input.steer = st; c.input.accel = th;
      }, (c, t) => {
        if (t > 1.5) { total++; if (Math.abs(c.driftAngle) > 0.26 && c.speedKmh > 30) inDrift++; maxBeta = Math.max(maxBeta, Math.abs(c.driftAngle * 57.3)); }
        if (Math.round(t * 1000) % 1000 === 0 && t > 0.5) log.push(`${f(t, 0)}s β=${f(-c.driftAngle * 57.3, 0)}° v=${f(c.speedKmh, 0)} rpm=${f(c.rpm, 0)} thr=${f(c.throttle, 1)} st=${f(c.steer * 57.3, 0)}° wheel/ground=${f((c.wheels[2].omega * c.wheels[2].R) / Math.max(1, c.speed), 2)}`);
      });
      console.log(`drift ${mode} g${gear} @${kmh}: sliding ${f(100 * inDrift / total, 0)}%  max β ${f(maxBeta, 0)}°\n  ` + log.join('\n  '));
    }
  }

  // let go mid-slide: the car should gather itself up, not spin
  {
    const car = new Vehicle(spec, { transmission: 'manual' });
    const v0 = 80 / 3.6;
    car.vz = v0; for (const w of car.wheels) w.omega = v0 / w.R; car.gear = 2;
    let maxB = 0, endB = 0;
    run(car, 6, (c, t) => {
      c.input.accel = t < 1.4 ? 1 : 0; c.input.steer = t > 0.4 && t < 0.95 ? 1 : 0;
      c.input.handbrake = t > 0.5 && t < 0.85 ? 1 : 0;
    }, (c) => { maxB = Math.max(maxB, Math.abs(c.driftAngle * 57.3)); endB = c.driftAngle * 57.3; });
    console.log(`hands-off recovery: peak β ${f(maxB, 0)}°, after 6s β ${f(endB, 0)}° v=${f(car.speedKmh, 0)}`);
  }
}
