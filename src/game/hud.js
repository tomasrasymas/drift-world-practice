// Heads-up display: tachometer, drift readout, score, minimap.

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class Hud {
  constructor(track, spec, transmission) {
    this.el = $('hud');
    this.tach = $('tach');
    this.tctx = this.tach.getContext('2d');
    this.map = $('minimap');
    this.mctx = this.map.getContext('2d');
    this.spec = spec;
    this.track = track;
    this.toastTimer = 0;
    this.shown = { total: -1, best: -1, points: -1, mult: -1, angle: -1, cam: '', trans: '' };
    $('trans-label').textContent = transmission === 'manual' ? 'MANUAL' : 'AUTO';
    $('car-label').textContent = `${spec.brand} ${spec.name}`;

    // static minimap layer
    const b = track.minimap.bounds;
    const size = this.map.width;
    const pad = 8;
    const s = (size - pad * 2) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const ox = (size - (b.maxX - b.minX) * s) / 2;
    const oy = (size - (b.maxZ - b.minZ) * s) / 2;
    this.mapXform = { s, tx: b.maxX * s + ox, ty: b.maxZ * s + oy };
    this.mapLayer = document.createElement('canvas');
    this.mapLayer.width = this.mapLayer.height = size;
    const lc = this.mapLayer.getContext('2d');
    // true top-down view: +z up the screen, +x to the left
    lc.setTransform(-s, 0, 0, -s, this.mapXform.tx, this.mapXform.ty);
    track.minimap.draw(lc);
    this.el.classList.remove('hidden');
  }

  toast(text, kind) {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast show ${kind}`;
    this.toastTimer = 1.6;
  }

  update(dt, car, scoring, camName) {
    const sh = this.shown;
    if (scoring.message) {
      this.toast(scoring.message.text, scoring.message.kind);
      scoring.message = null;
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').className = 'toast';
    }
    if (sh.total !== scoring.total) $('score-total').textContent = fmt((sh.total = scoring.total));
    if (sh.best !== scoring.best) $('score-best').textContent = fmt((sh.best = scoring.best));
    const panel = $('drift-panel');
    const active = scoring.active;
    panel.classList.toggle('active', active);
    if (active) {
      const pts = Math.round(scoring.current);
      if (sh.points !== pts) $('drift-points').textContent = fmt((sh.points = pts));
      const mult = scoring.multiplier;
      if (sh.mult !== mult) $('drift-mult').textContent = `×${(sh.mult = mult).toFixed(1)}`;
      const ang = Math.round(scoring.angle);
      if (sh.angle !== ang) $('drift-angle').textContent = `${(sh.angle = ang)}°`;
    }
    if (sh.cam !== camName) $('cam-label').textContent = sh.cam = camName;
    $('hb-label').classList.toggle('on', car.handbrake > 0.5);
    this._tach(car);
    this._map(car);
  }

  _tach(car) {
    const c = this.tctx;
    const W = this.tach.width;
    const cx = W / 2;
    const cy = W / 2;
    const R = W * 0.43;
    const e = this.spec.engine;
    const maxK = Math.ceil(e.redline / 1000) + 1;
    const a0 = Math.PI * 0.78;
    const sweep = Math.PI * 1.44;
    const ang = (rpm) => a0 + (Math.min(rpm, maxK * 1000) / (maxK * 1000)) * sweep;
    c.clearRect(0, 0, W, W);

    c.lineCap = 'butt';
    c.lineWidth = W * 0.035;
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.beginPath();
    c.arc(cx, cy, R, a0, a0 + sweep);
    c.stroke();
    c.strokeStyle = 'rgba(255,45,70,0.85)';
    c.beginPath();
    c.arc(cx, cy, R, ang(e.redline), a0 + sweep);
    c.stroke();
    // live arc
    const rpm = car.rpm;
    const hot = rpm > e.redline * 0.93;
    c.strokeStyle = hot ? '#ff2d46' : '#2de2ff';
    c.shadowColor = c.strokeStyle;
    c.shadowBlur = 14;
    c.beginPath();
    c.arc(cx, cy, R, a0, ang(rpm));
    c.stroke();
    c.shadowBlur = 0;

    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = `600 ${W * 0.062}px "Saira Condensed", "Arial Narrow", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let k = 0; k <= maxK; k++) {
      const a = ang(k * 1000);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      c.strokeStyle = k * 1000 >= e.redline ? '#ff2d46' : 'rgba(255,255,255,0.8)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx + ca * (R - W * 0.03), cy + sa * (R - W * 0.03));
      c.lineTo(cx + ca * (R - W * 0.075), cy + sa * (R - W * 0.075));
      c.stroke();
      c.fillText(String(k), cx + ca * (R - W * 0.125), cy + sa * (R - W * 0.125));
    }
    // needle
    const a = ang(rpm);
    c.strokeStyle = '#fff';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * W * 0.2, cy + Math.sin(a) * W * 0.2);
    c.lineTo(cx + Math.cos(a) * (R + W * 0.01), cy + Math.sin(a) * (R + W * 0.01));
    c.stroke();

    // gear and speed
    c.fillStyle = hot ? '#ff2d46' : '#fff';
    c.font = `800 italic ${W * 0.27}px "Saira Condensed", "Arial Narrow", sans-serif`;
    c.fillText(car.gearLabel(), cx, cy - W * 0.04);
    c.fillStyle = '#fff';
    c.font = `700 ${W * 0.13}px "Saira Condensed", "Arial Narrow", sans-serif`;
    c.fillText(String(Math.round(car.speedKmh)), cx, cy + W * 0.19);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = `600 ${W * 0.05}px "Saira Condensed", "Arial Narrow", sans-serif`;
    c.fillText('KM/H', cx, cy + W * 0.285);
    c.fillText('×1000 RPM', cx, cy - W * 0.22);

    // throttle / brake bars
    const bar = (x, v, col) => {
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(x, cy + W * 0.36, W * 0.2, W * 0.022);
      c.fillStyle = col;
      c.fillRect(x, cy + W * 0.36, W * 0.2 * v, W * 0.022);
    };
    bar(cx - W * 0.22, car.brake, '#ff2d46');
    bar(cx + W * 0.02, car.throttle, '#7dff6a');
  }

  _map(car) {
    const c = this.mctx;
    const size = this.map.width;
    c.clearRect(0, 0, size, size);
    c.drawImage(this.mapLayer, 0, 0);
    const { s, tx, ty } = this.mapXform;
    const x = -car.x * s + tx;
    const y = -car.z * s + ty;
    const fx = -Math.sin(car.yaw);
    const fy = -Math.cos(car.yaw);
    c.fillStyle = '#ff3df2';
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x + fx * 9, y + fy * 9);
    c.lineTo(x - fx * 6 - fy * 6, y - fy * 6 + fx * 6);
    c.lineTo(x - fx * 6 + fy * 6, y - fy * 6 - fx * 6);
    c.closePath();
    c.fill();
    c.stroke();
  }

  hide() {
    this.el.classList.add('hidden');
  }
}
