import { Rect } from '../types';

export const EMPTY = 0;

export const ROOM = 1;

export const HALO = 2;

export const CORRIDOR = 3;

export const PILLAR = 4;

export const DX = [0, 1, 0, -1];

export const DY = [-1, 0, 1, 0];

export type Dir = 0 | 1 | 2 | 3;

export function opposite(dir: Dir): Dir {
  return ((dir + 2) % 4) as Dir;
}

export class Occupancy {
  readonly cols: number;
  readonly rows: number;
  readonly ox: number;
  readonly oy: number;
  readonly grid: Uint8Array;
  readonly corridorLayer: Int8Array;

  constructor(zone: Rect) {
    this.ox = zone.x;
    this.oy = zone.y;
    this.cols = zone.w;
    this.rows = zone.h;
    this.grid = new Uint8Array(zone.w * zone.h);
    this.corridorLayer = new Int8Array(zone.w * zone.h);
    this.corridorLayer.fill(-1);
  }

  in(x: number, y: number): boolean {
    return x >= this.ox && y >= this.oy && x < this.ox + this.cols && y < this.oy + this.rows;
  }

  frame(x: number, y: number): boolean {
    return x === this.ox || y === this.oy || x === this.ox + this.cols - 1 || y === this.oy + this.rows - 1;
  }

  i(x: number, y: number): number {
    return (y - this.oy) * this.cols + (x - this.ox);
  }

  xOf(index: number): number {
    return this.ox + (index % this.cols);
  }

  yOf(index: number): number {
    return this.oy + Math.floor(index / this.cols);
  }
}

export class MinHeap {
  private states: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.states.length;
  }

  push(state: number, prio: number) {
    this.states.push(state);
    this.prios.push(prio);
    let i = this.states.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prios[parent] <= this.prios[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): { state: number; prio: number } | null {
    if (!this.states.length) return null;
    const out = { state: this.states[0], prio: this.prios[0] };
    const lastState = this.states.pop() as number;
    const lastPrio = this.prios.pop() as number;
    if (this.states.length) {
      this.states[0] = lastState;
      this.prios[0] = lastPrio;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < this.states.length && this.prios[left] < this.prios[best]) best = left;
        if (right < this.states.length && this.prios[right] < this.prios[best]) best = right;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return out;
  }

  private swap(a: number, b: number) {
    const state = this.states[a];
    this.states[a] = this.states[b];
    this.states[b] = state;
    const prio = this.prios[a];
    this.prios[a] = this.prios[b];
    this.prios[b] = prio;
  }
}

export const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
