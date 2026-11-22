// Chase camera that leans toward the direction of travel, so a slide shows
// the side of the car instead of hiding behind the boot.

import * as THREE from 'three';

const MODES = [
  { name: 'Chase', dist: 6.6, height: 2.15, fov: 58 },
  { name: 'Far', dist: 10.5, height: 3.6, fov: 54 },
  { name: 'Bonnet' },
  { name: 'Overhead', height: 38 },
];

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

const v = new THREE.Vector3();
const look = new THREE.Vector3();

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.shake = 0;
    this.y = 0;
  }

  get modeName() {
    return MODES[this.mode].name;
  }

  next() {
    this.mode = (this.mode + 1) % MODES.length;
    this.snap = true;
  }

  reset(car, y) {
    this.yaw = car.yaw;
    this.y = y;
    this.snap = true;
  }

  bump(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt, car, groundY, root) {
    const cam = this.camera;
    const m = MODES[this.mode];
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.y += (groundY - this.y) * Math.min(1, dt * 8);

    let desired = car.yaw;
    if (car.speed > 3 && car.u > 0) {
      const velYaw = Math.atan2(car.vx, car.vz);
      const w = Math.min(1, (car.speed - 3) / 8) * 0.6;
      desired = car.yaw + wrap(velYaw - car.yaw) * w;
    }
    const k = this.snap ? 1 : 1 - Math.exp(-dt * 4.2);
    this.yaw += wrap(desired - this.yaw) * k;
    cam.up.set(0, 1, 0);

    if (m.name === 'Bonnet') {
      v.set(0, 1.08, 0.25);
      root.localToWorld(v);
      cam.position.copy(v);
      look.set(0, 0.95, 30);
      root.localToWorld(look);
      cam.lookAt(look);
      cam.fov = 72;
    } else if (m.name === 'Overhead') {
      cam.up.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      cam.position.set(car.x, this.y + m.height + car.speed * 0.25, car.z);
      look.set(car.x, this.y, car.z);
      cam.lookAt(look);
      cam.fov = 55;
    } else {
      const sx = Math.sin(this.yaw);
      const cz = Math.cos(this.yaw);
      v.set(car.x - sx * m.dist, this.y + m.height, car.z - cz * m.dist);
      if (this.snap) this.pos.copy(v);
      else this.pos.lerp(v, 1 - Math.exp(-dt * 12));
      cam.position.copy(this.pos);
      if (this.shake > 0) {
        cam.position.x += (Math.random() - 0.5) * this.shake * 0.25;
        cam.position.y += (Math.random() - 0.5) * this.shake * 0.25;
      }
      look.set(car.x + sx * 2.5, this.y + 0.95, car.z + cz * 2.5);
      cam.lookAt(look);
      cam.fov = m.fov + Math.min(1, car.speed / 65) * 17;
    }
    cam.updateProjectionMatrix();
    this.snap = false;
  }
}
