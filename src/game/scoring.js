// Drift scoring: points build with speed and angle while the car is sliding,
// a multiplier grows the longer the slide is held, and the run is banked when
// the car straightens up. Hitting something or spinning throws it away.

const MIN_ANGLE = (12 * Math.PI) / 180;
const MIN_SPEED = 8;

export class Scoring {
  constructor(storageKey) {
    this.key = storageKey;
    this.total = 0;
    this.best = Number(localStorage.getItem(storageKey) || 0);
    this.bestRun = 0;
    this.message = null;
    this.reset();
  }

  reset() {
    this.current = 0;
    this.time = 0;
    this.grace = 0;
    this.active = false;
    this.dir = 0;
    this.links = 0;
    this.angle = 0;
  }

  get multiplier() {
    return Math.min(5, 1 + Math.floor(this.time / 2.5) * 0.5 + this.links * 0.5);
  }

  say(text, kind = 'good') {
    this.message = { text, kind };
  }

  update(dt, car, impact) {
    const beta = car.driftAngle;
    const abs = Math.abs(beta);
    this.angle = (abs * 180) / Math.PI;
    const forward = car.u > 2;
    const sliding = forward && car.speed > MIN_SPEED && abs > MIN_ANGLE && abs < 1.75;

    if (this.active && impact > 3) {
      if (this.current > 50) this.say('CONTACT — RUN LOST', 'bad');
      this.reset();
      return;
    }
    if (this.active && (abs > 1.9 || car.u < -1) && car.speed > 4) {
      if (this.current > 50) this.say('SPIN — RUN LOST', 'bad');
      this.reset();
      return;
    }

    if (sliding) {
      const dir = Math.sign(beta);
      if (!this.active) {
        this.active = true;
        this.time = 0;
        this.links = 0;
        this.current = 0;
        this.dir = dir;
      } else if (dir !== this.dir) {
        this.dir = dir;
        this.links++;
        this.say('TRANSITION', 'good');
      }
      this.grace = 1.1;
      this.time += dt;
      const angleFactor = Math.min(this.angle, 60) / 30;
      this.current += car.speed * angleFactor * 5 * dt;
    } else if (this.active) {
      this.grace -= dt;
      if (this.grace <= 0) this.bank();
    }
  }

  bank() {
    const gained = Math.round(this.current * this.multiplier);
    if (gained >= 100) {
      this.total += gained;
      if (gained > this.bestRun) this.bestRun = gained;
      this.say(`+${gained.toLocaleString('en-US')}`, 'bank');
      if (this.total > this.best) {
        this.best = this.total;
        localStorage.setItem(this.key, String(this.best));
      }
    }
    this.reset();
  }
}
