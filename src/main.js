import '@fontsource/saira-condensed/400.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/700.css';
import '@fontsource/saira-condensed/800.css';
import './style.css';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { Input } from './game/input.js';
import { GameAudio } from './game/audio.js';
import { Game } from './game/game.js';
import { Showroom } from './ui/showroom.js';
import { Menu } from './ui/menu.js';

const $ = (id) => document.getElementById(id);
const MENU_LOOK = { exposure: 0.95, bloom: { strength: 0.4, radius: 0.6, threshold: 1.7 } };

class App {
  constructor() {
    const canvas = $('view');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.input = new Input();
    this.audio = new GameAudio();
    this.showroom = new Showroom(this.renderer);
    this.game = null;
    this.paused = false;
    this.lastOptions = null;

    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.showroom.scene, this.showroom.camera);
    this.bloom = new UnrealBloomPass(size, 0.5, 0.6, 0.85);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.look(MENU_LOOK);

    this.menu = new Menu({
      onChange: (sel) => this.showroom.setCar(sel.spec, sel.color),
      onStart: (sel) => this.startGame(sel),
    });

    $('resume-btn').addEventListener('click', () => this.setPaused(false));
    $('restart-btn').addEventListener('click', () => {
      this.setPaused(false);
      this.game.place(this.game.track.spawn);
    });
    $('garage-btn').addEventListener('click', () => this.toMenu());
    window.addEventListener('keydown', (e) => {
      if (!this.game) return;
      if (e.code === 'Escape' || e.code === 'KeyP') this.setPaused(!this.paused);
    });
    window.addEventListener('blur', () => {
      if (this.game && !this.paused) this.setPaused(true);
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());

    // deep link: ?car=gt3&track=mountain&gearbox=manual&go starts straight away
    const q = new URLSearchParams(location.search);
    const patch = {};
    if (q.get('car')) patch.car = q.get('car');
    if (q.get('track')) patch.track = q.get('track');
    if (q.get('gearbox')) patch.transmission = q.get('gearbox') === 'manual' ? 'manual' : 'auto';
    if (Object.keys(patch).length) this.menu.set(patch);
    if (q.has('go')) this.startGame(this.menu.selection);
  }

  look({ exposure, bloom }) {
    this.renderer.toneMappingExposure = exposure;
    this.bloom.strength = bloom.strength;
    this.bloom.radius = bloom.radius;
    this.bloom.threshold = bloom.threshold;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.showroom.resize(w, h);
    if (this.game) this.game.resize(w, h);
  }

  startGame(sel) {
    if (this.game || this.loading) return;
    this.loading = true;
    this.lastOptions = sel;
    $('loading-name').textContent = sel.trackDef.name;
    $('loading').classList.remove('hidden');
    this.menu.hide();
    // let the loading screen paint before the track is built
    setTimeout(() => {
      try {
        this.game = new Game(this, sel);
      } catch (err) {
        console.error(err);
        this.loading = false;
        $('loading').classList.add('hidden');
        this.menu.show();
        return;
      }
      this.renderPass.scene = this.game.scene;
      this.renderPass.camera = this.game.camera;
      this.look(this.game.track);
      this.game.resize(window.innerWidth, window.innerHeight);
      document.body.classList.toggle('manual', sel.transmission === 'manual');
      this.input.clear();
      this.input.enabled = true;
      this.loading = false;
      this.last = performance.now();
      $('loading').classList.add('hidden');
    }, 60);
  }

  toMenu() {
    if (!this.game) return;
    this.setPaused(false);
    this.input.enabled = false;
    this.input.clear();
    this.game.dispose();
    this.game = null;
    this.renderPass.scene = this.showroom.scene;
    this.renderPass.camera = this.showroom.camera;
    this.look(MENU_LOOK);
    this.menu.show();
  }

  setPaused(p) {
    if (!this.game) return;
    this.paused = p;
    $('pause').classList.toggle('hidden', !p);
    this.audio.suspend(p);
    this.input.clear();
    this.last = performance.now();
  }

  frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.game) {
      if (!this.paused) this.game.update(dt);
    } else {
      this.showroom.update(dt);
    }
    this.composer.render(dt);
  }
}

function boot() {
  const test = document.createElement('canvas');
  if (!test.getContext('webgl2')) {
    $('menu').classList.add('hidden');
    $('fatal').classList.remove('hidden');
    return;
  }
  window.__app = new App();
}

boot();
