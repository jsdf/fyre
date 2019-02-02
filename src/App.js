// @flow
import './App.css';
import assets from './assets';
import React, {Component} from 'react';
import Vec2d from './Vec2d';
import EasyStar from 'easystarjs';

const TENT_ROWS = 6;
const TENT_COLS = 10;
const TENT_SPACING_X = 96;
const TENT_SPACING_Y = 64;
const SCALE = 2;
const DEBUG = false;
const VIEWBOX_PADDING_X = 128;
const VIEWBOX_PADDING_Y = 64;
const DARK = false;

const TENT_START_POS = new Vec2d({x: 20, y: 20});

function toScreenPx(px) {
  return px * SCALE;
}

const getImage = (() => {
  const cache = new Map();
  return url => {
    if (url == '') {
      return;
    }
    const cached = cache.get(url);
    if (cached) {
      return cached.image;
    } else {
      const imageRef: {image: ?Image} = {image: null};
      const image = new Image();
      image.onload = () => {
        imageRef.image = image;
      };
      image.onerror = () => {
        throw new Error(`failed to load ${url}`);
      };
      image.src = url;
      cache.set(url, imageRef);
    }
    return null;
  };
})();

function precacheImageAssets() {
  Object.keys(assets).forEach(key => getImage(assets[key]));
}

type Direction = 'up' | 'down' | 'left' | 'right';
const DIRECTIONS: Array<Direction> = ['up', 'down', 'left', 'right'];
type KeyStates = {['up' | 'down' | 'left' | 'right' | 'attack']: boolean};

const DIRECTIONS_VECTORS = {
  up: new Vec2d({x: 0, y: -1}),
  down: new Vec2d({x: 0, y: 1}),
  left: new Vec2d({x: -1, y: 0}),
  right: new Vec2d({x: 1, y: 0}),
};

class GameObject {
  static maxId = 0;
  id = GameObject.maxId++;
  pos: Vec2d = new Vec2d();
  sprite = '';
  bboxStart = new Vec2d(); // top left
  bboxEnd = new Vec2d(); // bottom right
  enabled = true;

  constructor(init?: {x: number, y: number}) {
    if (init) {
      this.pos.x = init.x;
      this.pos.y = init.y;
    }
  }

  update(game: Game) {
    // noop
  }

  getCenter() {
    return this.pos
      .clone()
      .add(this.bboxStart)
      .add(this.bboxEnd.clone().divideScalar(2));
  }
}

class Tent extends GameObject {
  pissiness = 0;
  damageTaken = 0;
  sprite = assets.dstent;
  bboxStart = new Vec2d({x: 3, y: 8});
  bboxEnd = new Vec2d({x: 38, y: 33});
  static MAX_DAMAGE = 3;
  static MAX_PISSINESS = 3;

  damage() {
    if (this.damageTaken < Tent.MAX_DAMAGE) {
      this.damageTaken++;
      if (this.damageTaken === Tent.MAX_DAMAGE) {
        this.sprite = assets.dstentdmg;
      }
      return true;
    }
    return false;
  }
  pissOn() {
    if (this.pissiness < Tent.MAX_PISSINESS) {
      this.pissiness++;
      return true;
    }
    return false;
  }

  isUsable() {
    return (
      this.pissiness < Tent.MAX_PISSINESS && this.damageTaken < Tent.MAX_DAMAGE
    );
  }
}

class Powerup extends GameObject {
  update(game: Game) {
    this.pos.y += Math.sin(game.frame / 10 + this.id % 10);
  }
  pickedUp(player: Player) {
    // noop
  }
}

class Water extends Powerup {
  sprite = assets.water;
  bboxStart = new Vec2d({x: 14, y: 6});
  bboxEnd = new Vec2d({x: 58, y: 57});
  static VALUE = 3;

  pickedUp(player: Player) {
    player.piss = Math.min(player.piss + Water.VALUE, Player.MAX_PISS);
    this.enabled = false;
  }
}

class CheeseSandwich extends Powerup {
  sprite = assets.cheese;
  bboxStart = new Vec2d({x: 20, y: 22});
  bboxEnd = new Vec2d({x: 43, y: 44});
  static VALUE = 3;
  pickedUp(player: Player) {
    player.energy = Math.min(
      player.energy + CheeseSandwich.VALUE,
      Player.MAX_ENERGY
    );
    this.enabled = false;
  }
}

function typeFilter<T>(objs: Array<GameObject>, Typeclass: Class<T>): Array<T> {
  const result = [];
  for (var i = 0; i < objs.length; i++) {
    if (objs[i] instanceof Typeclass) {
      result.push(objs[i]);
    }
  }
  return result;
}

class Path {
  points: Array<Vec2d>;
  nextPointIndex: number = 0;
  constructor(points: Array<Vec2d>) {
    this.points = points;
  }
  advance() {
    this.nextPointIndex++;
  }
  getNextPoint() {
    return this.points[this.nextPointIndex];
  }
  nextPointIsDestination() {
    return this.nextPointIndex >= this.points.length - 1;
  }
}

class FestivalGoer extends GameObject {
  pos = new Vec2d({x: 100 + Math.floor(Math.random() * 300), y: 320});
  bboxStart = new Vec2d({x: 13, y: 18});
  bboxEnd = new Vec2d({x: 17, y: 23});
  lastMove = new Vec2d();
  isMoving = false;
  isPathfinding = false;
  target: ?Tent = null;
  path: ?Path = null;
  static MOVEMENT_SPEED = 1;
  stillSprite = assets.personstill;
  walkAnim = [
    assets.personwalkcycle1,
    assets.personwalkcycle2,
    assets.personwalkcycle3,
  ];
  static FRAMES_PER_ANIM_FRAME = 3;

  tryAcquireTarget(game: Game) {
    const tents = typeFilter(game.worldObjects, Tent);

    const candidate = tents[Math.floor(Math.random() * tents.length)];

    if (candidate.isUsable()) {
      this.target = candidate;
    }
  }

  findPath(game: Game, target: Tent) {
    this.isPathfinding = true;
    const start = game.toPathfindingCoords(this.pos);
    const end = game.toPathfindingCoords(target.pos);
    end.y += Game.PATH_GRID_TENT_SIZE;

    game.easystar.findPath(start.x, start.y, end.x, end.y, gridPath => {
      this.isPathfinding = false;
      if (gridPath === null) {
        console.error('pathfinding failed', this, {start, end});
      } else {
        this.path = new Path(
          gridPath.length == 0
            ? [target.pos]
            : gridPath.map(gridPoint => game.fromPathfindingCoords(gridPoint))
        );
      }
    });
    game.easystar.calculate();
  }

  update(game: Game) {
    if (!this.target) {
      this.tryAcquireTarget(game);
    }

    let playerMove = new Vec2d();
    const path = this.path;
    const target = this.target;

    if (target) {
      if (!(path || this.isPathfinding)) {
        this.findPath(game, target);
      } else if (path) {
        if (this.pos.distanceTo(path.getNextPoint()) < 1) {
          path.advance();
        }

        if (!path.nextPointIsDestination()) {
          playerMove.add(this.pos.directionTo(path.getNextPoint()));
        } else {
          playerMove.add(this.pos.directionTo(target.pos));
        }
      }
    }

    // DIRECTIONS.forEach(direction => {
    //   if (Math.round(Math.random())) {
    //     playerMove.add(DIRECTIONS_VECTORS[direction]);
    //   }
    // });

    if (playerMove.x !== 0 || playerMove.y !== 0) {
      playerMove = getMovementVelocity(playerMove, FestivalGoer.MOVEMENT_SPEED);
      this.pos.add(playerMove);
      this.lastMove = playerMove;
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }

    this.animUpdate(game);
  }

  animUpdate(game: Game) {
    if (this.isMoving) {
      this.sprite = this.walkAnim[
        Math.floor(
          Math.floor(game.frame / FestivalGoer.FRAMES_PER_ANIM_FRAME) %
            this.walkAnim.length
        )
      ];
    } else {
      this.sprite = this.stillSprite;
    }
  }
}

class Player extends FestivalGoer {
  piss = 10;
  energy = 10;
  score = 0;
  pos = new Vec2d({x: 300, y: 200});
  bboxStart = new Vec2d({x: 13, y: 18});
  bboxEnd = new Vec2d({x: 17, y: 23});
  stillSprite = assets.guystill;
  walkAnim = [assets.guywalkcycle1, assets.guywalkcycle2, assets.guywalkcycle3];
  static MOVEMENT_SPEED = 2;
  static MAX_PISS = 10;
  static MAX_ENERGY = 10;

  withinAttackRange() {
    return (
      this.target && this.pos.distanceTo(this.target.pos) < 30
    ); /*close to tent*/
  }

  update(game: Game) {
    let playerMove = new Vec2d();
    DIRECTIONS.forEach(direction => {
      if (game.keys[direction]) {
        playerMove.add(DIRECTIONS_VECTORS[direction]);
      }
    });

    if (playerMove.x !== 0 || playerMove.y !== 0) {
      playerMove = getMovementVelocity(playerMove, Player.MOVEMENT_SPEED);
      this.pos.add(playerMove);
      this.lastMove = playerMove;
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }

    // find target
    const tentsByDistance = typeFilter(game.worldObjects, Tent).sort(
      (a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos)
    );
    const target = tentsByDistance[0];
    this.target = target;

    if (game.keys.attack) {
      if (this.withinAttackRange()) {
        this.doAttack(target);
      } else {
        this.doPiss(target);
      }
    }

    this.animUpdate(game);
  }

  doAttack(tent: Tent) {
    if (this.energy && tent.damage()) {
      this.score += 100;
      this.energy--;
    }
  }

  doPiss(tent: Tent) {
    if (this.piss && tent.pissOn()) {
      this.score += 100;
      this.piss--;
    }
  }
}

function getMovementVelocity(movement: Vec2d, magnitude: number) {
  const direction = movement.clone().normalise();
  const velocity = direction.multiplyScalar(magnitude);
  return velocity;
}

function collision(a: GameObject, b: GameObject) {
  // work out the corners (x1,x2,y1,y1) of each rectangle
  // top left
  let ax1 = a.pos.x + a.bboxStart.x;
  let ay1 = a.pos.y + a.bboxStart.y;
  // bottom right
  let ax2 = a.pos.x + a.bboxEnd.x;
  let ay2 = a.pos.y + a.bboxEnd.y;
  // top left
  let bx1 = b.pos.x + b.bboxStart.x;
  let by1 = b.pos.y + b.bboxStart.y;
  // bottom right
  let bx2 = b.pos.x + b.bboxEnd.x;
  let by2 = b.pos.y + b.bboxEnd.y;

  // test rectangular overlap
  return !(ax1 > bx2 || bx1 > ax2 || ay1 > by2 || by1 > ay2);
}

class View {
  offset = new Vec2d();
  toScreenX(x: number) {
    return x - this.offset.x;
  }
  toScreenY(y: number) {
    return y - this.offset.y;
  }
}

function calculateViewAdjustment(
  offset,
  paddingSizeForDimension,
  viewportSizeForDimension,
  playerPosForDimension
) {
  const boxMinAbs = offset + paddingSizeForDimension;
  const boxMaxAbs = offset + viewportSizeForDimension - paddingSizeForDimension;

  const deltaMin = Math.min(playerPosForDimension - boxMinAbs, 0);
  const deltaMax = -Math.min(boxMaxAbs - playerPosForDimension, 0);

  const delta = deltaMin === 0 ? deltaMax : deltaMin;
  return delta;
}

class Game {
  frame = 0;
  player = new Player();
  keys: KeyStates = {
    up: false,
    down: false,
    left: false,
    right: false,
    attack: false,
  };

  worldObjects = [];

  view = new View();

  easystar = new EasyStar.js();

  constructor() {
    this._spawnTents();
    this.worldObjects.push(this.player);
    this._spawnPowerups();
    this._startSpawningPeople();
  }

  static PATH_GRID_MUL = 2;
  static PATH_GRID_TENT_SIZE = 1;

  toPathfindingCoords(pos: Vec2d) {
    const x = Math.min(
      Math.floor(
        (pos.x - TENT_START_POS.x) / TENT_SPACING_X * Game.PATH_GRID_MUL
      ),
      TENT_COLS * Game.PATH_GRID_MUL
    );
    const y = Math.min(
      Math.floor(
        (pos.y - TENT_START_POS.y) / TENT_SPACING_Y * Game.PATH_GRID_MUL
      ),
      TENT_ROWS * Game.PATH_GRID_MUL
    );
    return {x, y};
  }
  fromPathfindingCoords(point: {x: number, y: number}) {
    const pos = new Vec2d();
    pos.x = point.x / Game.PATH_GRID_MUL * TENT_SPACING_X + TENT_START_POS.x;
    pos.y = point.y / Game.PATH_GRID_MUL * TENT_SPACING_Y + TENT_START_POS.y;
    return pos;
  }

  _spawnTents() {
    for (var i = 0; i < TENT_COLS * TENT_ROWS; i++) {
      const col = i % TENT_COLS;
      const row = Math.floor(i / TENT_COLS);

      const randomnessInv = 6;
      const tent = new Tent();
      tent.pos.x =
        TENT_START_POS.x +
        col * TENT_SPACING_X +
        Math.floor(Math.random() * TENT_SPACING_X / randomnessInv);
      tent.pos.y =
        TENT_START_POS.y +
        row * TENT_SPACING_Y +
        Math.floor(Math.random() * TENT_SPACING_Y / randomnessInv);
      this.worldObjects.push(tent);
    }

    const pathfinding = [];
    for (let i = 0; i < TENT_ROWS * Game.PATH_GRID_MUL; i++) {
      pathfinding[i] = [];

      for (let k = 0; k < TENT_COLS * Game.PATH_GRID_MUL; k++) {
        pathfinding[i][k] =
          i % Game.PATH_GRID_MUL < Game.PATH_GRID_TENT_SIZE &&
          k % Game.PATH_GRID_MUL < Game.PATH_GRID_TENT_SIZE
            ? 1
            : 0;
      }
    }
    console.log(pathfinding);
    this.easystar.setGrid(pathfinding);
    this.easystar.setAcceptableTiles([0]);
    this.easystar.enableSync();
  }

  _spawnPerson() {
    this.worldObjects.push(new FestivalGoer());
  }

  _startSpawningPeople() {
    let population = 0;
    const interval = setInterval(() => {
      if (population++ > 20) {
        clearInterval(interval);
      }

      this._spawnPerson();
    }, 1000);
  }

  _spawnPowerups() {
    for (var i = 0; i < 4; i++) {
      const idx = i * 7; // skip
      const col = idx % TENT_COLS;
      const row = Math.floor(idx / TENT_COLS);
      const initPos = {
        x:
          TENT_START_POS.x +
          TENT_SPACING_X * col /*skip*/ +
          TENT_SPACING_X / 2 /*offset*/,
        y:
          TENT_START_POS.y +
          TENT_SPACING_Y * row /*skip*/ +
          TENT_SPACING_Y / 2 /*offset*/,
      };
      this.worldObjects.push(
        i % 2 == 1 ? new Water(initPos) : new CheeseSandwich(initPos)
      );
    }
  }

  update() {
    for (var i = 0; i < this.worldObjects.length; i++) {
      this.worldObjects[i].update(this);
    }
    this._detectCollisions();
    this._updateViewOffset();
  }

  _updateViewOffset() {
    /*
        plr
      box|
   scr | |
    |  | |   
    v  v |   
    |  | v   
    |  | x   
 
    boxAbs = scrOff+boxRel
    if (plr - boxAbs < 0), scrOff -= plr - boxAbs
     */

    const viewWidth = window.innerWidth / SCALE;
    const viewHeight = window.innerHeight / SCALE;

    this.view.offset.x += calculateViewAdjustment(
      this.view.offset.x,
      VIEWBOX_PADDING_X,
      viewWidth,
      this.player.pos.x
    );
    this.view.offset.y += calculateViewAdjustment(
      this.view.offset.y,
      VIEWBOX_PADDING_Y,
      viewHeight,
      this.player.pos.y
    );
  }

  _detectCollisions() {
    for (var i = this.worldObjects.length - 1; i >= 0; i--) {
      const object = this.worldObjects[i];
      for (var k = this.worldObjects.length - 1; k >= 0; k--) {
        const otherObject = this.worldObjects[k];
        if (object !== otherObject) {
          if (collision(object, otherObject)) {
            this._handleCollision(object, otherObject);
          }
        }
      }
    }
  }

  _handleCollision(object: GameObject, otherObject: GameObject) {
    if (!otherObject.enabled) return;
    if (object instanceof FestivalGoer && otherObject instanceof Tent) {
      object.pos.sub(object.lastMove);
    }

    if (object instanceof Player && otherObject instanceof Powerup) {
      otherObject.pickedUp(object);
    }
  }
}

function lerp(v0: number, v1: number, t: number) {
  return (1 - t) * v0 + t * v1;
}

const renderFestivalGoerImage = (
  ctx: CanvasRenderingContext2D,
  view: View,
  person: FestivalGoer
) => {
  // TODO: move this to player class
  const facingRight = person.lastMove.x > 0;

  const image = getImage(person.sprite);
  if (!image) return;

  if (facingRight) {
    ctx.save();
    ctx.translate(
      Math.floor(view.toScreenX(person.pos.x + image.width)),
      Math.floor(view.toScreenY(person.pos.y))
    );
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(
      image,
      Math.floor(view.toScreenX(person.pos.x)),
      Math.floor(view.toScreenY(person.pos.y)),
      image.width,
      image.height
    );
  }

  if (DEBUG && person.target) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'black';
    ctx.fillText(
      String(person.target.id),
      view.toScreenX(person.pos.x),
      view.toScreenY(person.pos.y)
    );
  }
};

const renderTilesInView = (ctx: CanvasRenderingContext2D, view: View) => {
  const image = getImage(DARK ? assets.dssand2dark : assets.dssand2);
  if (!image) return;

  const viewWidth = window.innerWidth / SCALE;
  const viewHeight = window.innerHeight / SCALE;

  const firstTileX = Math.floor(view.offset.x / image.width) * image.width;
  const numTilesInViewX = viewWidth / image.width + 1;
  const firstTileY = Math.floor(view.offset.y / image.height) * image.height;
  const numTilesInViewY = viewHeight / image.height + 1;

  for (let row = 0; row < numTilesInViewY; row++) {
    for (let col = 0; col < numTilesInViewX; col++) {
      ctx.drawImage(
        image,
        Math.floor(view.toScreenX(firstTileX + col * image.width)),
        Math.floor(view.toScreenY(firstTileY + row * image.height)),
        image.width,
        image.height
      );
    }
  }
};

const renderObjectImage = (
  ctx: CanvasRenderingContext2D,
  view: View,
  obj: GameObject
) => {
  const image = getImage(obj.sprite);
  if (!image) return;

  ctx.drawImage(
    image,
    view.toScreenX(Math.floor(obj.pos.x)),
    view.toScreenY(Math.floor(obj.pos.y)),
    image.width,
    image.height
  );

  if (DEBUG) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'black';
    ctx.fillText(
      String(obj.id),
      view.toScreenX(obj.pos.x),
      view.toScreenY(obj.pos.y)
    );
  }
};

const renderTarget = (
  ctx: CanvasRenderingContext2D,
  view: View,
  target: Tent,
  game: Game
) => {
  const image = getImage(assets.target);
  if (!image) return;

  ctx.drawImage(
    image,
    Math.floor(view.toScreenX(target.pos.x)),
    Math.floor(view.toScreenY(target.pos.y)),
    image.width,
    image.height
  );

  const label = game.player.withinAttackRange()
    ? `smash ${target.damageTaken}/${Tent.MAX_DAMAGE}`
    : `piss on ${target.pissiness}/${Tent.MAX_PISSINESS}`;
  ctx.font = '10px monospace';
  ctx.fillStyle = 'black';

  ctx.fillText(
    label,
    Math.floor(view.toScreenX(target.pos.x)),
    Math.floor(view.toScreenY(target.pos.y)) - 4
  );
};

const Hud = (props: {game: Game}) => {
  const {target} = props.game.player;
  return (
    <div style={{position: 'absolute', top: 0, left: 0}}>
      <div>
        <div className="statbarlabel">Piss: </div>
        <div
          className="statbar"
          style={{background: '#ff4', width: props.game.player.piss * 10}}
        />
      </div>
      <div>
        <div className="statbarlabel">Energy: </div>
        <div
          className="statbar"
          style={{background: '#f44', width: props.game.player.energy * 10}}
        />
      </div>
      <div>
        <div className="statbarlabel">Score: </div>
        {props.game.player.score}
      </div>
      <pre>
        {DEBUG &&
          JSON.stringify(
            {
              target: target && {
                id: target.id,
                distanceTo: props.game.player
                  .getCenter()
                  .distanceTo(target.getCenter())
                  .toFixed(2),
              },
            },
            null,
            2
          )}
      </pre>
    </div>
  );
};

class App extends Component<{}, void> {
  game = new Game();
  componentDidMount() {
    window.game = Game;
    document.addEventListener('keydown', (event: KeyboardEvent) =>
      this._handleKey(event, true)
    );
    document.addEventListener('keyup', (event: KeyboardEvent) =>
      this._handleKey(event, false)
    );
    window.addEventListener('resize', () => this.forceUpdate());

    this._renderCanvas();
    this._enqueueFrame();
    precacheImageAssets();
  }

  componentDidUpdate() {
    this._renderCanvas();
  }

  _handleKey(event: KeyboardEvent, pressed: boolean) {
    switch (event.key) {
      case 'w':
      case 'ArrowUp': {
        this.game.keys.up = pressed;
        break;
      }
      case 'a':
      case 'ArrowLeft': {
        this.game.keys.left = pressed;
        break;
      }
      case 's':
      case 'ArrowDown': {
        this.game.keys.down = pressed;
        break;
      }
      case 'd':
      case 'ArrowRight': {
        this.game.keys.right = pressed;
        break;
      }
      case ' ': {
        this.game.keys.attack = pressed;
        break;
      }
    }
  }
  _enqueueFrame() {
    requestAnimationFrame(() => {
      this.game.frame++;
      this._update();
      this._renderCanvas();
      this.forceUpdate(); // TODO: remove this when hud doesn't need react
      this._enqueueFrame();
    });
  }
  _update() {
    this.game.update();
  }

  _canvas: ?HTMLCanvasElement = null;
  _onCanvas = (canvas: ?HTMLCanvasElement) => {
    this._canvas = canvas;
  };
  _renderCanvas() {
    const canvas = this._canvas;
    if (canvas instanceof HTMLCanvasElement) {
      const ctx = canvas.getContext('2d');
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderTilesInView(ctx, this.game.view);
      this.game.worldObjects.forEach((obj, i) => {
        if (!obj.enabled) {
          return;
        }
        if (obj instanceof Player) {
          renderFestivalGoerImage(ctx, this.game.view, obj);
        } else if (obj instanceof FestivalGoer) {
          renderFestivalGoerImage(ctx, this.game.view, obj);
        } else if (obj instanceof Powerup) {
          return;
        } else {
          renderObjectImage(ctx, this.game.view, obj);
        }
      });
      const {target} = this.game.player;

      if (DARK) {
        // render tint
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = '#aac2eb';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      }

      // render powerups above tint
      this.game.worldObjects.forEach((obj, i) => {
        if (!obj.enabled) {
          return;
        }
        if (obj instanceof Powerup) {
          renderObjectImage(ctx, this.game.view, obj);
        }
      });
      if (target) {
        renderTarget(ctx, this.game.view, target, this.game);
      }
    }
  }
  render() {
    return (
      <div className="App">
        <canvas
          ref={this._onCanvas}
          width={window.innerWidth / 2}
          height={window.innerHeight / 2}
          style={{transform: `scale(${SCALE})`, transformOrigin: 'top left'}}
          className="sprite"
        />

        <Hud game={this.game} />
      </div>
    );
  }
}

export default App;
