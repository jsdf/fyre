// @flow

export type Vec2dInit = {x: number, y: number};

function lerp(v0, v1, t) {
  return v0 * (1 - t) + v1 * t;
}

export default class Vec2d {
  x: number = 0;
  y: number = 0;

  constructor(init?: Vec2dInit) {
    if (init) {
      this.x = init.x;
      this.y = init.y;
    }
  }

  clone() {
    return new Vec2d(this);
  }

  copyFrom(other: Vec2dInit) {
    this.x = other.x;
    this.y = other.y;
    return this;
  }

  add(other: Vec2dInit) {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

  sub(other: Vec2dInit) {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }

  normalise() {
    if (this.x === 0 && this.y === 0) return this;

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

  subScalar(scalar: number) {
    this.x -= scalar;
    this.y -= scalar;
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

  scale(scale: number) {
    return this.multiplyScalar(scale);
  }

  distanceTo(other: Vec2dInit) {
    return Math.sqrt((this.x - other.x) ** 2 + (this.y - other.y) ** 2);
  }

  directionTo(other: Vec2dInit) {
    return new Vec2d(other).sub(this).normalise();
  }

  lerp(v0: Vec2dInit, v1: Vec2dInit, t: number) {
    this.x = lerp(v0.x, v1.x, t);
    this.y = lerp(v0.y, v1.y, t);
    return this;
  }

  angle() {
    let angle = Math.atan2(this.y, this.x);

    if (angle < 0) angle += 2 * Math.PI;

    return angle;
  }

  toJSON() {
    return {
      x: this.x,
      y: this.y,
    };
  }

  toString() {
    return `{x:${this.x}, y:${this.y}}`;
  }

  equals(other: Vec2dInit): boolean {
    return this.x === other.x && this.y === other.y;
  }

  static memoizedOneArgDeriver(
    getInput: () => Vec2d,
    derive: (input: Vec2d, result: Vec2d) => void
  ): () => Vec2d {
    const cacheKey: Vec2d = new Vec2d();
    let cached: ?Vec2d = null;

    return () => {
      const input = getInput();
      if (cached != null && cacheKey.equals(input)) {
        return cached;
      } else {
        cacheKey.copyFrom(input);
        cached = new Vec2d();
        derive(input, cached);
        return cached;
      }
    };
  }

  static memoizedZeroArgDeriver(derive: () => Vec2d) {
    let result: ?Vec2d = null;

    return () => {
      if (result == null) {
        result = derive();
      }
      return result;
    };
  }
}
