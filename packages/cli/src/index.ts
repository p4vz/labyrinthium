#!/usr/bin/env node
import { createInterface } from 'node:readline';
import type { PlayerAction, ServerMessage } from '@labyrinthium/shared';
import { GameClient } from './client.js';
import { describeEvent } from './events.js';

interface Args {
  server: string;
  name: string;
  create: boolean;
  join: string | null;
  preset: string;
  complexity: string;
  seed: string | null;
  bot: boolean;
  smoke: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    server: 'ws://localhost:8080/ws',
    name: 'player',
    create: false,
    join: null,
    preset: 'medium',
    complexity: 'classic',
    seed: null,
    bot: false,
    smoke: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--server') args.server = argv[++i]!;
    else if (a === '--name') args.name = argv[++i]!;
    else if (a === '--create') args.create = true;
    else if (a === '--join') args.join = argv[++i]!;
    else if (a === '--preset') args.preset = argv[++i]!;
    else if (a === '--complexity') args.complexity = argv[++i]!;
    else if (a === '--seed') args.seed = argv[++i]!;
    else if (a === '--bot') {
      args.bot = true;
      if (argv[i + 1] === 'random') i++;
    } else if (a === '--smoke') args.smoke = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`labyrinthium cli

  --create                create a room (you become host; 'start' begins the game)
  --join CODE             join an existing room
  --name NAME             your player name
  --server URL            ws server (default ws://localhost:8080/ws)
  --preset P              small | medium | large        (with --create)
  --complexity C          classic | advanced | full     (with --create)
  --seed S                fixed map seed                (with --create)
  --bot [random]          play random legal moves instead of prompting
  --smoke                 spin up two bots in one room and let them play

interactive commands: n e s w u d (move), shoot <n|e|s|w>, grenade <n|e|s|w>,
mine, start, quit`);
}

function randomAction(): PlayerAction {
  const dirs = ['N', 'E', 'S', 'W'] as const;
  const roll = Math.random();
  if (roll < 0.85) return { type: 'move', direction: dirs[Math.floor(Math.random() * 4)]! };
  if (roll < 0.92) return { type: 'shoot', direction: dirs[Math.floor(Math.random() * 4)]! };
  return { type: 'grenade', direction: dirs[Math.floor(Math.random() * 4)]! };
}

async function runBot(
  server: string,
  name: string,
  join: string | null,
  create: { preset: string; complexity: string; seed: string | null } | null,
  onRoom?: (code: string) => void,
): Promise<void> {
  const client = new GameClient(server);
  await client.ready();
  let myId = '';
  let host = false;
  let treasureHere = false;

  client.onMessage = (msg: ServerMessage) => {
    switch (msg.type) {
      case 'session.created':
        myId = msg.playerId;
        console.log(`[${name}] joined room ${msg.roomCode}`);
        onRoom?.(msg.roomCode);
        break;
      case 'room.state':
        host = msg.hostId === myId;
        break;
      case 'game.events':
        for (const e of msg.events) {
          console.log(`[${name}] ${describeEvent(e)}`);
          if (e.payload.type === 'treasureHere') treasureHere = true;
          if (e.payload.type === 'moved' || e.payload.type === 'treasurePickedUp') treasureHere = false;
        }
        break;
      case 'game.turn':
        if (msg.activePlayerId === myId) {
          setTimeout(() => {
            // Turn = optional action + a move. Grab loot when it's underfoot,
            // and once the action is spent, only moves remain.
            const action =
              treasureHere && msg.canAct
                ? ({ type: 'pickup' } as const)
                : msg.canAct
                  ? randomAction()
                  : ({ type: 'move', direction: (['N', 'E', 'S', 'W'] as const)[Math.floor(Math.random() * 4)]! } as const)
            client.send({ type: 'game.action', action });
          }, 10);
        }
        break;
      case 'game.finished':
        console.log(`[${name}] game over — winner: ${msg.winnerName} (turn ${msg.turnNumber})`);
        client.close();
        break;
      case 'error':
        if (msg.code !== 'BORDER_INDESTRUCTIBLE' && msg.code !== 'NO_AMMO' && msg.code !== 'NO_GRENADES') {
          console.log(`[${name}] error: ${msg.code} ${msg.message}`);
        }
        // ignored errors: the bot just tries something else next prompt
        if (msg.code === 'BORDER_INDESTRUCTIBLE' || msg.code === 'NO_AMMO' || msg.code === 'NO_GRENADES') {
          client.send({ type: 'game.action', action: { type: 'move', direction: (['N', 'E', 'S', 'W'] as const)[Math.floor(Math.random() * 4)]! } });
        }
        break;
      default:
        break;
    }
  };

  if (create) {
    client.send({
      type: 'room.create',
      name,
      preset: create.preset as 'small' | 'medium' | 'large',
      complexity: create.complexity as 'classic' | 'advanced' | 'full',
      ...(create.seed ? { seed: create.seed } : {}),
    });
  } else if (join) {
    client.send({ type: 'room.join', roomCode: join, name });
  }

  return new Promise((resolve) => {
    client.onClose = resolve;
    if (create) {
      // Host waits a beat for others, then starts.
      setTimeout(() => {
        if (host) client.send({ type: 'room.start' });
      }, 500);
    }
  });
}

async function runSmoke(args: Args): Promise<void> {
  console.log('smoke: two random bots, one labyrinth. May the least lost win.');
  let roomCode: string | null = null;
  const roomReady = new Promise<string>((resolve) => {
    void runBot(
      args.server,
      'bot-alpha',
      null,
      { preset: args.preset, complexity: args.complexity, seed: args.seed },
      (code) => {
        roomCode = code;
        resolve(code);
      },
    );
  });
  const code = await roomReady;
  await new Promise((r) => setTimeout(r, 100));
  await runBot(args.server, 'bot-beta', code, null);
  console.log(`smoke: done (room ${roomCode})`);
}

async function runInteractive(args: Args): Promise<void> {
  const client = new GameClient(args.server);
  await client.ready();
  let myId = '';

  client.onMessage = (msg: ServerMessage) => {
    switch (msg.type) {
      case 'session.created':
        myId = msg.playerId;
        console.log(`joined room ${msg.roomCode} — session token: ${msg.sessionToken}`);
        break;
      case 'room.state':
        console.log(
          `room ${msg.roomCode} [${msg.phase}] players: ${msg.players
            .map((p) => `${p.name}${p.connected ? '' : ' (away)'}${p.id === msg.hostId ? ' *host' : ''}`)
            .join(', ')}`,
        );
        break;
      case 'room.playerJoined':
        console.log(`${msg.name} joined`);
        break;
      case 'game.started':
        console.log(
          `the game begins! levels: ${msg.levelSizes.map((s) => `${s.width}×${s.height}`).join(', ')} — you start at the entrance (${msg.entrance.x},${msg.entrance.y})`,
        );
        console.log(
          `inventory: ${msg.inventory.grenades} grenade(s), ${msg.inventory.bullets} bullet(s), ${msg.inventory.mines} mine(s)`,
        );
        break;
      case 'game.events':
        for (const e of msg.events) {
          console.log(e.visibility.kind === 'public' ? `  ${describeEvent(e)}` : `> ${describeEvent(e)}`);
        }
        break;
      case 'game.turn':
        console.log(msg.activePlayerId === myId ? `--- turn ${msg.turnNumber}: YOUR MOVE ---` : `(turn ${msg.turnNumber}: waiting…)`);
        break;
      case 'game.finished':
        console.log(`GAME OVER — ${msg.winnerName} wins on turn ${msg.turnNumber}.`);
        process.exit(0);
        break;
      case 'error':
        console.log(`! ${msg.code}: ${msg.message}`);
        break;
      default:
        break;
    }
  };

  if (args.create) {
    client.send({
      type: 'room.create',
      name: args.name,
      preset: args.preset as 'small' | 'medium' | 'large',
      complexity: args.complexity as 'classic' | 'advanced' | 'full',
      ...(args.seed ? { seed: args.seed } : {}),
    });
  } else if (args.join) {
    client.send({ type: 'room.join', roomCode: args.join, name: args.name });
  } else {
    printHelp();
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (line) => {
    const [cmd, arg] = line.trim().toLowerCase().split(/\s+/);
    const dirMap: Record<string, 'N' | 'E' | 'S' | 'W'> = { n: 'N', e: 'E', s: 'S', w: 'W' };
    if (!cmd) return;
    if (cmd === 'quit') process.exit(0);
    else if (cmd === 'start') client.send({ type: 'room.start' });
    else if (cmd in dirMap) client.send({ type: 'game.action', action: { type: 'move', direction: dirMap[cmd]! } });
    else if (cmd === 'u' || cmd === 'd')
      client.send({ type: 'game.action', action: { type: 'move', direction: cmd.toUpperCase() as 'U' | 'D' } });
    else if (cmd === 'shoot' && arg && arg in dirMap)
      client.send({ type: 'game.action', action: { type: 'shoot', direction: dirMap[arg]! } });
    else if (cmd === 'grenade' && arg && arg in dirMap)
      client.send({ type: 'game.action', action: { type: 'grenade', direction: dirMap[arg]! } });
    else if (cmd === 'mine') client.send({ type: 'game.action', action: { type: 'placeMine' } });
    else if (cmd === 'pickup' || cmd === 'take')
      client.send({ type: 'game.action', action: { type: 'pickup' } });
    else if (cmd === 'end' || cmd === 'pass')
      client.send({ type: 'game.action', action: { type: 'endTurn' } });
    else
      console.log(
        'commands: n e s w u d (move, ends turn) | shoot/grenade <dir> | mine | pickup | end | start | quit',
      );
  });
}

const args = parseArgs(process.argv.slice(2));
if (args.smoke) {
  await runSmoke(args);
} else if (args.bot) {
  await runBot(
    args.server,
    args.name,
    args.join,
    args.create ? { preset: args.preset, complexity: args.complexity, seed: args.seed } : null,
  );
} else {
  await runInteractive(args);
}
