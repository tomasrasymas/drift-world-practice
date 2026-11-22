// Garage scene behind the menu: the selected car on a slow turntable.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar } from '../cars/models.js';
import { glowTexture } from '../tracks/common.js';

export class Showroom {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080d);
    this.scene.fog = new THREE.Fog(0x07080d, 14, 40);
    const pm = new THREE.PMREMGenerator(renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.28;

    this.camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 100);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.28, metalness: 0.55 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // turntable ring and neon tubes
    const neon = (color, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.035, 8, 96), neon(0xff3df2, 2.4));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    this.scene.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.02, 8, 96), neon(0x2de2ff, 2.0));
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.03;
    this.scene.add(ring2);
    for (let i = 0; i < 7; i++) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.07, 5.5, 0.07), neon(i % 2 ? 0x2de2ff : 0xff3df2, 2.6));
      const a = -1.25 + i * 0.42;
      tube.position.set(Math.sin(a) * 13, 2.75, -Math.cos(a) * 13);
      this.scene.add(tube);
    }
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 13),
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(120,90,255,0.28)', 'rgba(120,90,255,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    this.scene.add(glow);

    const key = new THREE.SpotLight(0xffffff, 165, 30, 0.6, 0.6, 1.6);
    key.position.set(4, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.04;
    this.scene.add(key, key.target);
    const rimA = new THREE.PointLight(0xff3df2, 22, 22, 1.6);
    rimA.position.set(-6, 2.2, -5);
    const rimB = new THREE.PointLight(0x2de2ff, 22, 22, 1.6);
    rimB.position.set(6, 2.2, -6);
    this.scene.add(rimA, rimB, new THREE.HemisphereLight(0x8090c0, 0x101014, 0.35));

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.model = null;
    this.angle = 0.6;
    this.t = 0;
  }

  setCar(spec, colorHex) {
    if (this.model && this.model.specId === spec.id) {
      this.model.setColor(colorHex);
      return;
    }
    if (this.model) {
      this.turntable.remove(this.model.root);
      this.model.dispose();
    }
    this.model = buildCar(spec, colorHex);
    this.model.specId = spec.id;
    this.model.root.position.z = -this.model.shift;
    this.model.mats.head.emissiveIntensity = 2.6;
    this.turntable.add(this.model.root);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // keep the car clear of the side panels on narrow windows
    this.camera.fov = w / h < 1.5 ? 44 : 34;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.t += dt;
    this.angle += dt * 0.22;
    this.turntable.rotation.y = this.angle;
    const bob = Math.sin(this.t * 0.4) * 0.25;
    this.camera.position.set(0.3, 1.8 + bob * 0.3, 11.6);
    this.camera.lookAt(0, 0.62, 0);
  }

  dispose() {
    if (this.model) this.model.dispose();
    this.env.dispose();
  }
}
