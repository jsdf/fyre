// @flow
import './App.css';
import assets from './assets';
import React, {Component} from 'react';
import Vec2d from './Vec2d';

const TENTS_PER_ROW = 10;
const TENT_GROUND_WIDTH = 96;
const TENT_GROUND_HEIGHT = 64;
const SCALE = 2;

const TENT_START_POS = new Vec2d({x: 20, y: 20});

function toScreenPx(px) {
  return px * SCALE;
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

  constructor(init?: {x: number, y: number}) {
    if (init) {
      this.pos.x = init.x;
      this.pos.y = init.y;
    }
  }

  update(game: Game) {
    // noop
  }
}

class Tent extends GameObject {
  sprite = assets.dstent;
  bboxStart = new Vec2d({x: 3, y: 18});
  bboxEnd = new Vec2d({x: 38, y: 33});
}

class Powerup extends GameObject {
  update(game: Game) {
    this.pos.y += Math.sin(game.frame / 10 + this.id % 10);
  }
}

class Water extends Powerup {
  sprite = assets.water;
  bboxStart = new Vec2d({x: 14, y: 6});
  bboxEnd = new Vec2d({x: 58, y: 57});
}

class CheeseSandwich extends Powerup {
  sprite = assets.cheese;
  bboxStart = new Vec2d({x: 20, y: 22});
  bboxEnd = new Vec2d({x: 43, y: 44});
}

class FestivalGoer extends GameObject {
  pos = new Vec2d({x: 300, y: 200});
  bboxStart = new Vec2d({x: 13, y: 18});
  bboxEnd = new Vec2d({x: 17, y: 23});
  lastMove = new Vec2d();
  isMoving = false;
  static MOVEMENT_SPEED = 2;
  stillSprite = assets.personstill;
  walkAnim = [
    assets.personwalkcycle1,
    assets.personwalkcycle2,
    assets.personwalkcycle3,
  ];
  static FRAMES_PER_ANIM_FRAME = 3;

  update(game: Game) {
    let playerMove = new Vec2d();
    DIRECTIONS.forEach(direction => {
      if (Math.round(Math.random())) {
        playerMove.add(DIRECTIONS_VECTORS[direction]);
      }
    });

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
  pos = new Vec2d({x: 300, y: 200});
  bboxStart = new Vec2d({x: 13, y: 18});
  bboxEnd = new Vec2d({x: 17, y: 23});
  lastMove = new Vec2d();
  isMoving = false;
  static MOVEMENT_SPEED = 2;
  stillSprite = assets.guystill;
  walkAnim = [assets.guywalkcycle1, assets.guywalkcycle2, assets.guywalkcycle3];

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

    this.animUpdate(game);
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
  constructor() {
    this._spawnTents();
    this.worldObjects.push(this.player);
    // this._spawnPeople();
    this._spawnPowerups();
  }

  _spawnTents() {
    for (var i = 0; i < TENTS_PER_ROW * 5; i++) {
      const randomnessInv = 6;
      const tent = new Tent();
      tent.pos.x =
        TENT_START_POS.x +
        (i % TENTS_PER_ROW) * TENT_GROUND_WIDTH +
        Math.floor(Math.random() * TENT_GROUND_WIDTH / randomnessInv);
      tent.pos.y =
        TENT_START_POS.y +
        Math.floor(i / TENTS_PER_ROW) * TENT_GROUND_HEIGHT +
        Math.floor(Math.random() * TENT_GROUND_HEIGHT / randomnessInv);
      this.worldObjects.push(tent);
    }
  }

  _spawnPeople() {
    for (var i = 0; i < 10; i++) {
      this.worldObjects.push(new FestivalGoer());
    }
  }
  _spawnPowerups() {
    for (var i = 0; i < 4; i++) {
      const idx = i * 7; // skip
      const col = idx % TENTS_PER_ROW;
      const row = Math.floor(idx / TENTS_PER_ROW);
      const initPos = {
        x:
          TENT_START_POS.x +
          TENT_GROUND_WIDTH * col /*skip*/ +
          TENT_GROUND_WIDTH / 2 /*offset*/,
        y:
          TENT_START_POS.y +
          TENT_GROUND_HEIGHT * row /*skip*/ +
          TENT_GROUND_HEIGHT / 2 /*offset*/,
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
    if (object instanceof FestivalGoer && otherObject instanceof Tent) {
      object.pos.sub(object.lastMove);
    }
  }
}

const FestivalGoerImage = (props: {person: FestivalGoer}) => {
  // TODO: move this to player class
  const facingRight = props.person.lastMove.x > 0;

  return (
    <img
      src={props.person.sprite}
      className="sprite"
      style={{
        position: 'absolute',
        transform: `translate(${toScreenPx(props.person.pos.x)}px, ${toScreenPx(
          props.person.pos.y
        )}px) scale(${SCALE}) scaleX(${facingRight ? -1 : 1})`,
      }}
    />
  );
};

const Hud = (props: {game: Game}) => (
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
  </div>
);

class App extends Component<{}, void> {
  game = new Game();
  componentDidMount() {
    document.addEventListener('keydown', (event: KeyboardEvent) =>
      this._handleKey(event, true)
    );
    document.addEventListener('keyup', (event: KeyboardEvent) =>
      this._handleKey(event, false)
    );

    this._enqueueFrame();
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
      case 'Space': {
        this.game.keys.attack = pressed;
        break;
      }
    }
  }
  _enqueueFrame() {
    requestAnimationFrame(() => {
      this.game.frame++;
      this._update();
      this.forceUpdate();
      this._enqueueFrame();
    });
  }
  _update() {
    this.game.update();
  }
  render() {
    return (
      <div className="App">
        {this.game.worldObjects.map((obj, i) => {
          if (obj instanceof Player) {
            return <FestivalGoerImage person={obj} key={obj.id} />;
          } else if (obj instanceof FestivalGoer) {
            return <FestivalGoerImage person={obj} key={obj.id} />;
          } else {
            return (
              <img
                src={obj.sprite}
                className="sprite"
                key={obj.id}
                style={{
                  position: 'absolute',
                  transform: `translate(${toScreenPx(
                    obj.pos.x
                  )}px, ${toScreenPx(obj.pos.y)}px) scale(${SCALE})`,
                }}
              />
            );
          }
        })}
        <Hud game={this.game} />
      </div>
    );
  }
}

export default App;
