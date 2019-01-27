// @flow
import './App.css';
import assets from './assets';
import React, {Component} from 'react';
import Vec2d from './Vec2d';

const ITEMS_PER_ROW = 4;
const TENT_WIDTH = 64;
const TENT_HEIGHT = 64;
const SCALE = 2;

function toScreenPx(px) {
  return px * SCALE;
}

type Direction = 'up' | 'down' | 'left' | 'right';
type Keys = {['up' | 'down' | 'left' | 'right']: boolean};

function makeKeys() {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
  };
}

const DIRECTIONS_VECTORS = {
  up: new Vec2d({x: 0, y: -1}),
  down: new Vec2d({x: 0, y: 1}),
  left: new Vec2d({x: -1, y: 0}),
  right: new Vec2d({x: 1, y: 0}),
};

class GameObject {
  static maxId = 0;
  id = GameObject.maxId++;
  pos = new Vec2d();
  sprite = '';

  update(game: GameState) {
    // noop
  }
}

class Tent extends GameObject {
  sprite = assets.dstent;
}

class Player extends GameObject {
  lastMove = new Vec2d();
  isMoving = false;
  static MOVEMENT_SPEED = 2;
  static GUY_ANIM = [
    assets.guywalkcycle1,
    assets.guywalkcycle2,
    assets.guywalkcycle3,
  ];
  static FRAMES_PER_ANIM_FRAME = 3;

  update(game: GameState) {
    const playerMove = new Vec2d();
    ['up', 'down', 'left', 'right'].forEach(direction => {
      if (game.keys[direction]) {
        playerMove.add(DIRECTIONS_VECTORS[direction]);
      }
    });

    if (playerMove.x !== 0 || playerMove.y !== 0) {
      moveThing(this.pos, playerMove, Player.MOVEMENT_SPEED);
      this.lastMove = playerMove;
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }

    if (this.isMoving) {
      this.sprite =
        Player.GUY_ANIM[
          Math.floor(
            Math.floor(game.frame / Player.FRAMES_PER_ANIM_FRAME) %
              Player.GUY_ANIM.length
          )
        ];
    } else {
      this.sprite = assets.guystill;
    }
  }
}

const STATIC_OBJECTS = new Array(20).fill(0).map((_, i) => {
  const tent = new Tent();
  tent.pos.x = (i % ITEMS_PER_ROW) * TENT_WIDTH;
  tent.pos.y = Math.floor(i / ITEMS_PER_ROW) * TENT_HEIGHT;

  return tent;
});

function moveThing(pos: Vec2d, movement: Vec2d, magnitude: number) {
  const direction = movement.clone().normalise();
  const velocity = direction.multiplyScalar(magnitude);
  pos.add(velocity);
}

const Guy = (props: {player: Player, frame: number}) => {
  // TODO: move this to player class
  const facingRight = props.player.lastMove.x > 0;

  return (
    <img
      src={props.player.sprite}
      className="sprite"
      style={{
        position: 'absolute',
        transform: `translate(${toScreenPx(props.player.pos.x)}px, ${toScreenPx(
          props.player.pos.y
        )}px) scale(${SCALE}) scaleX(${facingRight ? -1 : 1})`,
      }}
    />
  );
};

type GameState = {frame: number, player: Player, keys: Keys};

class App extends Component<{}, void> {
  game: GameState = {
    frame: 0,
    player: new Player(),
    keys: makeKeys(),
  };
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
    this.game.player.update(this.game);
  }
  render() {
    return (
      <div className="App">
        {STATIC_OBJECTS.map(obj => (
          <img
            src={obj.sprite}
            className="sprite"
            key={obj.id}
            style={{
              position: 'absolute',
              transform: `translate(${toScreenPx(obj.pos.x)}px, ${toScreenPx(
                obj.pos.y
              )}px) scale(${SCALE})`,
            }}
          />
        ))}
        <Guy frame={this.game.frame} player={this.game.player} />
      </div>
    );
  }
}

export default App;
