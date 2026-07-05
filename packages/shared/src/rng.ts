/**
 * splitmix32 — tiny, fast, deterministic PRNG whose entire state is one
 * uint32. The state is stored inside GameState so the engine stays a pure
 * function and replays are exact.
 */

export function hashSeed(seed: string): number {
  // FNV-1a over UTF-16 code units, folded to uint32.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One splitmix32 step: returns the next state and a float in [0, 1). */
export function rngNext(state: number): { state: number; value: number } {
  let z = (state + 0x9e3779b9) >>> 0;
  const nextState = z;
  z ^= z >>> 16;
  z = Math.imul(z, 0x21f0aaad);
  z ^= z >>> 15;
  z = Math.imul(z, 0x735a2d97);
  z ^= z >>> 15;
  return { state: nextState, value: (z >>> 0) / 4294967296 };
}

/** Mutable convenience wrapper for code that owns its RNG (generator). */
export class Rng {
  constructor(public state: number) {}

  static fromSeed(seed: string): Rng {
    return new Rng(hashSeed(seed));
  }

  next(): number {
    const { state, value } = rngNext(this.state);
    this.state = state;
    return value;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick on empty array');
    return arr[this.int(arr.length)]!;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Derive an independent sub-stream (for generation retries). */
  fork(label: string): Rng {
    return new Rng((hashSeed(label) ^ Math.imul(this.state, 0x9e3779b9)) >>> 0);
  }
}
