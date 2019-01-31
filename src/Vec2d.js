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

  sub(other: Vec2d) {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }

  normalise() {
    if (this.x == 0 && this.y == 0) return this;

    const magnitude = Math.sqrt(this.x * this.x + this.y * this.y);
    this.x /= magnitude;
    this.y /= magnitude;
    return this;
  }

  addScalar(scalar: number) {
    this.x += scalar;
    this.y += scalar;
    return this;
  }

  multiplyScalar(scalar: number) {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  divideScalar(scalar: number) {
    this.x /= scalar;
    this.y /= scalar;
    return this;
  }

  distanceTo(other: Vec2d) {
    return Math.sqrt((this.x - other.x) ** 2 + (this.y - other.y) ** 2);
  }

  directionTo(other: Vec2d) {
    return other
      .clone()
      .sub(this)
      .normalise();
  }
}
