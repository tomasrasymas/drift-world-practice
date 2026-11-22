// Dev-only viewer: /dev/cars.html?car=supra&view=front34
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CARS, carById } from '../src/cars/specs.js';
import { buildCar } from '../src/cars/models.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a8f96);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.8 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const ids = q.get('car') ? [q.get('car')] : CARS.map((c) => c.id);
ids.forEach((id, i) => {
  const spec = carById(id);
  const car = buildCar(spec, spec.colors[Number(q.get('color') ?? 0)].hex);
  car.root.position.x = (i - (ids.length - 1) / 2) * 2.6;
  scene.add(car.root);
});

const cam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 200);
const views = {
  front34: [4.6, 1.9, 6.2], rear34: [-4.6, 2.0, -6.2], side: [9, 1.1, 0], front: [0, 1.2, 9], rear: [0, 1.3, -9], top: [0.01, 12, 0], low: [3.5, 0.6, 5.5],
};
const v = views[q.get('view') ?? 'front34'];
const dist = ids.length > 1 ? 1.45 : 1;
cam.position.set(v[0] * dist, v[1] * dist, v[2] * dist);
cam.lookAt(0, 0.55, 0);
renderer.render(scene, cam);
window.__ready = true;
