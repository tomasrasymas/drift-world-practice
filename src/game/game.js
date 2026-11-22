// One driving session: a car on a track. Owns the scene and steps the
// simulation at a fixed 1 kHz regardless of frame rate.

import * as THREE from 'three';
import { Vehicle } from '../physics/vehicle.js';
import { buildCar } from '../cars/models.js';
import { SkidMarks, Smoke } from './effects.js';
import { ChaseCamera } from './camera.js';
import { Scoring } from './scoring.js';
import { Hud } from './hud.js';
import { glowTexture } from '../tracks/common.js';

const STEP = 1 / 1000;
const COLLIDE_EVERY = 4;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const surf = { y: 0, mu: 1, rr: 0.013, sx: 0, sz: 0, kind: 0 };

export class Game {
  constructor(app, { spec, color, trackDef, transmission, assist }) {
    this.app = app;
    this.spec = spec;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.2, 4000);

    const track = (this.track = trackDef.create({ renderer: app.renderer }));
    this.scene.add(track.group);
    this.scene.environment = track.env;
    this.scene.fog = track.fog;
    this.scene.background = track.fog.color;

    // sun shadows follow the car
    const sun = track.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const S = track.shadowSize / 2;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 520 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.06;

    // car
    this.car = new Vehicle(spec, { transmission, steerAssist: assist ? 1 : 0 });
    this.model = buildCar(spec, color);
    this.model.root.rotation.order = 'YXZ';
    this.scene.add(this.model.root);

    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.width + 1.0, this.car.L + spec.overhangFront + spec.overhangRear + 0.9),
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.03, (spec.overhangFront - spec.overhangRear) / 2 + this.model.shift);
    blob.renderOrder = 1;
    this.model.root.add(blob);

    if (track.night) {
      const nose = this.car.a + spec.overhangFront - 0.3;
      for (const s of [1, -1]) {
        const lamp = new THREE.SpotLight(0xfff0dc, 420, 110, 0.46, 0.8, 1.5);
        lamp.position.set(s * 0.6, 0.66, nose);
        lamp.target.position.set(s * 0.35, -0.3, nose + 40);
        this.model.root.add(lamp, lamp.target);
      }
      this.brakeGlow = new THREE.PointLight(0xff1a10, 0, 7, 1.8);
      this.brakeGlow.position.set(0, 0.5, -(this.car.b + spec.overhangRear + 1.1));
      this.model.root.add(this.brakeGlow);
      this.model.mats.head.emissiveIntensity = 2.4;
    }

    // effects
    this.skid = new SkidMarks();
    this.smoke = new Smoke(track.smokeColor);
    this.scene.add(this.skid.mesh, this.smoke.points);

    this.rig = new ChaseCamera(this.camera);
    this.scoring = new Scoring(`dwp.best.${track.id}.${spec.id}`);
    this.hud = new Hud(track, spec, transmission);

    this.acc = 0;
    this.stepCount = 0;
    this.time = 0;
    this.impactCooldown = 0;
    this.wheelY = [0, 0, 0, 0];
    this.wheelKind = [0, 0, 0, 0];
    this.groundY = 0;
    this.paused = false;

    this.place(track.spawn);
    app.audio.start(spec);
    this.syncVisuals(0);
    this.rig.update(0, this.car, this.groundY, this.model.root);
  }

  place(pose) {
    this.car.reset(pose.x, pose.z, pose.yaw);
    this.sampleGround();
    this.skid.breakAll();
    this.rig.reset(this.car, this.groundY);
    this.scoring.reset();
  }

  // Road height, grip and gradient under each wheel.
  sampleGround() {
    const car = this.car;
    const track = this.track;
    const sinY = Math.sin(car.yaw);
    const cosY = Math.cos(car.yaw);
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const x = car.x + w.px * sinY + w.py * cosY;
      const z = car.z + w.px * cosY - w.py * sinY;
      track.surfaceAt(x, z, i, surf);
      car.env.mu[i] = surf.mu;
      car.env.rr[i] = surf.rr;
      this.wheelY[i] = surf.y;
      this.wheelKind[i] = surf.kind;
      w.wx = x;
      w.wz = z;
      sum += surf.y;
    }
    track.surfaceAt(car.x, car.z, 4, surf);
    car.env.slopeX = surf.sx;
    car.env.slopeZ = surf.sz;
    this.groundY = sum / 4;
  }

  update(dt) {
    const { app, car, track } = this;
    const input = app.input;
    this.time += dt;
    input.update(dt);

    if (input.hit('KeyR')) this.place(track.resetPose(car.x, car.z));
    if (input.hit('KeyC')) this.rig.next();
    if (input.hit('KeyM')) app.audio.setMuted(!app.audio.muted);
    if (input.hit('KeyH')) document.getElementById('help').classList.toggle('hidden');
    const up = input.hit('KeyE');
    const down = input.hit('KeyW');
    if (car.transmission === 'manual') {
      if (up) car.shiftUp();
      if (down) car.shiftDown();
    }

    car.input.accel = input.accel;
    car.input.decel = input.decel;
    car.input.steer = input.steer;
    car.input.handbrake = input.handbrake;

    this.sampleGround();

    // fixed-step physics
    let impact = 0;
    this.acc += Math.min(dt, 0.05);
    while (this.acc >= STEP) {
      car.step(STEP);
      if (++this.stepCount % COLLIDE_EVERY === 0) {
        const hit = track.world.resolveVehicle(car);
        if (hit > impact) impact = hit;
      }
      this.acc -= STEP;
    }

    // events
    this.impactCooldown -= dt;
    if (impact > 1.2 && this.impactCooldown <= 0) {
      app.audio.impact(impact);
      this.rig.bump(impact / 14);
      this.impactCooldown = 0.18;
    }
    if (car.events.shift) {
      app.audio.shift();
      car.events.shift = 0;
    }
    if (car.events.blowoff) {
      app.audio.blowoff();
      car.events.blowoff = false;
    }
    car.events.limiter = false;

    this.scoring.update(dt, car, impact);
    const slip = this.syncVisuals(dt);
    app.audio.update(car, slip, this.wheelKind[2] === 1 || this.wheelKind[3] === 1);
    track.update(dt, this.time, this.camera, car);
    this.rig.update(dt, car, this.groundY, this.model.root);
    this.smoke.update(dt, this.camera, app.renderer.domElement.height);
    this.hud.update(dt, car, this.scoring, this.rig.modeName);
  }

  // Push simulation state into the scene graph. Returns the tyre slip level
  // used for sound.
  syncVisuals(dt) {
    const { car, model, track } = this;
    const y = this.wheelY;
    const root = model.root;
    const yF = (y[0] + y[1]) / 2;
    const yR = (y[2] + y[3]) / 2;
    const yL = (y[0] + y[2]) / 2;
    const yRt = (y[1] + y[3]) / 2;
    root.position.set(car.x, this.groundY, car.z);
    root.rotation.y = car.yaw;
    root.rotation.x = -Math.atan2(yF - yR, car.L);
    root.rotation.z = Math.atan2(yL - yRt, car.spec.trackFront);
    // keep the shadow frustum centred on the car
    const sun = track.sun;
    sun.target.position.set(car.x, this.groundY, car.z);
    sun.position.copy(sun.target.position).addScaledVector(track.sunDir, 240);
    model.body.rotation.z = car.roll * 1.2;
    model.body.rotation.x = -car.pitch * 1.2;
    model.setBrake(car.brake > 0.05 || car.handbrake > 0.5);
    if (this.brakeGlow) this.brakeGlow.intensity = car.brake > 0.05 || car.handbrake > 0.5 ? 5 : 0.7;

    const sinY = Math.sin(car.yaw);
    const cosY = Math.cos(car.yaw);
    let slipMax = 0;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const mw = model.wheels[i];
      mw.steer.rotation.y = w.steer;
      mw.spin.rotation.x = w.angle;

      let inten = 0;
      if (w.rho > 1.15) inten = clamp((w.slide - 2.5) / 9, 0, 1) * clamp(w.Fz / 3200, 0, 1.15);
      const kind = this.wheelKind[i];
      const gy = y[i];
      if (dt > 0) {
        const half = (w.front ? car.spec.tireWidthFront : car.spec.tireWidthRear) / 2;
        if (kind === 1) {
          this.skid.update(i, 0, 0, 0, 0, 0, 0, 0);
          const dust = clamp(Math.abs(w.vx) / 18 + w.slide / 10, 0, 1.2);
          if (dust > 0.1) this.smoke.emit(i, dust * 26, dt, w.wx, gy, w.wz, car.vx * 0.3, 0.3, car.vz * 0.3, 0.75);
        } else {
          this.skid.update(i, w.wx, gy, w.wz, cosY, -sinY, half, kind === 2 ? inten * 0.35 : inten);
          if (inten > 0.08) {
            const fling = clamp((w.omega * w.R - w.vx) * 0.22, -5, 5);
            this.smoke.emit(i, inten * (kind === 2 ? 22 : w.front ? 45 : 85) * clamp(0.3 + car.speed / 14, 0.3, 1), dt, w.wx, gy, w.wz, car.vx * 0.3 - sinY * fling, 0, car.vz * 0.3 - cosY * fling, kind === 2 ? 0.5 : 1);
          }
        }
      }
      if (inten > slipMax && kind !== 1) slipMax = inten;
    }
    return slipMax;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.hud.hide();
    this.app.audio.stop();
    this.scene.remove(this.model.root);
    this.model.dispose();
    this.skid.dispose();
    this.smoke.dispose();
    this.track.dispose();
  }
}
