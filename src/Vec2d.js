// @flow

export default class Vec2d {
  x: number = 0;
  y: number = 0;

  constructor(init?: {x: number, y: number}) {
    if (init) {
      this.x = init.x;
      this.y = init.y;
    }
  }

  clone() {
    return new Vec2d(this);
  }

  add(other: Vec2d) {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

  normalise() {
    if (this.x == 0 && this.y == 0) return this;

    const magnitude = Math.sqrt(this.x * this.x + this.y * this.y);
    this.x /= magnitude;
    this.y /= magnitude;
    return this;
  }

  multiplyScalar(scalar: number) {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }
}
