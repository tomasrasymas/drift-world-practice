// Garage menu: pick a car and colour, a location and the gearbox.

import { CARS, carById } from '../cars/specs.js';
import { TRACKS, trackById } from '../tracks/index.js';

const KEY = 'dwp.setup';
const $ = (id) => document.getElementById(id);

function load() {
  const def = { car: 'supra', colors: {}, track: 'city', transmission: 'auto', assist: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return def;
  }
}

export class Menu {
  constructor({ onChange, onStart }) {
    this.state = load();
    this.onChange = onChange;
    this.onStart = onStart;
    this.el = $('menu');
    this.visible = true;

    $('car-list').innerHTML = CARS.map(
      (c) => `
      <button class="card car" data-id="${c.id}">
        <span class="brand-name">${c.brand}</span>
        <span class="name">${c.name}</span>
        <span class="tag">${c.tagline}</span>
        <span class="pips" title="${c.difficulty}">${[1, 2, 3].map((i) => `<i class="${i <= c.difficultyLevel ? 'on' : ''}"></i>`).join('')}</span>
      </button>`,
    ).join('');
    $('track-list').innerHTML = TRACKS.map(
      (t) => `
      <button class="card track" data-id="${t.id}">
        <span class="thumb" style="background:${t.swatch}"></span>
        <span class="name">${t.name}</span>
        <span class="tag">${t.tag}</span>
        <span class="desc">${t.desc}</span>
      </button>`,
    ).join('');

    $('car-list').addEventListener('click', (e) => {
      const b = e.target.closest('.card');
      if (b) this.set({ car: b.dataset.id });
    });
    $('track-list').addEventListener('click', (e) => {
      const b = e.target.closest('.card');
      if (b) this.set({ track: b.dataset.id });
    });
    $('trans-seg').addEventListener('click', (e) => {
      if (e.target.dataset.v) this.set({ transmission: e.target.dataset.v });
    });
    $('assist-seg').addEventListener('click', (e) => {
      if (e.target.dataset.v) this.set({ assist: e.target.dataset.v === '1' });
    });
    $('car-detail').addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      this.state.colors[this.state.car] = Number(sw.dataset.i);
      this.set({});
    });
    $('start-btn').addEventListener('click', () => this.start());
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'Enter') {
        e.preventDefault();
        this.start();
      }
    });
    this.render();
  }

  get selection() {
    const spec = carById(this.state.car);
    const colorIndex = Math.min(spec.colors.length - 1, this.state.colors[spec.id] ?? 0);
    return {
      spec,
      color: spec.colors[colorIndex].hex,
      colorIndex,
      trackDef: trackById(this.state.track),
      transmission: this.state.transmission,
      assist: this.state.assist,
    };
  }

  set(patch) {
    Object.assign(this.state, patch);
    localStorage.setItem(KEY, JSON.stringify(this.state));
    this.render();
  }

  start() {
    if (!this.visible) return;
    this.onStart(this.selection);
  }

  render() {
    const sel = this.selection;
    const s = sel.spec;
    for (const b of document.querySelectorAll('#car-list .card')) b.classList.toggle('sel', b.dataset.id === s.id);
    for (const b of document.querySelectorAll('#track-list .card')) b.classList.toggle('sel', b.dataset.id === sel.trackDef.id);
    for (const b of document.querySelectorAll('#trans-seg button')) b.classList.toggle('sel', b.dataset.v === sel.transmission);
    for (const b of document.querySelectorAll('#assist-seg button')) b.classList.toggle('sel', (b.dataset.v === '1') === sel.assist);

    const torque = Math.max(...s.engine.curve.map((p) => p[1]));
    const bar = (label, value, frac) => `
      <div class="stat"><span>${label}</span><b>${value}</b><em><i style="width:${Math.round(Math.min(1, frac) * 100)}%"></i></em></div>`;
    $('car-detail').innerHTML = `
      <div class="detail-head"><span>${s.layout}</span><span class="diff d${s.difficultyLevel}">${s.difficulty}</span></div>
      <p class="blurb">${s.blurb}</p>
      ${bar('Power', `${s.powerHp} hp`, s.powerHp / 750)}
      ${bar('Torque', `${torque} Nm`, torque / 800)}
      ${bar('Weight', `${s.mass - 75} kg`, (s.mass - 75) / 1700)}
      ${bar('Rear weight', `${Math.round((1 - s.frontWeight) * 100)}%`, 1 - s.frontWeight)}
      ${bar('Redline', `${s.engine.redline} rpm`, s.engine.redline / 9500)}
      <div class="swatches">
        ${s.colors.map((c, i) => `<button class="swatch ${i === sel.colorIndex ? 'sel' : ''}" data-i="${i}" title="${c.name}" style="background:#${c.hex.toString(16).padStart(6, '0')}"></button>`).join('')}
        <span class="color-name">${s.colors[sel.colorIndex].name}</span>
      </div>`;

    $('setup-hint').textContent =
      sel.transmission === 'manual'
        ? 'Sequential shift with E (up) and W (down). The clutch is automatic and opens while the handbrake is pulled.'
        : 'The gearbox holds a gear while the car is sliding. Hold ↓ at a standstill to select reverse.';
    this.onChange(sel);
  }

  show() {
    this.visible = true;
    this.el.classList.remove('hidden');
  }

  hide() {
    this.visible = false;
    this.el.classList.add('hidden');
  }
}
