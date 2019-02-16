// @flow
import './App.css';
import assets from './assets';
import sounds from './sounds';
import React, {Component} from 'react';
import Vec2d from './Vec2d';
import EasyStar from 'easystarjs';
import objectsData from './objects.json';
import type {Vec2dInit} from './Vec2d';

type GameObjectInit = {type: string, pos: {x: number, y: number}};

const objects: Array<GameObjectInit> = objectsData;

const TENT_ROWS = 5;
const TENT_COLS = 10;
const TENT_SPACING_X = 96;
const TENT_SPACING_Y = 64;
const PATH_GRID_ROWS = 5;
const PATH_GRID_COLS = 15;
const PATH_GRID_UNIT_WIDTH = 64;
const PATH_GRID_UNIT_HEIGHT = 64;
const SCALE = 2;
const DEBUG_OBJECTS = true;
const DEBUG_AI_TARGETS = false;
const DEBUG_BBOX = true;
const DEBUG_PLAYER_STATE = false;
const DEBUG_PATHFINDING_NODES = false;
const DEBUG_PATHFINDING_BBOXES = false;
const DEBUG_PATH_FOLLOWING = false;
const DEBUG_PATH_FOLLOWING_STUCK = true;
const DEBUG_AJACENCY = true;
const VIEWBOX_PADDING_X = 128;
const VIEWBOX_PADDING_Y = 64;
const DARK = false;
const DRAW_HUD = false;

const WALKABLE = 0;
const UNWALKABLE = 1;
type Walkability = typeof WALKABLE | typeof UNWALKABLE;

const TENT_START_POS = new Vec2d({x: 20, y: 20});
const BG_OFFSET = new Vec2d({x: -400, y: -800});

function toScreenPx(px) {
  return px * SCALE;
}

function last<T>(arr: Array<T>): T {
  return arr[arr.length - 1];
}

const getImage = (() => {
  const cache = new Map();
  return (url: $Values<typeof assets> | '') => {
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

declare class Audio {
  oncanplay: Function;
  onerror: Function;
  src: string;
  play: Function;
  volume: number;
}

const getSound = (() => {
  const cache = new Map();
  return (url: string) => {
    if (url == '') {
      return;
    }
    const cached = cache.get(url);
    if (cached) {
      return cached.audio;
    } else {
      const audioRef: {audio: ?Audio} = {audio: null};
      const audio = new Audio();
      audio.oncanplay = () => {
        audioRef.audio = audio;
      };
      audio.onerror = () => {
        throw new Error(`failed to load ${url}`);
      };
      audio.src = url;
      cache.set(url, audioRef);
    }
    return null;
  };
})();

function playSound(url: string) {
  const sound = getSound(url);
  if (sound) {
    sound.play();
    sound.volume = 0.5;
  } else {
    console.error('sound not ready', JSON.stringify(url));
  }
}

function precacheImageAssets() {
  Object.keys(assets).forEach(key => getImage(assets[key]));
}
function precacheAudioAssets() {
  Object.keys(sounds).forEach(key => getSound(sounds[key]));
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

  constructor(init?: Vec2dInit) {
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
      .add(
        this.bboxEnd
          .clone()
          .sub(this.bboxStart)
          .divideScalar(2)
      );
  }

  toJSON() {
    return {
      type: this.constructor.name,
      pos: this.pos.toJSON(),
    };
  }
}

class Tent extends GameObject {
  pissiness = 0;
  damageTaken = 0;
  occupied = false;
  sprite = assets.dstent;
  bboxStart = new Vec2d({x: 6, y: 11});
  bboxEnd = new Vec2d({x: 40, y: 33});
  static MAX_DAMAGE = 1;
  static MAX_PISSINESS = 1;

  doDamage() {
    if (this.damageTaken < Tent.MAX_DAMAGE) {
      this.damageTaken++;
      if (this.damageTaken === Tent.MAX_DAMAGE) {
        this.sprite = assets.dstentdmg;
      }
    }
  }
  canDamage() {
    if (this.damageTaken < Tent.MAX_DAMAGE) {
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
      this.pissiness < Tent.MAX_PISSINESS &&
      this.damageTaken < Tent.MAX_DAMAGE &&
      !this.occupied
    );
  }
}

class Powerup extends GameObject {
  sound = '';
  update(game: Game) {
    this.pos.y += Math.sin(game.frame / 10 + this.id % 10);
  }
  pickedUp(player: Player) {
    playSound(this.sound);
  }
}

class Water extends Powerup {
  sprite = assets.water;
  sound = sounds.pickup1;
  bboxStart = new Vec2d({x: 19, y: 15});
  bboxEnd = new Vec2d({x: 46, y: 43});
  static VALUE = 3;

  pickedUp(player: Player) {
    super.pickedUp(player);
    player.piss = Math.min(player.piss + Water.VALUE, Player.MAX_PISS);
    this.enabled = false;
  }
}

class CheeseSandwich extends Powerup {
  sprite = assets.cheese;

  sound = sounds.pickup2;
  bboxStart = new Vec2d({x: 20, y: 22});
  bboxEnd = new Vec2d({x: 43, y: 44});
  static VALUE = 3;
  pickedUp(player: Player) {
    super.pickedUp(player);
    player.energy = Math.min(
      player.energy + CheeseSandwich.VALUE,
      Player.MAX_ENERGY
    );
    this.enabled = false;
  }
}

class Bus extends GameObject {
  sprite = assets.bus;
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
    return this.nextPointIndex < this.points.length
      ? this.points[this.nextPointIndex]
      : null;
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
  stuck = false;
  static MOVEMENT_SPEED = 1;
  stillSprite = assets.personstill;
  walkAnim = [
    assets.personwalkcycle1,
    assets.personwalkcycle2,
    assets.personwalkcycle3,
  ];
  static FRAMES_PER_ANIM_FRAME = 3;

  static DIALOG = [
    'Where can I charge my drone?',
    "We'll remember this for the rest of our lives",
    "I'm shooting video in both horizontal & vertical formats",
    "They're not EarPods, they're AirPods",
    'I quit my job to come to this',
  ];

  static DIALOG_VISIBLE_TIME = 3000;
  static DIALOG_CHANCE = 10000;

  enterTent(tent: Tent) {
    if (!tent.isUsable()) {
      // give up on this one, find another
      this.clearTarget();
    } else {
      this.enabled = false;
      tent.occupied = true;
      playSound(sounds.occupy);
    }
  }

  tryAcquireTarget(game: Game) {
    const tents = typeFilter(game.worldObjects, Tent);

    const candidate = tents[Math.floor(Math.random() * tents.length)];

    if (candidate && candidate.isUsable()) {
      this.target = candidate;
    }
  }

  findNearestWalkableTile(
    game: Game,
    target: {x: number, y: number},
    searchRadius: number
  ) {
    const {pathfindingGrid} = game;
    if (pathfindingGrid == null) {
      console.error('pathfindingGrid not initialized');
      return;
    }
    // find nearest walkable tile
    const candidates = [];
    for (let rowRel = -1 * searchRadius; rowRel < searchRadius; rowRel++) {
      for (let colRel = -1 * searchRadius; colRel < searchRadius; colRel++) {
        const pathfindingPos = {x: target.x + colRel, y: target.y + rowRel};
        const gamePos = game.fromPathfindingCoords(pathfindingPos);
        const pathfindingPosClamped = game.toPathfindingCoords(gamePos);
        candidates.push({
          pathfindingPos,
          distance: this.getCenter().distanceTo(
            game.fromPathfindingCoords(pathfindingPos)
          ),
          walkable:
            pathfindingGrid[pathfindingPosClamped.y][
              pathfindingPosClamped.x
            ] === WALKABLE,
        });
      }
    }

    const bestCandidates = candidates
      .filter(c => c.walkable)
      .sort((a, b) => a.distance - b.distance);

    if (bestCandidates.length > 0) {
      return bestCandidates[0].pathfindingPos;
    }
    return null;
  }

  findPath(game: Game, target: Tent) {
    this.isPathfinding = true;
    let start = game.toPathfindingCoords(this.getCenter());
    let end = game.toPathfindingCoords(target.getCenter());

    const {pathfindingGrid} = game;
    if (pathfindingGrid == null) {
      console.error('pathfindingGrid not initialized');
      return;
    }

    const searchRadius = Game.PATH_GRID_TENT_SIZE; // more than the width of a tent

    if (pathfindingGrid[start.y][start.x] !== WALKABLE) {
      const improvedStart = this.findNearestWalkableTile(
        game,
        start,
        searchRadius
      );
      if (improvedStart) {
        start = improvedStart;
      }
    }
    if (pathfindingGrid[end.y][end.x] !== WALKABLE) {
      const improvedEnd = this.findNearestWalkableTile(game, end, searchRadius);
      if (improvedEnd) {
        end = improvedEnd;
      }
    }

    if (pathfindingGrid[start.y][start.x] !== WALKABLE) {
      console.error('pathfinding: start is unwalkable');
      return;
    }
    if (pathfindingGrid[end.y][end.x] !== WALKABLE) {
      console.error('pathfinding: end is unwalkable');
      return;
    }

    try {
      game.easystar.findPath(start.x, start.y, end.x, end.y, gridPath => {
        if (gridPath === null) {
          console.error('pathfinding failed', this, {start, end});
        } else {
          if (gridPath.length == 0) {
            console.error('pathfinding failed: empty', this, {start, end});
          } else {
            this.path = new Path(
              gridPath.length == 0
                ? [target.pos]
                : gridPath.map(gridPoint =>
                    game.fromPathfindingCoords(gridPoint)
                  )
            );

            const nextPoint = this.path.getNextPoint();

            if (false && nextPoint && this.pos.distanceTo(nextPoint) > 100) {
              console.error(
                'garbage pathfinding result',
                this,
                {start, end},
                this.path
              );
              this.path = null;
            } else {
              this.isPathfinding = false;
            }
          }
        }
      });
    } catch (err) {
      console.error('pathfinding error', err, this, {start, end});
    }

    game.easystar.calculate();
  }

  activeDialog: ?{text: string, startTime: number} = null;

  updateDialog() {
    if (this.activeDialog) {
      // clear expired dialog
      const {startTime} = this.activeDialog;
      if (Date.now() > startTime + FestivalGoer.DIALOG_VISIBLE_TIME) {
        this.activeDialog = null;
      }
    }

    if (!this.activeDialog) {
      // maybe say new dialog
      if (Math.floor(Math.random() * FestivalGoer.DIALOG_CHANCE) === 0) {
        this.activeDialog = {
          text:
            FestivalGoer.DIALOG[
              Math.floor(Math.random() * FestivalGoer.DIALOG.length)
            ],
          startTime: Date.now(),
        };
      }
    }
  }

  clearTarget() {
    this.target = null;
    this.path = null;
  }

  update(game: Game) {
    this.stuck = false;
    if (!this.target) {
      this.tryAcquireTarget(game);
    }

    this.updateDialog();

    let playerMove = new Vec2d();
    const path = this.path;
    const target = this.target;

    if (target) {
      if (!(path || this.isPathfinding)) {
        this.findPath(game, target);
      } else if (path) {
        const curPoint = path.getNextPoint();
        if (curPoint && this.getCenter().distanceTo(curPoint) < 1) {
          path.advance();
        }

        if (!path.nextPointIsDestination()) {
          const nextPoint = path.getNextPoint();
          if (!nextPoint) {
            throw new Error('expected next point');
          }
          playerMove.add(this.getCenter().directionTo(nextPoint));
        } else {
          playerMove.add(this.getCenter().directionTo(target.getCenter()));
        }
      }
    }

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

class PlayerState {
  update(player: Player): ?PlayerState {}

  toString() {
    return `${this.constructor.name} {}`;
  }
}

class IdleState extends PlayerState {}

class TimedAttackState extends PlayerState {
  duration = 1000;
  sound = '';
  startTime = Date.now();
  target: Tent;

  _initialized = false;

  constructor(target: Tent) {
    super();
    this.target = target;
  }

  update(player: Player): ?PlayerState {
    if (!this._initialized) {
      this._initialized = true;
      this.atStart();
    }
    if (Date.now() > this.startTime + this.duration) {
      this.atEnd();
      return new IdleState();
    }
  }

  atStart() {
    playSound(this.sound);
  }

  atEnd() {
    // noop
  }

  toString() {
    return `${this.constructor.name} { target: ${this.target.id} }`;
  }
}

class PissingState extends TimedAttackState {
  sound = sounds.piss;
}
class AttackingState extends TimedAttackState {
  sound = sounds.smash;
  atEnd() {
    this.target.doDamage();
  }
}

class Player extends FestivalGoer {
  piss = 3;
  energy = 3;
  score = 0;
  pos = new Vec2d({x: 300, y: 200});
  bboxStart = new Vec2d({x: 13, y: 18});
  bboxEnd = new Vec2d({x: 17, y: 23});
  stillSprite = assets.guystill;
  walkAnim = [assets.guywalkcycle1, assets.guywalkcycle2, assets.guywalkcycle3];
  state: PlayerState = new IdleState();
  static MOVEMENT_SPEED = 2;
  static MAX_PISS = 10;
  static MAX_ENERGY = 10;
  static MAX_PISS_DISTANCE = 100;
  static MAX_ATTACK_DISTANCE = 30;

  withinAttackRange(tent: Tent) {
    // are we close to a tent?
    return this.pos.distanceTo(tent.pos) < Player.MAX_ATTACK_DISTANCE;
  }

  withinPissRange(tent: Tent) {
    return this.pos.distanceTo(tent.pos) < Player.MAX_PISS_DISTANCE;
  }

  update(game: Game) {
    let playerMove = new Vec2d();
    DIRECTIONS.forEach(direction => {
      if (game.keys[direction]) {
        playerMove.add(DIRECTIONS_VECTORS[direction]);
      }
    });

    if (
      (playerMove.x !== 0 || playerMove.y !== 0) &&
      // can't move in attacking state
      !(this.state instanceof AttackingState)
    ) {
      playerMove = getMovementVelocity(playerMove, Player.MOVEMENT_SPEED);
      this.pos.add(playerMove);
      this.lastMove = playerMove;
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }

    // find target
    const tentsByDistance = typeFilter(game.worldObjects, Tent)
      .filter(
        t =>
          t.isUsable() &&
          // if we're out of piss, only find attackable targets.
          (this.piss > 0
            ? this.withinPissRange(t)
            : // if we're out of energy...
              this.energy > 0 ? this.withinAttackRange(t) : false)
      )
      .sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos));
    const target = tentsByDistance.length ? tentsByDistance[0] : null;
    this.target = target;

    if (game.keys.attack && target && this.state instanceof IdleState) {
      if (this.withinAttackRange(target)) {
        this.doAttack(target);
      } else {
        this.doPiss(target);
      }
    }

    const nextState = this.state.update(this);
    if (nextState) {
      this.state = nextState;
    }

    this.animUpdate(game);
  }

  doAttack(tent: Tent) {
    if (this.energy && tent.canDamage()) {
      this.score += 100;
      this.energy--;
      this.state = new AttackingState(tent);
    }
  }

  doPiss(tent: Tent) {
    if (this.piss && tent.pissOn()) {
      this.score += 100;
      this.piss--;
      this.state = new PissingState(tent);
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
  fromScreenX(x: number) {
    return x + this.offset.x;
  }
  fromScreenY(y: number) {
    return y + this.offset.y;
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

function clamp(x, min, max) {
  return Math.max(Math.min(x, max), min);
}

type EditorState =
  | {mode: 'pathfinding'}
  | {mode: 'objects', type: Class<GameObject>}
  | {mode: 'play'};

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

  worldObjects: Array<GameObject> = [];
  worldObjectsByID: Map<number, GameObject> = new Map();

  view = new View();
  editor = {mode: 'play'};

  easystar = new EasyStar.js();
  pathfindingGrid: ?Array<Array<number>> = null;
  tentAdjacencies: Map<number, Array<number>> = new Map();

  constructor() {
    this._initPathfinding();
    this._spawnObjects();

    // this._spawnTents();
    // this._spawnBus();
    this.addWorldObject(this.player);
    this._initTentAdjacencies();

    // this._spawnPowerups();
    // this._startSpawningPeople();
  }

  addWorldObject(obj: GameObject) {
    this.worldObjects.push(obj);
    this.worldObjectsByID.set(obj.id, obj);
  }

  spawnObjectOfType(obj: GameObjectInit) {
    switch (obj.type) {
      case 'Tent':
        return this._spawnTent(obj.pos);
      case 'Bus':
        return this._spawnBus(obj.pos);
      case 'CheeseSandwich':
        return this._spawnGeneric(obj.pos, CheeseSandwich);
      case 'Water':
        return this._spawnGeneric(obj.pos, Water);
    }
    throw new Error(`unknown object type ${obj.type}`);
  }

  _spawnObjects() {
    objects.filter(obj => obj.type == 'Tent').forEach(obj => {
      this.spawnObjectOfType(obj);
    });
  }

  _spawnGeneric(pos: Vec2dInit, Class: Class<GameObject>) {
    this.addWorldObject(new Class(pos));
  }

  dumpObjects() {
    return JSON.stringify(
      this.worldObjects
        .map(obj => {
          switch (obj.constructor.name) {
            case 'Tent':
            case 'Bus':
            case 'CheeseSandwich':
            case 'Water':
              return obj.toJSON();
          }
          return null;
        })
        .filter(Boolean),
      null,
      2
    );
  }

  static PATH_GRID_MUL = 5;
  static PATH_GRID_TENT_SIZE = 4;
  static PATH_GRID_OFFSET = TENT_START_POS.clone().add(
    new Vec2d({
      x: 0, //TENT_SPACING_X / Game.PATH_GRID_MUL / 2,
      y: TENT_SPACING_Y / Game.PATH_GRID_MUL / 2,
    })
  );

  toPathfindingCoords(pos: Vec2d) {
    const x = clamp(
      Math.floor(
        (pos.x - Game.PATH_GRID_OFFSET.x) /
          (PATH_GRID_UNIT_WIDTH / Game.PATH_GRID_MUL)
      ),
      0,
      PATH_GRID_COLS * Game.PATH_GRID_MUL - 1
    );
    const y = clamp(
      Math.floor(
        (pos.y - Game.PATH_GRID_OFFSET.y) /
          (PATH_GRID_UNIT_HEIGHT / Game.PATH_GRID_MUL)
      ),
      0,
      PATH_GRID_ROWS * Game.PATH_GRID_MUL - 1
    );
    if (Number.isNaN(x) || Number.isNaN(y)) {
      debugger;
    }
    return {x, y};
  }
  fromPathfindingCoords(point: {x: number, y: number}) {
    const pos = new Vec2d();
    const gridItemWidth = PATH_GRID_UNIT_WIDTH / Game.PATH_GRID_MUL;
    const gridItemHeight = PATH_GRID_UNIT_HEIGHT / Game.PATH_GRID_MUL;
    pos.x = Game.PATH_GRID_OFFSET.x + (point.x + 0.5) * gridItemWidth;
    pos.y = Game.PATH_GRID_OFFSET.y + (point.y + 0.5) * gridItemHeight;
    return pos;
  }

  _spawnBus(pos: Vec2dInit) {
    const bus = new Bus(pos);

    this.addWorldObject(bus);
  }

  _spawnTent(pos: Vec2dInit) {
    const tent = new Tent(pos);

    this._makeObjectBBoxUnwalkable(tent);

    this.addWorldObject(tent);
  }

  _makeObjectBBoxUnwalkable(obj: GameObject) {
    const objBBoxStart = obj.pos.clone().add(obj.bboxStart);
    const objBBoxEnd = obj.pos.clone().add(obj.bboxEnd);
    const objPathfindingStartPos = this.toPathfindingCoords(objBBoxStart);
    const objPathfindingEndPos = this.toPathfindingCoords(objBBoxEnd);

    // set interecting pathfinding tiles unwalkable
    for (
      let pathRow = objPathfindingStartPos.y;
      pathRow <= objPathfindingEndPos.y;
      pathRow++
    ) {
      for (
        let pathCol = objPathfindingStartPos.x;
        pathCol <= objPathfindingEndPos.x;
        pathCol++
      ) {
        this.setPathfindingTile({x: pathCol, y: pathRow}, UNWALKABLE);
      }
    }
  }

  _initPathfinding() {
    const pathfinding = [];
    for (let i = 0; i < PATH_GRID_ROWS * Game.PATH_GRID_MUL; i++) {
      pathfinding[i] = [];

      for (let k = 0; k < PATH_GRID_COLS * Game.PATH_GRID_MUL; k++) {
        pathfinding[i][k] = WALKABLE;
      }
    }
    this.pathfindingGrid = pathfinding;
    this.easystar.setGrid(pathfinding);
    this.easystar.setAcceptableTiles([WALKABLE]);
    this.easystar.enableDiagonals();

    this.easystar.enableSync();
  }

  _initTentAdjacencies() {
    const searchArea = new Vec2d({x: 100, y: 100});
    const tents = typeFilter(this.worldObjects, Tent);
    class RangeQuery extends GameObject {}

    for (var i = 0; i < tents.length; i++) {
      // simulate range query using collision system
      const center = tents[i].getCenter().clone();
      const range = new RangeQuery(center.sub(searchArea));
      const adjacencyList = [];
      this.tentAdjacencies.set(tents[i].id, adjacencyList);
      range.bboxStart = new Vec2d({x: 0, y: 0});
      range.bboxEnd = searchArea.clone().multiplyScalar(2);

      for (var k = 0; k < tents.length; k++) {
        if (
          i !== k && // ignore self
          collision(tents[k], range)
        ) {
          adjacencyList.push(tents[k].id);
        }
      }
    }
  }

  _spawnTents() {
    for (var i = 0; i < TENT_COLS * TENT_ROWS; i++) {
      const col = i % TENT_COLS;
      const row = Math.floor(i / TENT_COLS);

      const randomnessInv = 6;
      const pos = new Vec2d({
        x:
          TENT_START_POS.x +
          col * TENT_SPACING_X +
          Math.floor(Math.random() * TENT_SPACING_X / randomnessInv),
        y:
          TENT_START_POS.y +
          row * TENT_SPACING_Y +
          Math.floor(Math.random() * TENT_SPACING_Y / randomnessInv),
      });

      this._spawnTent(pos);
    }
  }

  togglePathfindingTile(pathPoint: {x: number, y: number}) {
    this._setPathfindingTile(pathPoint);
  }

  setPathfindingTile(pathPoint: {x: number, y: number}, setTo: Walkability) {
    this._setPathfindingTile(pathPoint, setTo);
  }

  _setPathfindingTile(pathPoint: {x: number, y: number}, setTo?: ?Walkability) {
    const pathfinding = this.pathfindingGrid;

    if (!pathfinding) return;

    pathfinding[pathPoint.y][pathPoint.x] =
      setTo == null
        ? pathfinding[pathPoint.y][pathPoint.x] === WALKABLE
          ? UNWALKABLE
          : WALKABLE // toggle
        : setTo;

    console.log(
      'set',
      pathPoint.x,
      pathPoint.y,
      'to',
      pathfinding[pathPoint.y][pathPoint.x]
    );

    this.easystar.setGrid(pathfinding);
  }

  _spawnPerson() {
    this.addWorldObject(new FestivalGoer());
  }

  _startSpawningPeople() {
    let population = 0;
    const interval = setInterval(() => {
      if (population++ > 20) {
        clearInterval(interval);
      }

      this._spawnPerson();
      this._spawnPerson();
      this._spawnPerson();
    }, 5000);
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
      this.addWorldObject(
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
    // prevent penetration of solid objects
    if (object instanceof FestivalGoer && otherObject instanceof Tent) {
      object.pos.sub(object.lastMove);
      if (
        !(object instanceof Player) &&
        object.target &&
        object.target === otherObject
      ) {
        object.enterTent(otherObject);
      } else {
        object.stuck = true;
      }
    }

    if (object instanceof Player && otherObject instanceof Powerup) {
      otherObject.pickedUp(object);
    }
  }
}

function lerp(v0: number, v1: number, t: number) {
  return (1 - t) * v0 + t * v1;
}

const renderBBox = (
  ctx: CanvasRenderingContext2D,
  view: View,
  obj: GameObject
) => {
  ctx.strokeStyle = 'red';

  const x = Math.floor(view.toScreenX(obj.pos.x + obj.bboxStart.x));
  const y = Math.floor(view.toScreenY(obj.pos.y + obj.bboxStart.y));
  const width = Math.floor(obj.bboxEnd.x - obj.bboxStart.x);
  const height = Math.floor(obj.bboxEnd.y - obj.bboxStart.y);
  ctx.strokeRect(x, y, width, height);
};

const renderPoint = (
  ctx: CanvasRenderingContext2D,
  view: View,
  pos: Vec2d,
  color: string
) => {
  ctx.fillStyle = color;

  const x = Math.floor(view.toScreenX(pos.x - 2));
  const y = Math.floor(view.toScreenY(pos.y - 2));
  const width = 4;
  const height = 4;
  ctx.fillRect(x, y, width, height);
};

const renderPathfindingGrid = (
  ctx: CanvasRenderingContext2D,
  view: View,
  game: Game
) => {
  if (DEBUG_PATHFINDING_NODES || DEBUG_PATHFINDING_BBOXES) {
    if (!game.pathfindingGrid) return;
    const grid = game.pathfindingGrid;

    const width = Math.floor(PATH_GRID_UNIT_WIDTH / Game.PATH_GRID_MUL);
    const height = Math.floor(PATH_GRID_UNIT_HEIGHT / Game.PATH_GRID_MUL);
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        const pos = game.fromPathfindingCoords({x: col, y: row});
        const {x, y} = pos;

        const isBlocked = grid[row][col] == 1;

        const color = isBlocked ? 'red' : 'green';
        if (DEBUG_PATHFINDING_NODES) {
          renderPoint(ctx, view, pos, color);
        }
        if (DEBUG_PATHFINDING_BBOXES) {
          ctx.strokeStyle = color;

          ctx.strokeRect(
            Math.floor(view.toScreenX(x - width / 2)),
            Math.floor(view.toScreenY(y - height / 2)),
            width,
            height
          );
        }
      }
    }
  }
};

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
    // hack to fix misaligned reversed sprite
    const rightFacingOffset = -1;
    ctx.save();
    ctx.translate(
      Math.floor(
        view.toScreenX(person.pos.x + image.width + rightFacingOffset)
      ),
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

  if (person.activeDialog) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'black';
    ctx.fillText(
      person.activeDialog.text,
      view.toScreenX(person.pos.x),
      view.toScreenY(person.pos.y)
    );
  }

  const {target} = person;

  if (DEBUG_AI_TARGETS && target) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'black';
    ctx.strokeStyle = 'white';
    ctx.strokeText(
      `t=${target.id}`,
      view.toScreenX(person.pos.x + 20),
      view.toScreenY(person.pos.y)
    );
    ctx.fillText(
      `t=${target.id}`,
      view.toScreenX(person.pos.x + 20),
      view.toScreenY(person.pos.y)
    );
  }
  if (DEBUG_OBJECTS) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'black';
    ctx.fillText(
      person.constructor.name + String(person.id),
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

const renderBG = (ctx: CanvasRenderingContext2D, view: View) => {
  const image = getImage(assets.bg);
  if (!image) return;

  const viewWidth = window.innerWidth / SCALE;
  const viewHeight = window.innerHeight / SCALE;

  ctx.drawImage(
    image,
    Math.floor(view.toScreenX(BG_OFFSET.x)),
    Math.floor(view.toScreenY(BG_OFFSET.y)),
    image.width,
    image.height
  );
};

const renderPissStream = (
  ctx: CanvasRenderingContext2D,
  view: View,
  from: Vec2d,
  to: Vec2d
) => {
  ctx.strokeStyle = 'yellow';
  ctx.beginPath();
  ctx.moveTo(view.toScreenX(from.x), view.toScreenY(from.y));
  // ctx.lineTo(view.toScreenX(to.x), view.toScreenY(to.y));
  ctx.bezierCurveTo(
    view.toScreenX(from.x + (to.x - from.x) * 0.25),
    view.toScreenY(from.y - 20),
    view.toScreenX(to.x),
    view.toScreenY(to.y - 20),
    view.toScreenX(to.x),
    view.toScreenY(to.y)
  );
  ctx.stroke();

  // splashes
  ctx.strokeStyle = 'white';

  for (var i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(view.toScreenX(to.x), view.toScreenY(to.y));
    ctx.lineTo(
      Math.floor(view.toScreenX(to.x + (Math.random() * 10 - 5))),
      Math.floor(view.toScreenY(to.y + (Math.random() * 10 - 5)))
    );
    ctx.stroke();
  }
};

const renderDebugLine = (
  ctx: CanvasRenderingContext2D,
  view: View,
  from: Vec2d,
  to: Vec2d
) => {
  ctx.strokeStyle = 'blue';
  ctx.beginPath();
  ctx.moveTo(view.toScreenX(from.x), view.toScreenY(from.y));
  // ctx.lineTo(view.toScreenX(to.x), view.toScreenY(to.y));
  ctx.bezierCurveTo(
    view.toScreenX(from.x + (to.x - from.x) * 0.25),
    view.toScreenY(from.y - 20),
    view.toScreenX(to.x),
    view.toScreenY(to.y - 20),
    view.toScreenX(to.x),
    view.toScreenY(to.y)
  );
  ctx.stroke();

  // tip
  ctx.strokeStyle = 'purple';

  ctx.beginPath();

  ctx.moveTo(view.toScreenX(to.x), view.toScreenY(to.y));

  const reverseLine = to.clone().add(to.directionTo(from).scale(5));
  ctx.lineTo(
    Math.floor(view.toScreenX(reverseLine.x)),
    Math.floor(view.toScreenY(reverseLine.y))
  );
  ctx.stroke();
};

const renderObjectImage = (
  ctx: CanvasRenderingContext2D,
  view: View,
  obj: GameObject
) => {
  const image = getImage(obj.sprite);
  if (image) {
    ctx.drawImage(
      image,
      view.toScreenX(Math.floor(obj.pos.x)),
      view.toScreenY(Math.floor(obj.pos.y)),
      image.width,
      image.height
    );
  }

  if (DEBUG_OBJECTS) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'black';
    ctx.fillText(
      obj.constructor.name + String(obj.id),
      view.toScreenX(obj.pos.x),
      view.toScreenY(obj.pos.y)
    );
    renderPoint(ctx, view, obj.getCenter(), 'orange');
  }
  if (DEBUG_BBOX) {
    renderBBox(ctx, view, obj);
  }
};

const renderImage = (
  ctx: CanvasRenderingContext2D,
  view: View,
  pos: Vec2d,
  imageUrl: $Values<typeof assets>
) => {
  const image = getImage(imageUrl);
  if (!image) return;

  ctx.drawImage(
    image,
    view.toScreenX(Math.floor(pos.x)),
    view.toScreenY(Math.floor(pos.y)),
    image.width,
    image.height
  );
};

const renderLabel = (
  ctx: CanvasRenderingContext2D,
  view: View,
  obj: GameObject,
  text: string,
  color: string,
  yOffset: number
) => {
  ctx.font = '10px monospace';
  ctx.fillStyle = color;

  const label = text;
  const tentCenter = obj.getCenter();
  const labelMetrics = ctx.measureText(label);

  ctx.fillText(
    label,
    Math.floor(view.toScreenX(tentCenter.x) - labelMetrics.width / 2),
    Math.floor(view.toScreenY(tentCenter.y) + yOffset)
  );
};

const renderTent = (ctx: CanvasRenderingContext2D, view: View, tent: Tent) => {
  renderObjectImage(ctx, view, tent);

  if (tent.occupied) {
    // renderLabel(ctx, view, tent, 'occupied', 'red', -5);
    renderImage(
      ctx,
      view,
      tent.pos.clone().add({x: -8, y: 0}),
      assets.occupied
    );
  } else if (tent.pissiness >= Tent.MAX_PISSINESS) {
    // renderLabel(ctx, view, tent, 'pissy', 'blue', -5);
    renderImage(ctx, view, tent.pos.clone().add({x: -8, y: 0}), assets.pissed);
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
  const targetCenter = target.getCenter();

  ctx.drawImage(
    image,
    Math.floor(view.toScreenX(targetCenter.x)) - image.width / 2,
    Math.floor(view.toScreenY(targetCenter.y)) - image.height / 2,
    image.width,
    image.height
  );

  const label =
    game.player.target && game.player.withinAttackRange(game.player.target)
      ? `smash`
      : `piss on`;
  ctx.font = '10px monospace';
  ctx.fillStyle = 'black';

  ctx.fillText(
    label,
    Math.floor(view.toScreenX(targetCenter.x)) -
      ctx.measureText(label).width / 2,
    Math.floor(view.toScreenY(target.pos.y))
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
        {DEBUG_PLAYER_STATE &&
          JSON.stringify(
            {
              player: {
                state: props.game.player.state.toString(),
                pos: props.game.player.pos,
                pathGridPos: props.game.toPathfindingCoords(
                  props.game.player.pos
                ),
              },
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

class Editor extends React.Component<{game: Game}> {
  _initMode(name: string) {
    switch (name) {
      case 'pathfinding':
        return {mode: 'pathfinding'};
      case 'objects':
        return {mode: 'objects', type: Tent};
    }
    return {mode: 'play'};
  }
  _handleEditorModeChange = () => {
    const prevMode = this.props.game.editor.mode;
    const modes = ['pathfinding', 'objects', 'play'];
    const nextMode = modes[(modes.indexOf(prevMode) + 1) % modes.length];

    this.props.game.editor = this._initMode(nextMode);
  };
  _handleObjectTypeChange = () => {
    const {editor} = this.props.game;
    if (editor.mode !== 'objects') {
      throw new Error(`wrong mode ${editor.mode}`);
    }
    const prevObjectType = editor.type;
    const types = [Tent, CheeseSandwich, Water, Bus];
    const nextObjectType =
      types[(types.indexOf(prevObjectType) + 1) % types.length];

    editor.type = nextObjectType;
  };
  render() {
    const {editor} = this.props.game;

    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 300,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
        }}
      >
        <div>
          <button onClick={this._handleEditorModeChange}>{editor.mode}</button>
        </div>
        {editor.mode === 'objects' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
            }}
            onClick={this._handleObjectTypeChange}
          >
            <div>{editor.type.name}</div>
            <div>
              <img src={new editor.type().sprite} />
            </div>
          </div>
        )}
      </div>
    );
  }
}

class App extends Component<{}, void> {
  game = new Game();
  componentDidMount() {
    window.game = this.game;
    window.renderer = this;
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
    precacheAudioAssets();
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
      // this._renderCanvas();
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
      // renderTilesInView(ctx, this.game.view);
      renderBG(ctx, this.game.view);
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
        } else if (obj instanceof Tent) {
          renderTent(ctx, this.game.view, obj);
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

      // render stuff above tint
      renderPathfindingGrid(ctx, this.game.view, this.game);
      this.game.worldObjects.forEach((obj, i) => {
        if (!obj.enabled) {
          return;
        }
        if (obj instanceof Powerup) {
          renderObjectImage(ctx, this.game.view, obj);
        } else if (obj instanceof FestivalGoer) {
          if (DEBUG_PATH_FOLLOWING_STUCK && obj.stuck) {
            const {path} = obj;
            if (path) {
              let lastPoint = obj.getCenter();
              for (var i = 0; i < path.points.length; i++) {
                const dest = path.points[i];

                renderPoint(ctx, this.game.view, dest, 'blue');

                renderPissStream(ctx, this.game.view, lastPoint, dest);
                lastPoint = path.points[i];
              }
            }
          } else if (DEBUG_PATH_FOLLOWING) {
            const {path} = obj;
            if (path) {
              const dest = path.getNextPoint();
              if (dest) {
                renderPoint(ctx, this.game.view, dest, 'blue');

                renderPissStream(ctx, this.game.view, obj.getCenter(), dest);
              }
            }
          }
        } else if (obj instanceof Tent) {
          if (DEBUG_AJACENCY) {
            const adjacencies = this.game.tentAdjacencies.get(obj.id);
            if (adjacencies) {
              for (var i = 0; i < adjacencies.length; i++) {
                const adjacent = this.game.worldObjectsByID.get(adjacencies[i]);
                if (adjacent) {
                  renderDebugLine(
                    ctx,
                    this.game.view,
                    obj.getCenter(),
                    adjacent.getCenter()
                  );
                }
              }
            }
          }
        }

        renderBBox(ctx, this.game.view, obj);
      });

      // render singleton things
      const playerState = this.game.player.state;

      if (playerState instanceof PissingState) {
        renderPissStream(
          ctx,
          this.game.view,
          this.game.player.getCenter().add(new Vec2d({x: 0, y: -4})),
          playerState.target.getCenter()
        );
      }
      if (target) {
        renderTarget(ctx, this.game.view, target, this.game);
      }
    }
  }

  _handleClick = (event: SyntheticMouseEvent<HTMLCanvasElement>) => {
    const pos = new Vec2d({
      x: Math.floor(this.game.view.fromScreenX(event.pageX / SCALE)),
      y: Math.floor(this.game.view.fromScreenY(event.pageY / SCALE)),
    });
    switch (this.game.editor.mode) {
      case 'pathfinding': {
        const pathPoint = this.game.toPathfindingCoords(pos);
        this.game.togglePathfindingTile(pathPoint);
        break;
      }
      case 'objects': {
        this.game.spawnObjectOfType({type: this.game.editor.type.name, pos});
      }
    }
  };
  render() {
    return (
      <div className="App">
        <canvas
          ref={this._onCanvas}
          onClick={this._handleClick}
          width={window.innerWidth / 2}
          height={window.innerHeight / 2}
          style={{transform: `scale(${SCALE})`, transformOrigin: 'top left'}}
          className="sprite"
        />

        {DRAW_HUD && <Hud game={this.game} />}
        <Editor game={this.game} />
      </div>
    );
  }
}

export default App;
