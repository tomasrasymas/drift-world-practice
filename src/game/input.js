// Keyboard (and optional gamepad) input, smoothed into analogue controls.

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.steer = 0;
    this.accel = 0;
    this.decel = 0;
    this.handbrake = 0;
    this.enabled = false;
    this._padPrev = {};
    this._down = (e) => {
      if (!this.enabled) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._up = (e) => this.keys.delete(e.code);
    this._blur = () => this.keys.clear();
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
  }

  // true once per key press
  hit(code) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.steer = this.accel = this.decel = this.handbrake = 0;
  }

  update(dt) {
    const k = this.keys;
    let steerT = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    let accelT = k.has('ArrowUp') ? 1 : 0;
    let decelT = k.has('ArrowDown') ? 1 : 0;
    let hb = k.has('Space') ? 1 : 0;
    let analog = false;

    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
    if (pad) {
      const ax = Math.abs(pad.axes[0]) > 0.08 ? pad.axes[0] : 0;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (ax !== 0 || rt > 0.03 || lt > 0.03 || pad.buttons[0]?.pressed) {
        analog = true;
        steerT = -Math.sign(ax) * Math.abs(ax) ** 1.6;
        accelT = rt;
        decelT = lt;
        hb = pad.buttons[0]?.pressed ? 1 : hb;
      }
      const edge = (i, code) => {
        const now = !!pad.buttons[i]?.pressed;
        if (now && !this._padPrev[i]) this.pressed.add(code);
        this._padPrev[i] = now;
      };
      edge(5, 'KeyE');
      edge(4, 'KeyW');
      edge(3, 'KeyR');
      edge(2, 'KeyC');
      edge(9, 'Escape');
    }

    if (analog) {
      this.steer = steerT;
      this.accel = accelT;
      this.decel = decelT;
    } else {
      // Keys are on/off; ramp them so a tap is a small input and a hold is a
      // full one. Steering returns to centre faster than it winds on.
      const sRate = steerT === 0 || Math.sign(steerT) !== Math.sign(this.steer) ? 7.5 : 5;
      this.steer += Math.max(-sRate * dt, Math.min(sRate * dt, steerT - this.steer));
      this.accel += Math.max(-9 * dt, Math.min(5.5 * dt, accelT - this.accel));
      this.decel += Math.max(-12 * dt, Math.min(7 * dt, decelT - this.decel));
    }
    this.handbrake = hb;
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
  }
}
