// @flow
import './App.css';
import assets from './assets';
import sounds from './sounds';
import React, {Component} from 'react';
import Vec2d from './Vec2d';
import EasyStar from 'easystarjs';
import objectsData from './objects.json';
import gridData from './grid.json';
import type {Vec2dInit} from './Vec2d';

type GameObjectInit = {type: string, pos: {x: number, y: number}};

const objects: Array<GameObjectInit> = objectsData;

const PROD_OPTIMIZE = false;
const MAX_OBJECT_SIZE = 96;
const GRID_SUBDIV = 5;
const GRID_ROWS = 17 * GRID_SUBDIV;
const GRID_COLS = 18 * GRID_SUBDIV;
const GRID_UNIT_WIDTH = 64 / GRID_SUBDIV;
const GRID_UNIT_HEIGHT = 64 / GRID_SUBDIV;
const SCALE = 2;
const DEBUG_OBJECTS = false;
const DEBUG_AI_TARGETS = false;
const DEBUG_AI_STATE = true;
const DEBUG_BBOX = false;
const DEBUG_PLAYER_STATE = true;
const DEBUG_WORLD_STATE = true;
const DEBUG_PATHFINDING_NODES = false;
const DEBUG_PATHFINDING_BBOXES = false;
const DEBUG_PATH_FOLLOWING = false;
const DEBUG_PATH_FOLLOWING_STUCK = true;
const DEBUG_AJACENCY = false;
const DEBUG_DISABLE_PEOPLE = false;
const DEBUG_TENT_GROUPS = false;
const DARK = false;
const DRAW_HUD = true;
const SOUND_VOLUME = 0.5;
const TENT_ADJACENCY_RADIUS = 100;
const PERF_FRAMETIME = false;
const PERF_PATHFINDING = false;
const MOUSE_CONTROL = true;
const MAX_CAPTURABLE_TENT_GROUP = 3;

function range(size: number) {
  return Array(size)
    .fill(0)
    .map((_, i) => i);
}

const [WALKABLE, AI_UNWALKABLE, UNWALKABLE] = range(3);

type Walkability = typeof WALKABLE | typeof AI_UNWALKABLE | typeof UNWALKABLE;

const GRID_START = new Vec2d({x: 20, y: 20});
const BG_OFFSET = new Vec2d({x: -400, y: -200});

function last<T>(arr: Array<T>): T {
  return arr[arr.length - 1];
}

function throttle<T>(fn: (arg: T) => void, time: number): (arg: T) => void {
  let id = null;

  return (arg: T) => {
    if (id == null) {
      fn(arg);
      id = setTimeout(() => {
        id = null;
      }, time);
    }
  };
}

function memoizedVec2dOneArgDeriver(
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

function memoizedVec2dZeroArgDeriver(derive: () => Vec2d) {
  let result: ?Vec2d = null;

  return () => {
    if (result == null) {
      result = derive();
    }
    return result;
  };
}

const getImage = (() => {
  const cache = new Map();
  return (url: $Values<typeof assets> | '') => {
    if (url === '') {
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
  pause: Function;
  volume: number;
  loop: boolean;
}

const getSound = (() => {
  const cache = new Map();
  return (url: string) => {
    if (url === '') {
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
    sound.volume = SOUND_VOLUME;
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

function frameCycle(
  frameAssets: Array<$Values<typeof assets>>,
  framelength: number,
  tick: number
) {
  return frameAssets[
    Math.floor(Math.floor(tick / framelength) % frameAssets.length)
  ];
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

  enabled = true; // visible and collidable
  solid = false; // player cannot pass through
  zLayer = 0;

  constructor(init?: Vec2dInit) {
    if (init) {
      this.pos.x = init.x;
      this.pos.y = init.y;
    }
  }

  update(game: Game) {
    // noop
  }

  getCenterLocalOffset = memoizedVec2dZeroArgDeriver(() =>
    this.bboxEnd
      .clone()
      .sub(this.bboxStart)
      .divideScalar(2)
      .add(this.bboxStart)
  );

  getCenter = memoizedVec2dOneArgDeriver(
    () => this.pos,
    (pos, result) => {
      result.copyFrom(pos).add(this.getCenterLocalOffset());
    }
  );

  getMax = memoizedVec2dOneArgDeriver(
    () => this.pos,
    (pos, result) => {
      result.copyFrom(pos).add(this.bboxEnd);
    }
  );

  toJSON() {
    return {
      type: this.constructor.name,
      pos: this.pos.toJSON(),
    };
  }

  toString() {
    return `${this.constructor.name} {x: ${this.pos.x.toFixed(
      2
    )}, y: ${this.pos.y.toFixed(2)}}`;
  }
}

class Smoke extends GameObject {
  zLayer = 1;

  static ANIM = [assets.smoke1, assets.smoke2, assets.smoke3];

  static FRAMES_PER_ANIM_FRAME = 6;

  update(game: Game) {
    this.sprite = frameCycle(
      Smoke.ANIM,
      Smoke.FRAMES_PER_ANIM_FRAME,
      game.frame
    );
  }
}

class Tent extends GameObject {
  pissiness = 0;
  damageTaken = 0;
  occupied = false;
  captured = false;
  solid = true;
  sprite = assets.dstent;
  intersectingPissArea: ?PissArea = null;
  bboxStart = new Vec2d({x: 6, y: 16});
  bboxEnd = new Vec2d({x: 40, y: 33});
  lastPissedOnStart = 0;
  static MAX_DAMAGE = 1;
  static MAX_PISSINESS = 9;
  static PISS_TIME = 100;

  update(game: Game) {
    if (this.intersectingPissArea) {
      this.intersectingPissArea = null;

      if (Date.now() > this.lastPissedOnStart + Tent.PISS_TIME) {
        this.pissOn();
        this.lastPissedOnStart = Date.now();
      }
    }
  }

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

  canPissOn() {
    if (this.pissiness < Tent.MAX_PISSINESS) {
      return true;
    }
    return false;
  }

  pissOn() {
    if (this.pissiness < Tent.MAX_PISSINESS) {
      this.pissiness++;
      playSound(sounds.hit);
    }
  }

  isRuinedByPlayer() {
    return (
      this.pissiness >= Tent.MAX_PISSINESS ||
      this.damageTaken >= Tent.MAX_DAMAGE
    );
  }

  isUsable() {
    return !this.isRuinedByPlayer() && !this.occupied;
  }

  capture() {
    this.captured = true;
  }

  occupy() {
    this.occupied = true;
  }
}

class PowerupState {
  update(powerup: Powerup): ?PowerupState {
    // noop
  }

  toString() {
    return `${this.constructor.name} {}`;
  }
}

class AvailablePowerupState extends PowerupState {}

class PickedUpPowerupState extends PowerupState {
  startTime = Date.now();

  _initialized = false;

  update(obj: Powerup): ?PowerupState {
    if (!this._initialized) {
      this._initialized = true;
      this.enter(obj);
    }
    if (Date.now() > this.startTime + obj.respawnTime) {
      this.exit(obj);
      return new AvailablePowerupState();
    }
    return null;
  }

  enter(obj: Powerup) {
    playSound(obj.sound);
    obj.enabled = false;
  }

  exit(obj: Powerup) {
    obj.enabled = true;
  }
}

class Powerup extends GameObject {
  sound = '';
  respawnTime = 10000;
  state: PowerupState = new AvailablePowerupState();
  update(game: Game) {
    this.pos.y += Math.sin(game.frame / 10 + (this.id % 10));

    const nextState = this.state.update(this);
    if (nextState) {
      this.state = nextState;
    }
  }
  pickedUp(player: Player) {
    this.state = new PickedUpPowerupState();
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
  solid = true;
  sprite = assets.bus;
  bboxStart = new Vec2d({x: 16, y: 22});
  bboxEnd = new Vec2d({x: 82, y: 53});
}

function typeFilter<T>(objs: Array<GameObject>, Typeclass: Class<T>): Array<T> {
  const result = [];
  for (let i = 0; i < objs.length; i++) {
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

class CharacterState {
  update(game: Game): ?CharacterState {}

  enter(game: Game) {
    // noop
  }

  exit(game: Game) {
    // noop
  }

  toString() {
    return `${this.constructor.name} {}`;
  }
}

class IdleState extends CharacterState {}

class FestivalGoer extends GameObject {
  bboxStart = new Vec2d({x: 13, y: 18});
  bboxEnd = new Vec2d({x: 17, y: 23});
  state: CharacterState = new IdleState();
  lastMove = new Vec2d();
  isMoving = false;
  isPathfinding = false;
  target: ?Tent = null;
  path: ?Path = null;
  stuck = false;
  activeDialog: ?{text: string, startTime: number} = null;

  static MOVEMENT_SPEED = 1;
  stillSprite = assets.personstill;
  walkAnim = [
    assets.personwalkcycle1,
    assets.personwalkcycle2,
    assets.personwalkcycle3,
  ];
  static FRAMES_PER_ANIM_FRAME = 3;

  animUpdate(game: Game) {
    if (this.isMoving) {
      this.sprite = frameCycle(
        this.walkAnim,
        FestivalGoer.FRAMES_PER_ANIM_FRAME,
        game.frame
      );
    } else {
      this.sprite = this.stillSprite;
    }
  }

  updateState(game: Game) {
    const nextState = this.state.update(game);
    if (nextState) {
      this.transitionTo(nextState, game);
    }
  }

  transitionTo(nextState: CharacterState, game: Game) {
    this.state.exit(game);
    this.state = nextState;
    this.state.enter(game);
  }
}

class FleeingState extends CharacterState {
  static FLEE_TIME = 5000;
  startTime = Date.now();
  updateMove(character: AIFestivalGoer, game: Game, move: Vec2d) {
    move.add(game.player.getCenter().directionTo(character.getCenter()));
  }

  update(game: Game) {
    if (Date.now() > this.startTime + FleeingState.FLEE_TIME) {
      return new IdleState();
    }
  }
}

class TargetSeekingState extends CharacterState {
  character: AIFestivalGoer;
  constructor(character: AIFestivalGoer) {
    super();
    this.character = character;
  }

  updateMove(character: AIFestivalGoer, game: Game, move: Vec2d) {
    const path = character.path;
    const target = character.target;
    if (target) {
      if (!(path || character.isPathfinding)) {
        character.findPath(game, target);
      } else if (path) {
        const curPoint = path.getNextPoint();
        if (curPoint && character.getCenter().distanceTo(curPoint) < 1) {
          path.advance();
        }

        if (!path.nextPointIsDestination()) {
          const nextPoint = path.getNextPoint();
          if (!nextPoint) {
            throw new Error('expected next point');
          }
          move.add(character.getCenter().directionTo(nextPoint));
        } else {
          move.add(character.getCenter().directionTo(target.getCenter()));
        }
      }
    }
  }

  toString() {
    return `${this.constructor.name} { target: ${
      this.character.target ? this.character.target.id : '[none]'
    } }`;
  }
}

class AIFestivalGoer extends FestivalGoer {
  static DIALOG = [
    'Where can I charge my drone?',
    "We'll remember this for the rest of our lives",
    "I'm shooting video in both horizontal & vertical formats",
    "They're not EarPods, they're AirPods",
    'I quit my job to come to this',
  ];

  static DIALOG_VISIBLE_TIME = 3000;
  static DIALOG_CHANCE = 10000;
  enterTent(tent: Tent, game: Game) {
    if (!tent.isUsable() || tent.captured) {
      // give up on this one, find another
      this.clearTarget();
    } else {
      this.enabled = false;
      tent.occupy();

      game.checkForTentGroupsAdjacent(tent);
      playSound(sounds.occupy);
      game.removeWorldObject(this);
    }
  }

  runFromPiss(game: Game) {
    this.clearTarget();
    this.transitionTo(new FleeingState(), game);
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
    const {tileGrid} = game.grid;
    if (tileGrid == null) {
      console.error('tileGrid not initialized');
      return;
    }
    // find nearest walkable tile
    const candidates = [];
    for (let rowRel = -1 * searchRadius; rowRel < searchRadius; rowRel++) {
      for (let colRel = -1 * searchRadius; colRel < searchRadius; colRel++) {
        const gridPos = {x: target.x + colRel, y: target.y + rowRel};
        const worldPos = game.grid.tileCenterFromGridCoords(gridPos);
        const gridPosClamped = game.grid.toGridCoords(worldPos);
        candidates.push({
          gridPos,
          distance: this.getCenter().distanceTo(
            game.grid.tileCenterFromGridCoords(gridPos)
          ),
          walkable: tileGrid[gridPosClamped.y][gridPosClamped.x] === WALKABLE,
        });
      }
    }

    const bestCandidates = candidates
      .filter(c => c.walkable)
      .sort((a, b) => a.distance - b.distance);

    if (bestCandidates.length > 0) {
      return bestCandidates[0].gridPos;
    }
    return null;
  }

  findPath(game: Game, target: Tent) {
    this.isPathfinding = true;
    let start = game.grid.toGridCoords(this.getCenter());
    let end = game.grid.toGridCoords(target.getCenter());

    const {tileGrid} = game.grid;
    if (tileGrid == null) {
      console.error('tileGrid not initialized');
      return;
    }

    const searchRadius = Grid.GRID_TENT_SIZE; // more than the width of a tent

    if (tileGrid[start.y][start.x] !== WALKABLE) {
      const improvedStart = this.findNearestWalkableTile(
        game,
        start,
        searchRadius
      );
      if (improvedStart) {
        start = improvedStart;
      }
    }
    if (tileGrid[end.y][end.x] !== WALKABLE) {
      const improvedEnd = this.findNearestWalkableTile(game, end, searchRadius);
      if (improvedEnd) {
        end = improvedEnd;
      }
    }

    if (tileGrid[start.y][start.x] !== WALKABLE) {
      console.error('pathfinding: start is unwalkable');
      return;
    }
    if (tileGrid[end.y][end.x] !== WALKABLE) {
      console.error('pathfinding: end is unwalkable');
      return;
    }
    let startTime = performance.now();
    try {
      game.grid.easystar.findPath(start.x, start.y, end.x, end.y, gridPath => {
        if (gridPath === null) {
          console.error('pathfinding failed', this, {start, end});
        } else {
          if (gridPath.length === 0) {
            console.error('pathfinding failed: empty', this, {start, end});
          } else {
            this.path = new Path(
              gridPath.length === 0
                ? [target.pos]
                : gridPath.map(gridPoint =>
                    game.grid.tileCenterFromGridCoords(gridPoint)
                  )
            );
            this.isPathfinding = false;

            PERF_PATHFINDING &&
              console.log(
                'pathfinding for',
                this.id,
                'took',
                (performance.now() - startTime).toFixed(2),
                'ms'
              );
          }
        }
      });
    } catch (err) {
      console.error('pathfinding error', err, this, {start, end});
    }

    game.grid.easystar.calculate();
  }

  updateDialog() {
    if (this.activeDialog) {
      // clear expired dialog
      const {startTime} = this.activeDialog;
      if (Date.now() > startTime + AIFestivalGoer.DIALOG_VISIBLE_TIME) {
        this.activeDialog = null;
      }
    }

    if (!this.activeDialog) {
      // maybe say new dialog
      if (Math.floor(Math.random() * AIFestivalGoer.DIALOG_CHANCE) === 0) {
        this.activeDialog = {
          text:
            AIFestivalGoer.DIALOG[
              Math.floor(Math.random() * AIFestivalGoer.DIALOG.length)
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

    if (this.target && this.state instanceof IdleState) {
      this.transitionTo(new TargetSeekingState(this), game);
    }

    this.updateDialog();

    let move = new Vec2d();

    if (
      this.state instanceof FleeingState ||
      this.state instanceof TargetSeekingState
    ) {
      this.state.updateMove(this, game, move);
    }

    if (move.x !== 0 || move.y !== 0) {
      move = getMovementVelocity(move, FestivalGoer.MOVEMENT_SPEED);
      const lastPos = this.pos.clone();

      this.pos.add(move);

      const updatedCenter = this.getCenter();
      const walkability = game.grid.getGridTile(
        game.grid.toGridCoordsUnclamped(updatedCenter)
      );
      if (walkability == null || walkability === UNWALKABLE) {
        // revert pos
        this.pos = lastPos;
      }

      this.lastMove = move;
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }

    this.updateState(game);

    this.animUpdate(game);
  }
}

class TimedAttackState extends CharacterState {
  duration = 1000;
  sound = '';
  startTime = Date.now();
  target: Tent;

  constructor(target: Tent) {
    super();
    this.target = target;
  }

  update(): ?CharacterState {
    if (Date.now() > this.startTime + this.duration) {
      return new IdleState();
    }
  }

  enter(game: Game) {
    playSound(this.sound);
  }

  toString() {
    return `${this.constructor.name} { target: ${this.target.id} }`;
  }
}

class TentPissingState extends TimedAttackState {
  sound = sounds.piss;

  exit(game: Game) {
    this.target.pissOn();

    game.checkForTentGroupsAdjacent(this.target);
  }
}

class PissArea extends GameObject {
  bboxStart = new Vec2d({x: -8, y: -8});
  bboxEnd = new Vec2d({x: 8, y: 8});
}

class FreePissingState extends CharacterState {
  static PISS_OFFSET = new Vec2d({x: 0, y: -4});
  static MAX_PISS_DISTANCE = 50;
  static PISS_TIME = 500;
  sound = sounds.whitenoise;
  pissStart = new Vec2d();
  pissArea = new PissArea();
  lastPissStart = Date.now();

  enter(game: Game) {
    game.addWorldObject(this.pissArea);
    playSound(this.sound);
    const sound = getSound(this.sound);
    if (sound) {
      sound.loop = true;
    }
  }

  exit(game: Game) {
    game.removeWorldObject(this.pissArea);
    const sound = getSound(this.sound);
    if (sound) {
      sound.pause();
    }
  }

  update(game: Game): ?CharacterState {
    if (!game.keys.attack || game.player.piss <= 0) {
      return new IdleState();
    }

    if (Date.now() > this.lastPissStart + FreePissingState.PISS_TIME) {
      game.player.piss--;
      this.lastPissStart = Date.now();
    }

    this.pissStart
      .copyFrom(game.player.getCenter())
      .add(FreePissingState.PISS_OFFSET);

    if (
      this.pissStart.distanceTo(game.cursorPos) <
      FreePissingState.MAX_PISS_DISTANCE
    ) {
      this.pissArea.pos.copyFrom(game.cursorPos);
    } else {
      this.pissArea.pos.copyFrom(
        this.pissStart
          .directionTo(game.cursorPos)
          .scale(FreePissingState.MAX_PISS_DISTANCE)
          .add(this.pissStart)
      );
    }
  }
}

class SmashingState extends TimedAttackState {
  duration = 300;
  sound = sounds.smash;
  animation = new Smoke(this.target.pos.clone().add({x: 4, y: 0}));

  enter(game: Game) {
    super.enter(game);
    game.addWorldObject(this.animation);
  }
  exit(game: Game) {
    game.removeWorldObject(this.animation);
    this.target.doDamage();
    game.checkForTentGroupsAdjacent(this.target);
  }
}

class Player extends FestivalGoer {
  static START_POS = new Vec2d({x: 308, y: 791});
  piss = 10;
  energy = 3;
  score = 0;
  pos = Player.START_POS.clone();
  bboxStart = new Vec2d({x: 13, y: 18});
  bboxEnd = new Vec2d({x: 17, y: 23});
  stillSprite = assets.guystill;
  walkAnim = [assets.guywalkcycle1, assets.guywalkcycle2, assets.guywalkcycle3];
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
      !(this.state instanceof SmashingState)
    ) {
      playerMove = getMovementVelocity(playerMove, Player.MOVEMENT_SPEED);
      const lastPos = this.pos.clone();
      this.pos.add(playerMove);
      const updatedCenter = this.getCenter();
      const walkability = game.grid.getGridTile(
        game.grid.toGridCoordsUnclamped(updatedCenter)
      );
      if (walkability == null || walkability === UNWALKABLE) {
        // can go anywhere in editor
        if (!game.inEditorMode) {
          // revert pos
          this.pos = lastPos;
        }
      }
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
          !game.isTentCaptured(t) &&
          // if we're out of piss, only find attackable targets.
          (this.piss > 0
            ? this.withinPissRange(t)
            : // if we're out of energy...
            this.energy > 0
            ? this.withinAttackRange(t)
            : false)
      )
      .sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos));
    const target = tentsByDistance.length ? tentsByDistance[0] : null;
    this.target = target;

    if (game.keys.attack && target && this.state instanceof IdleState) {
      if (this.withinAttackRange(target) && this.energy > 0) {
        this.doSmash(target, game);
      } else {
        if (MOUSE_CONTROL) {
          this.doPissFreely(game);
        } else {
          this.doPissOnTent(target, game);
        }
      }
    }

    this.updateState(game);

    this.animUpdate(game);
  }

  doSmash(tent: Tent, game: Game) {
    if (this.energy && tent.canDamage()) {
      this.score += 100;
      this.energy--;

      this.transitionTo(new SmashingState(tent), game);
    }
  }

  doPissOnTent(tent: Tent, game: Game) {
    if (this.piss && tent.canPissOn()) {
      this.score += 100;
      this.piss--;
      this.transitionTo(new TentPissingState(tent), game);
    }
  }

  doPissFreely(game: Game) {
    this.transitionTo(new FreePissingState(), game);
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
  static VIEWBOX_PADDING_X = 128;
  static VIEWBOX_PADDING_Y = 64;
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

  inView(obj: GameObject) {
    const viewWidth = window.innerWidth / SCALE;
    const viewHeight = window.innerHeight / SCALE;

    // work out the corners (x1,x2,y1,y1) of each rectangle
    // view
    // top left
    let viewx1 = this.offset.x;
    let viewy1 = this.offset.y;
    // bottom right
    let viewx2 = this.offset.x + viewWidth;
    let viewy2 = this.offset.y + viewHeight;
    // obj
    // top left
    let objx1 = obj.pos.x;
    let objy1 = obj.pos.y;
    // bottom right
    let objx2 = obj.pos.x + MAX_OBJECT_SIZE;
    let objy2 = obj.pos.y + MAX_OBJECT_SIZE;

    // test rect overlap
    return !(
      viewx1 > objx2 ||
      objx1 > viewx2 ||
      viewy1 > objy2 ||
      objy1 > viewy2
    );
  }

  update(playerPos: Vec2d, viewWidth: number, viewHeight: number) {
    this.offset.x += View.calculateViewAdjustmentForDimension(
      this.offset.x,
      View.VIEWBOX_PADDING_X,
      viewWidth,
      playerPos.x
    );
    this.offset.y += View.calculateViewAdjustmentForDimension(
      this.offset.y,
      View.VIEWBOX_PADDING_Y,
      viewHeight,
      playerPos.y
    );
  }

  static calculateViewAdjustmentForDimension(
    // arguments are scalar values along the relevant dimension
    offset: number,
    paddingSize: number,
    viewportSize: number,
    playerPos: number
  ) {
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

    const boxMinAbs = offset + paddingSize;
    const boxMaxAbs = offset + viewportSize - paddingSize;

    const deltaMin = Math.min(playerPos - boxMinAbs, 0);
    const deltaMax = -Math.min(boxMaxAbs - playerPos, 0);

    const delta = deltaMin === 0 ? deltaMax : deltaMin;
    return delta;
  }
}

function clamp(x, min, max) {
  return Math.max(Math.min(x, max), min);
}

class Grid {
  easystar = new EasyStar.js();
  tileGrid: ?Array<Array<number>> = gridData;

  constructor() {
    this.easystar.setGrid(gridData);
    this.easystar.setAcceptableTiles([WALKABLE]);
    this.easystar.enableDiagonals();
    this.easystar.disableCornerCutting();

    this.easystar.enableSync();
  }

  static GRID_TENT_SIZE = 4;
  static GRID_OFFSET = GRID_START.clone().add(
    new Vec2d({
      x: 0,
      y: 0,
    })
  );

  toGridCoords(pos: Vec2d) {
    const x = clamp(
      Math.floor((pos.x - Grid.GRID_OFFSET.x) / GRID_UNIT_WIDTH),
      0,
      GRID_COLS - 1
    );
    const y = clamp(
      Math.floor((pos.y - Grid.GRID_OFFSET.y) / GRID_UNIT_HEIGHT),
      0,
      GRID_ROWS - 1
    );
    if (Number.isNaN(x) || Number.isNaN(y)) {
      throw new Error(`invalid coordinates ${x},${y}`);
    }
    return {x, y};
  }
  toGridCoordsUnclamped(pos: Vec2d) {
    const x = Math.floor((pos.x - Grid.GRID_OFFSET.x) / GRID_UNIT_WIDTH);
    const y = Math.floor((pos.y - Grid.GRID_OFFSET.y) / GRID_UNIT_HEIGHT);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      throw new Error(`invalid coordinates ${x},${y}`);
    }
    return {x, y};
  }
  tileCenterFromGridCoords(point: {x: number, y: number}) {
    const pos = new Vec2d();
    pos.x = Grid.GRID_OFFSET.x + (point.x + 0.5) * GRID_UNIT_WIDTH;
    pos.y = Grid.GRID_OFFSET.y + (point.y + 0.5) * GRID_UNIT_HEIGHT;
    return pos;
  }
  tileFloorFromGridCoords(point: {x: number, y: number}) {
    const pos = new Vec2d();
    pos.x = Grid.GRID_OFFSET.x + point.x * GRID_UNIT_WIDTH;
    pos.y = Grid.GRID_OFFSET.y + point.y * GRID_UNIT_HEIGHT;
    return pos;
  }

  makeObjectBBoxUnwalkable(obj: GameObject) {
    const objBBoxStart = obj.pos.clone().add(obj.bboxStart);
    const objBBoxEnd = obj.pos.clone().add(obj.bboxEnd);
    const objGridStartPos = this.toGridCoords(objBBoxStart);
    const objGridEndPos = this.toGridCoords(objBBoxEnd);

    // set interecting grid tiles unwalkable
    for (
      let pathRow = objGridStartPos.y;
      pathRow <= objGridEndPos.y;
      pathRow++
    ) {
      for (
        let pathCol = objGridStartPos.x;
        pathCol <= objGridEndPos.x;
        pathCol++
      ) {
        this.setGridTile({x: pathCol, y: pathRow}, AI_UNWALKABLE);
      }
    }
  }

  toggleGridTile(pathPoint: {x: number, y: number}) {
    this._setGridTile(pathPoint);
  }

  setGridTile(pathPoint: {x: number, y: number}, setTo: Walkability) {
    this._setGridTile(pathPoint, setTo);
  }

  _isValidGridTile(pathPoint: {x: number, y: number}) {
    const grid = this.tileGrid;

    if (!grid) return false;

    return !(
      pathPoint.y < 0 ||
      pathPoint.y >= grid.length ||
      pathPoint.x < 0 ||
      pathPoint.x >= grid[pathPoint.y].length
    );
  }

  getGridTile(pathPoint: {x: number, y: number}): ?Walkability {
    const grid = this.tileGrid;

    if (!grid) return null;
    if (!this._isValidGridTile(pathPoint)) {
      return null;
    }

    return grid[pathPoint.y][pathPoint.x];
  }

  _setGridTile(pathPoint: {x: number, y: number}, setTo?: ?Walkability) {
    const grid = this.tileGrid;

    if (!grid) return;
    if (!this._isValidGridTile(pathPoint)) {
      return;
    }

    grid[pathPoint.y][pathPoint.x] =
      setTo == null
        ? grid[pathPoint.y][pathPoint.x] === WALKABLE
          ? AI_UNWALKABLE
          : WALKABLE // toggle
        : setTo;
    this.easystar.setGrid(grid);
  }
}

type TentGroup = 'red' | 'green' | 'blue';

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
  cursorPos = new Vec2d();
  inEditorMode = false;

  grid = new Grid();

  worldObjects: Array<GameObject> = [];
  worldObjectsByID: Map<number, GameObject> = new Map();

  view = new View();

  tentAdjacencies: Map<number, Array<number>> = new Map();
  tentGroups: Map<number, ?TentGroup> = new Map();

  constructor() {
    this._spawnObjects();

    this.addWorldObject(this.player);
    this.initTentAdjacencies();

    if (!DEBUG_DISABLE_PEOPLE) {
      this._startSpawningPeople();
    }
  }

  addWorldObject(obj: GameObject) {
    this.worldObjects.push(obj);
    this.worldObjectsByID.set(obj.id, obj);
  }

  removeWorldObject(obj: GameObject) {
    const index = this.worldObjects.indexOf(obj);
    if (index > -1) {
      this.worldObjects.splice(index, 1);
      this.worldObjectsByID.delete(obj.id);
    } else {
      throw new Error(`couldn't find obj id=${obj.id} in worldObjects`);
    }
  }

  spawnObjectOfType(obj: GameObjectInit): GameObject {
    switch (obj.type) {
      case 'Tent':
        return this._spawnGeneric(obj.pos, Tent);
      case 'Bus':
        return this._spawnGeneric(obj.pos, Bus);
      case 'CheeseSandwich':
        return this._spawnGeneric(obj.pos, CheeseSandwich);
      case 'Water':
        return this._spawnGeneric(obj.pos, Water);
      default:
        throw new Error(`unknown object type ${obj.type}`);
    }
  }

  _spawnObjects() {
    objects.forEach(obj => {
      this.spawnObjectOfType(obj);
    });

    typeFilter(this.worldObjects, Tent).forEach(obj => {
      this.grid.makeObjectBBoxUnwalkable(obj);
    });
  }

  _spawnGeneric(pos: Vec2dInit, ObjectClass: Class<GameObject>) {
    const obj = new ObjectClass(pos);
    this.addWorldObject(obj);
    return obj;
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
            default:
              return null;
          }
        })
        .filter(Boolean),
      null,
      2
    );
  }

  initTentAdjacencies() {
    const tents = typeFilter(this.worldObjects, Tent);
    const tentAdjacencies = new Map();
    for (let i = 0; i < tents.length; i++) {
      const center = tents[i].getCenter();
      const adjacencyList = [];
      tentAdjacencies.set(tents[i].id, adjacencyList);

      for (let k = 0; k < tents.length; k++) {
        if (
          i !== k && // ignore self
          tents[k].getCenter().distanceTo(center) <= TENT_ADJACENCY_RADIUS
        ) {
          adjacencyList.push(tents[k].id);
        }
      }
    }

    this.tentAdjacencies = tentAdjacencies;
  }

  isTentCaptured(tent: Tent) {
    return this.tentGroups.get(tent.id) === 'blue';
  }

  _spawnPerson() {
    const pos = Player.START_POS.clone().add({
      x: Math.floor(Math.random() * 300) - 200,
      y: 0,
    });

    this.addWorldObject(new AIFestivalGoer(pos));
  }

  _startSpawningPeople() {
    this._spawnPeopleLoop(76);
  }

  _spawnPeopleLoop = remaining => {
    if (remaining > 0) {
      // spawn up to 3 people
      const spawnUntilRemaining = Math.max(remaining - 3, 0);
      while (remaining > spawnUntilRemaining) {
        this._spawnPerson();
        remaining--;
      }

      setTimeout(() => {
        this._spawnPeopleLoop(remaining);
      }, 5000);
    }
  };

  update() {
    for (let i = 0; i < this.worldObjects.length; i++) {
      this.worldObjects[i].update(this);
    }
    this._detectCollisions();
    this._updateViewOffset();
  }

  _updateViewOffset() {
    const viewWidth = window.innerWidth / SCALE;
    const viewHeight = window.innerHeight / SCALE;

    this.view.update(this.player.pos, viewWidth, viewHeight);
  }

  _detectCollisions() {
    for (let i = this.worldObjects.length - 1; i >= 0; i--) {
      const object = this.worldObjects[i];
      if (!object.enabled) continue;
      for (let k = this.worldObjects.length - 1; k >= 0; k--) {
        const otherObject = this.worldObjects[k];
        if (!otherObject.enabled) continue;
        if (object !== otherObject) {
          if (collision(object, otherObject)) {
            this._handleCollision(object, otherObject);
          }
        }
      }
    }
  }

  _handleCollision(object: GameObject, otherObject: GameObject) {
    // disabled objects can't be collided with
    if (!otherObject.enabled) return;

    // prevent penetration of solid objects
    if (object instanceof Player && otherObject.solid) {
      object.pos.sub(object.lastMove);
    }

    if (object instanceof AIFestivalGoer) {
      if (otherObject instanceof PissArea) {
        object.runFromPiss(this);
      } else if (otherObject instanceof Tent) {
        if (object.target && object.target === otherObject) {
          object.enterTent(otherObject, this);
        } else {
          if (DEBUG_PATH_FOLLOWING_STUCK) {
            object.stuck = true;
          }
        }
      }
    }

    if (object instanceof Tent && otherObject instanceof PissArea) {
      object.intersectingPissArea = otherObject;
    }

    if (object instanceof Player && otherObject instanceof Powerup) {
      otherObject.pickedUp(object);
    }
  }

  checkForTentGroupsAdjacent(start: Tent) {
    this.tentGroups.clear();

    typeFilter(this.worldObjects, Tent).forEach(tent =>
      this._findAndColorTentGroup(tent)
    );
  }

  _findAndColorTentGroup(start: Tent) {
    const {visited, containsOccupant} = this._checkForTentGroup(start);

    visited.forEach(tent => {
      if (tent.isRuinedByPlayer()) {
        this.tentGroups.set(tent.id, 'green');
      } else {
        if (visited.size > MAX_CAPTURABLE_TENT_GROUP) {
        } else {
          if (containsOccupant) {
            this.tentGroups.set(tent.id, 'red');
          } else {
            this.tentGroups.set(tent.id, 'blue');
          }
        }
      }
    });
  }

  _checkForTentGroup(start: Tent) {
    const visited = new Set();
    let containsOccupant = false;

    const visit = (tent: Tent) => {
      if (tent.isRuinedByPlayer()) {
        // always stop here
        return;
      }
      visited.add(tent);
      if (tent.occupied) {
        containsOccupant = true;
      }

      const adjacencies = this.tentAdjacencies.get(tent.id);
      if (!adjacencies) {
        return console.error('missing adjacencies from', tent);
      }

      for (let i = 0; i < adjacencies.length; i++) {
        const adjacentTent = this.worldObjectsByID.get(adjacencies[i]);

        if (adjacentTent instanceof Tent) {
          if (!visited.has(adjacentTent)) {
            visit(adjacentTent);
          }
        } else {
          console.error('invalid adjacent tent', adjacencies[i], adjacentTent);
        }
      }
    };

    visit(start);

    return {visited, containsOccupant};
  }
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

const renderEditorGrid = (
  ctx: CanvasRenderingContext2D,
  view: View,
  game: Game,
  editorModeState: ?EditorModeState
) => {
  const showGrid =
    DEBUG_PATHFINDING_BBOXES ||
    (editorModeState && editorModeState.mode === 'grid');
  if (DEBUG_PATHFINDING_NODES || showGrid) {
    if (!game.grid.tileGrid) return;
    const grid = game.grid.tileGrid;

    const width = GRID_UNIT_WIDTH;
    const height = GRID_UNIT_HEIGHT;
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        const pos = game.grid.tileCenterFromGridCoords({x: col, y: row});
        const {x, y} = pos;

        const color =
          grid[row][col] === WALKABLE
            ? 'green'
            : grid[row][col] === AI_UNWALKABLE
            ? 'red'
            : 'yellow';
        if (DEBUG_PATHFINDING_NODES) {
          renderPoint(ctx, view, pos, color);
        }
        if (showGrid) {
          ctx.strokeStyle = color;

          ctx.strokeRect(
            Math.floor(view.toScreenX(x - width / 2)),
            Math.floor(view.toScreenY(y - height / 2)),
            Math.floor(width),
            Math.floor(height)
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

  if (person.enabled) {
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
  if (DEBUG_AI_STATE) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'black';
    ctx.strokeStyle = 'white';
    const prevLineWidth = ctx.lineWidth;
    ctx.lineWidth = 3;

    ctx.strokeText(
      `${person.state.toString()}`,
      view.toScreenX(person.pos.x + 20),
      view.toScreenY(person.pos.y)
    );
    ctx.fillText(
      `${person.state.toString()}`,
      view.toScreenX(person.pos.x + 20),
      view.toScreenY(person.pos.y)
    );
    ctx.lineWidth = prevLineWidth;
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

const renderBG = (ctx: CanvasRenderingContext2D, view: View) => {
  const image = getImage(assets.bg);
  if (!image) return;

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

  for (let i = 0; i < 4; i++) {
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

const renderDebugCircle = (
  ctx: CanvasRenderingContext2D,
  view: View,
  pos: Vec2d,
  radius: number,
  color: string = 'red'
) => {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(
    Math.floor(view.toScreenX(pos.x)),
    Math.floor(view.toScreenY(pos.y)),
    radius,
    0, // startAngle
    2 * Math.PI // endAngle
  );
  ctx.stroke();
};

const renderObjectImage = (
  ctx: CanvasRenderingContext2D,
  view: View,
  obj: GameObject
) => {
  const image = getImage(obj.sprite);

  if (obj.enabled) {
    if (image) {
      ctx.drawImage(
        image,
        Math.floor(view.toScreenX(obj.pos.x)),
        Math.floor(view.toScreenY(obj.pos.y)),
        Math.floor(image.width),
        Math.floor(image.height)
      );
    }
  }

  if (DEBUG_OBJECTS) {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'black';
    ctx.fillText(
      obj.constructor.name + String(obj.id),
      view.toScreenX(obj.pos.x),
      view.toScreenY(obj.pos.y)
    );
    // renderPoint(ctx, view, obj.getCenter(), 'orange');
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
    Math.floor(view.toScreenX(pos.x)),
    Math.floor(view.toScreenY(pos.y)),
    Math.floor(image.width),
    Math.floor(image.height)
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

const renderTent = (
  ctx: CanvasRenderingContext2D,
  view: View,
  tent: Tent,
  tentGroup: ?string
) => {
  renderObjectImage(ctx, view, tent);

  if (tent.enabled) {
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
      renderImage(
        ctx,
        view,
        tent.pos.clone().add({x: -8, y: 0}),
        assets.pissed
      );
    } else if (tentGroup === 'blue') {
      renderLabel(ctx, view, tent, 'owned', 'blue', -5);
    }
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

  const label =
    game.player.target &&
    (game.player.withinAttackRange(game.player.target) &&
      game.player.energy > 0)
      ? `smash`
      : MOUSE_CONTROL
      ? null
      : `piss on`;
  ctx.font = '10px monospace';
  ctx.fillStyle = 'black';
  if (label) {
    ctx.drawImage(
      image,
      Math.floor(view.toScreenX(targetCenter.x)) - image.width / 2,
      Math.floor(view.toScreenY(targetCenter.y)) - image.height / 2,
      image.width,
      image.height
    );

    ctx.fillText(
      label,
      Math.floor(view.toScreenX(targetCenter.x)) -
        ctx.measureText(label).width / 2,
      Math.floor(view.toScreenY(target.pos.y))
    );
  }
};

function renderFrame(canvas, ctx, game, editorModeState) {
  PERF_FRAMETIME && console.time('render frame');
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderBG(ctx, game.view);

  const zSortedObjects = game.worldObjects.slice().sort((a, b) => {
    // first sort into z layers then by y position
    if (a.zLayer !== b.zLayer) return a.zLayer - b.zLayer;
    return a.getMax().y - b.getMax().y;
  });
  zSortedObjects.forEach((obj, i) => {
    if (!game.view.inView(obj)) {
      return;
    }
    if (obj instanceof Player) {
      renderFestivalGoerImage(ctx, game.view, obj);
    } else if (obj instanceof FestivalGoer) {
      renderFestivalGoerImage(ctx, game.view, obj);
    } else if (obj instanceof Powerup) {
      return;
    } else if (obj instanceof Tent) {
      renderTent(ctx, game.view, obj, game.tentGroups.get(obj.id));
    } else {
      renderObjectImage(ctx, game.view, obj);
    }
  });
  const {target} = game.player;

  if (DARK) {
    // render tint
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#aac2eb';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  // render stuff above tint
  renderEditorGrid(ctx, game.view, game, editorModeState);
  zSortedObjects.forEach((obj, i) => {
    if (obj instanceof Powerup) {
      if (!game.view.inView(obj)) {
        return;
      }
      renderObjectImage(ctx, game.view, obj);
    } else if (obj instanceof FestivalGoer) {
      if (DEBUG_PATH_FOLLOWING_STUCK && obj.stuck) {
        const {path} = obj;
        if (path) {
          let lastPoint = obj.getCenter();
          for (let i = 0; i < path.points.length; i++) {
            const dest = path.points[i];

            renderPoint(ctx, game.view, dest, 'blue');

            renderDebugLine(ctx, game.view, lastPoint, dest);
            lastPoint = path.points[i];
          }
        }
      } else if (DEBUG_PATH_FOLLOWING) {
        const {path} = obj;
        if (path) {
          const dest = path.getNextPoint();
          if (dest) {
            renderPoint(ctx, game.view, dest, 'blue');

            renderDebugLine(ctx, game.view, obj.getCenter(), dest);
          }
        }
      }
    } else if (obj instanceof Tent) {
      if (DEBUG_TENT_GROUPS) {
        const color = game.tentGroups.get(obj.id);
        if (color != null) {
          renderPoint(ctx, game.view, obj.getCenter(), color);
        }
      }

      if (DEBUG_AJACENCY) {
        renderDebugCircle(
          ctx,
          game.view,
          obj.getCenter(),
          TENT_ADJACENCY_RADIUS
        );

        const adjacencies = game.tentAdjacencies.get(obj.id);
        if (adjacencies) {
          for (let i = 0; i < adjacencies.length; i++) {
            const adjacent = game.worldObjectsByID.get(adjacencies[i]);
            if (adjacent) {
              renderDebugLine(
                ctx,
                game.view,
                obj.getCenter(),
                adjacent.getCenter()
              );
            }
          }
        }
      }
    }
    if (DEBUG_BBOX) {
      renderBBox(ctx, game.view, obj);
    }
  });

  // render singleton things
  const playerState = game.player.state;

  if (playerState instanceof FreePissingState) {
    renderPissStream(
      ctx,
      game.view,
      playerState.pissStart,
      playerState.pissArea.pos
    );
  } else if (playerState instanceof TentPissingState) {
    renderPissStream(
      ctx,
      game.view,
      new Vec2d({x: 0, y: -4}).add(game.player.getCenter()),
      playerState.target.getCenter()
    );
  }
  if (target) {
    renderTarget(ctx, game.view, target, game);
  }
  PERF_FRAMETIME && console.timeEnd('render frame');
}

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
      <div>
        <div className="statbarlabel">Tents: </div>
        {
          typeFilter(props.game.worldObjects, Tent).filter(tent =>
            tent.isUsable()
          ).length
        }
      </div>
      <pre>
        {DEBUG_PLAYER_STATE &&
          JSON.stringify(
            {
              player: {
                state: props.game.player.state.toString(),
                pos: props.game.player.pos,
                gridPos: props.game.grid.toGridCoords(props.game.player.pos),
                walkability: props.game.grid.getGridTile(
                  props.game.grid.toGridCoords(props.game.player.getCenter())
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
      <pre>
        {DEBUG_WORLD_STATE &&
          JSON.stringify(
            {
              worldObjects: props.game.worldObjects.length,
            },
            null,
            2
          )}
      </pre>
    </div>
  );
};

class RangeQuery extends GameObject {
  constructor(init: Vec2dInit, area: Vec2dInit) {
    super(init);

    this.bboxStart = new Vec2d({x: 0, y: 0});
    this.bboxEnd = new Vec2d(area).multiplyScalar(2);
  }

  first(objects: Array<GameObject>): ?GameObject {
    return objects.find(obj => collision(obj, this)) || null;
  }

  all(objects: Array<GameObject>): Array<GameObject> {
    return objects.filter(obj => collision(obj, this));
  }
}

type EditorObjectsModeCommand = {
  description: string,
  undo: () => void,
};

type EditorModeState =
  | {|mode: 'grid', paint: Walkability, brushSize: number|}
  | {|
      mode: 'objects',
      submode: 'add' | 'delete',
      type: Class<GameObject>,
      history: Array<EditorObjectsModeCommand>,
    |}
  | {|mode: 'play'|};

class Editor extends React.Component<
  {game: Game},
  {modeState: EditorModeState}
> {
  static cycle<T>(types: Array<T>, prev: T): T {
    return types[(types.indexOf(prev) + 1) % types.length];
  }
  static RIGHT_ALIGN = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
  };
  state = {modeState: {mode: 'play'}};

  _spawnObjectDebounced: (pos: Vec2dInit) => void = throttle(pos => {
    const game = this.props.game;
    const state = this.getModeState();
    if (state.mode !== 'objects') return;

    switch (state.submode) {
      case 'add': {
        const obj = game.spawnObjectOfType({type: state.type.name, pos});

        // center on mouse click
        obj.pos.sub(
          obj
            .getCenter()
            .clone()
            .sub(obj.pos)
        );

        this.updateModeState({
          ...state,
          history: state.history.concat({
            description: `add ${obj.constructor.name} ${obj.id}`,
            undo: () => {
              game.removeWorldObject(obj);
            },
          }),
        });
        return;
      }
      case 'delete': {
        const searchArea = {x: 1, y: 1};
        const obj = new RangeQuery(pos, searchArea).first(game.worldObjects);

        if (obj) {
          game.removeWorldObject(obj);

          this.updateModeState({
            ...state,
            history: state.history.concat({
              description: `delete ${obj.constructor.name} ${obj.id}`,
              undo: () => {
                game.addWorldObject(obj);
              },
            }),
          });
        }

        return;
      }
      default:
        return (state.submode: empty);
    }
  }, 300);

  drawStuff(pos: Vec2d) {
    const game = this.props.game;
    const state = this.getModeState();
    switch (state.mode) {
      case 'grid': {
        const pathPoint = game.grid.toGridCoords(pos);
        if (state.brushSize === 1) {
          game.grid.setGridTile(pathPoint, state.paint);
        } else {
          const halfBrushSize = Math.floor(state.brushSize / 2);

          for (
            let x = pathPoint.x - halfBrushSize;
            x <= pathPoint.x + halfBrushSize;
            x++
          ) {
            for (
              let y = pathPoint.y - halfBrushSize;
              y <= pathPoint.y + halfBrushSize;
              y++
            ) {
              game.grid.setGridTile({x, y}, state.paint);
            }
          }
        }
        break;
      }
      case 'objects': {
        this._spawnObjectDebounced(pos);
        break;
      }
      default:
        return;
    }
  }
  _initMode(name: $PropertyType<EditorModeState, 'mode'>): EditorModeState {
    switch (name) {
      case 'grid':
        return {mode: 'grid', paint: UNWALKABLE, brushSize: 1};
      case 'objects':
        return {mode: 'objects', submode: 'add', type: Tent, history: []};
      case 'play': {
        return {mode: 'play'};
      }
      default:
        return (name: empty);
    }
  }
  getModeState(): EditorModeState {
    return this.state.modeState;
  }
  updateModeState(nextState: EditorModeState) {
    this.setState({modeState: nextState});
  }
  _handleEditorModeChange = () => {
    const state = this.getModeState();
    const prevMode = state.mode;
    const nextMode = Editor.cycle(['play', 'objects', 'grid'], prevMode);
    this.updateModeState(this._initMode(nextMode));
  };
  _handleObjectTypeChange = () => {
    const state = this.getModeState();
    if (state.mode !== 'objects') return;
    this.updateModeState({
      ...state,
      type: Editor.cycle([Tent, CheeseSandwich, Water, Bus], state.type),
    });
  };
  _handlePaintChange = () => {
    const state = this.getModeState();
    if (state.mode !== 'grid') return;
    this.updateModeState({
      ...state,
      paint: Editor.cycle([WALKABLE, AI_UNWALKABLE, UNWALKABLE], state.paint),
    });
  };
  _handleBrushSizeChange = () => {
    const state = this.getModeState();
    if (state.mode !== 'grid') return;
    this.updateModeState({
      ...state,
      brushSize: Editor.cycle([1, 3, 5], state.brushSize),
    });
  };
  _handleObjectSubmodeToggle = () => {
    const state = this.getModeState();
    if (state.mode !== 'objects') return;
    this.updateModeState({
      ...state,
      submode: Editor.cycle(['add', 'delete'], state.submode),
    });
  };
  _handleObjectUndo = () => {
    const state = this.getModeState();
    if (state.mode !== 'objects') return;
    const lastItem = last(state.history);

    if (lastItem) {
      lastItem.undo();
      this.updateModeState({
        ...state,
        history: state.history.filter(item => item !== lastItem),
      });
    }
  };
  _handleInitAdjacency = () => {
    this.props.game.initTentAdjacencies();
  };

  _renderModeMenu(state: EditorModeState) {
    switch (state.mode) {
      case 'grid': {
        return (
          <div style={Editor.RIGHT_ALIGN}>
            <button onClick={this._handlePaintChange}>
              walkability:{' '}
              {state.paint === WALKABLE
                ? 'WALKABLE'
                : state.paint === AI_UNWALKABLE
                ? 'AI_UNWALKABLE'
                : 'UNWALKABLE'}
            </button>
            <button onClick={this._handleBrushSizeChange}>
              brushSize: {state.brushSize}
            </button>
          </div>
        );
      }
      case 'objects': {
        return (
          <div style={Editor.RIGHT_ALIGN}>
            <div>
              <button onClick={this._handleObjectUndo}>
                undo{' '}
                {last(state.history)
                  ? last(state.history).description
                  : '[nothing to undo]'}
              </button>
            </div>
            <div>
              <button onClick={this._handleObjectSubmodeToggle}>
                action: {state.submode}
              </button>
            </div>
            <div
              style={Editor.RIGHT_ALIGN}
              onClick={this._handleObjectTypeChange}
            >
              <div>{state.type.name}</div>
              <div>
                <img alt={state.type.name} src={new state.type().sprite} />
              </div>
            </div>

            {state.type.name === 'Tent' && (
              <div>
                <button onClick={this._handleInitAdjacency}>
                  recalc tent adjacencies
                </button>
              </div>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  }

  render() {
    const state = this.getModeState();
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 300,
          ...Editor.RIGHT_ALIGN,
        }}
      >
        <button onClick={this._handleEditorModeChange}>{state.mode}</button>
        {this._renderModeMenu(state)}
      </div>
    );
  }
}

class App extends Component<{}, void> {
  game: Game = new Game();
  _canvas: ?HTMLCanvasElement = null;
  mouseIsDown = false;
  editor: ?Editor = null;
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
      default:
        break;
    }
  }
  _enqueueFrame() {
    requestAnimationFrame(() => {
      this.game.frame++;
      this._update();
      if (PROD_OPTIMIZE) {
        this._renderCanvas();
      } else {
        this.forceUpdate(); // TODO: remove this when hud doesn't need react
      }
      this._enqueueFrame();
    });
  }
  _update() {
    this.game.inEditorMode =
      this.editor && this.editor.getModeState().mode !== 'play';
    this.game.update();
  }

  _onCanvas = (canvas: ?HTMLCanvasElement) => {
    this._canvas = canvas;
  };
  _renderCanvas() {
    const canvas = this._canvas;
    if (canvas instanceof HTMLCanvasElement) {
      const ctx = canvas.getContext('2d');
      renderFrame(
        canvas,
        ctx,
        this.game,
        this.editor ? this.editor.getModeState() : null
      );
    }
  }

  _drawStuff(pos: Vec2d) {
    if (this.editor) {
      this.editor.drawStuff(pos);
    }
  }

  _handleClick = (event: SyntheticMouseEvent<HTMLCanvasElement>) => {
    this._drawStuff(this.game.cursorPos);
  };

  _handleMouseDown = (event: SyntheticMouseEvent<HTMLCanvasElement>) => {
    this.mouseIsDown = true;
    if (MOUSE_CONTROL) {
      this.game.keys.attack = true;
    }
  };
  _handleMouseUp = (event: SyntheticMouseEvent<HTMLCanvasElement>) => {
    this.mouseIsDown = false;
    if (MOUSE_CONTROL) {
      this.game.keys.attack = false;
    }
  };
  _handleMouseMove = (event: SyntheticMouseEvent<HTMLCanvasElement>) => {
    this.game.cursorPos.x = Math.floor(
      this.game.view.fromScreenX(event.pageX / SCALE)
    );
    this.game.cursorPos.y = Math.floor(
      this.game.view.fromScreenY(event.pageY / SCALE)
    );
    if (this.mouseIsDown) {
      this._drawStuff(this.game.cursorPos);
    }
  };

  _onRef = (ref: ?Editor) => {
    if (ref) {
      this.editor = ref;
    }
  };

  render() {
    return (
      <div className="App">
        <canvas
          ref={this._onCanvas}
          onClick={this._handleClick}
          onMouseDown={this._handleMouseDown}
          onMouseUp={this._handleMouseUp}
          onMouseMove={this._handleMouseMove}
          width={window.innerWidth / SCALE}
          height={window.innerHeight / SCALE}
          style={{transform: `scale(${SCALE})`, transformOrigin: 'top left'}}
          className="sprite"
        />

        {DRAW_HUD && <Hud game={this.game} />}
        {!PROD_OPTIMIZE && <Editor ref={this._onRef} game={this.game} />}
      </div>
    );
  }
}

export default App;
