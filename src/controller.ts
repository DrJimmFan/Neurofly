export type Sensory = { id: string; values: number[] };
export type Output = {
  scores: number[];
  approach: number;
  grasp: number;
  release: number;
  activity: number[];
};
export interface ControllerAdapter {
  model: string;
  version: string;
  initialize(seed: number): void;
  step(inputs: Sensory[], preferences: number[]): Output;
  reset(): void;
  serialize(): unknown;
  telemetry(): Output;
}
export function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export class FlyController implements ControllerAdapter {
  model = "fly-inspired recurrent controller";
  version = "1.0.0";
  seed = 42;
  weights: number[] = [];
  states: number[][] = [];
  stateById = new Map<string, number[]>();
  out: Output = { scores: [], approach: 0, grasp: 0, release: 0, activity: [] };
  initialize(seed: number) {
    this.seed = seed;
    const rng = random(seed);
    this.weights = Array.from({ length: 80 }, () => (rng() - 0.5) * 0.14);
    this.states = [];
    this.stateById.clear();
  }
  reset() {
    this.initialize(this.seed);
  }
  step(inputs: Sensory[], preferences: number[]) {
    const raw = inputs.map((input, i) => {
      const x = input.values,
        prev = this.stateById.get(input.id) ?? Array(8).fill(0);
      const pref = preferences[Math.round(x[5] * 2)] ?? 0;
      const h = prev.map((_, j) =>
        Math.tanh(
          0.35 * prev[j] +
            0.12 * prev[(j + 7) % 8] +
            x.reduce((sum, n, k) => sum + n * this.weights[j * 10 + k], 0) +
            (j < 4
              ? pref * 1.6 + x[6] * 0.35 - x[3] * 0.25
              : x[7] * 0.6 + x[8] * 0.4),
        ),
      );
      this.states[i] = h;
      this.stateById.set(input.id,h);
      return (
        (h.slice(0, 4).reduce((a, b) => a + b, 0) / 4) * 3 + (x[6] - 0.5) * 0.6
      );
    });
    this.states = inputs.map(input=>this.stateById.get(input.id)!);
    const ex = raw.map((x) => Math.exp(x * 2)),
      total = ex.reduce((a, b) => a + b, 0) || 1;
    const near = Math.max(0, ...inputs.map((i) => i.values[8])),
      contact = Math.max(0, ...inputs.map((i) => i.values[7])),
      tray = Math.max(0, ...inputs.map((i) => i.values[9]));
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    this.out = {
      scores: ex.map((x) => x / total),
      approach: sigmoid(2 + Math.max(0, ...raw)),
      grasp: sigmoid(8 * (near - 0.8) + contact),
      release: sigmoid(10 * (tray - 0.7)),
      activity: this.states.flat(),
    };
    return this.out;
  }
  serialize() {
    return { seed: this.seed, states: this.states, stateById:Array.from(this.stateById.entries()), weights: this.weights };
  }
  telemetry() {
    return this.out;
  }
}
export class Baseline extends FlyController {
  model = "nearest-object baseline";
  version = "1.0.0";
  step(inputs: Sensory[], preferences: number[]) {
    const out = super.step(inputs, preferences);
    const d = inputs.map((x) => x.values[3]),
      index = d.indexOf(Math.min(...d));
    this.out = {
      ...out,
      scores: d.map((_, i) => (i === index ? 1 : 0)),
      activity: [],
    };
    return this.out;
  }
}
export function decode(out: Output, ids: string[], current: string | null) {
  const index = out.scores.indexOf(Math.max(...out.scores));
  if (index < 0) return null;
  const currentIndex = ids.indexOf(current ?? "");
  if (currentIndex >= 0 && out.scores[index] < out.scores[currentIndex] + 0.08)
    return current;
  return out.scores[index] >= Math.min(0.34, 1 / ids.length)
    ? ids[index]
    : current;
}
