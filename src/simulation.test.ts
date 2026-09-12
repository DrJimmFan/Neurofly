import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import { Simulation, DEFAULT } from "./simulation";
import { ik, fk, distance, HOME, motorStep, LIMITS, ACCEL } from "./robotics";
import { FlyController } from "./controller";
import { FixedClock } from "./clock";
import {
  validate,
  save,
  load,
  remove,
  frameIndex,
  type Recording,
} from "./persistence";
describe("robotics", () => {
  it("pauses and bounds hidden-tab jumps, while speed changes only step count", () => {
    const clock = new FixedClock();
    let steps = 0;
    expect(clock.advance(10, 1, false, () => steps++)).toBe(0);
    expect(clock.advance(10, 1, true, () => steps++)).toBe(3);
    clock.reset();
    expect(clock.advance(1 / 60, 4, true, () => steps++)).toBe(4);
    expect(steps).toBe(7);
  });
  it("inverse kinematics roundtrips reachable poses", () => {
    for (const p of [
      [0.73, 0.07, 0.04],
      [0.28, 0.48, 0.86],
      [0.5, 0.25, -0.4],
    ] as [number, number, number][]) {
      const q = ik(p)!;
      expect(q).not.toBeNull();
      expect(distance(fk(q)[3], p)).toBeLessThan(1e-6);
      expect(q.every((n, i) => n >= LIMITS[i][0] && n <= LIMITS[i][1])).toBe(
        true,
      );
    }
  });
  it("rejects unreachable and below-table targets", () => {
    expect(ik([3, 0.2, 0])).toBeNull();
    expect(ik([0.5, -0.2, 0])).toBeNull();
  });
  it("bounds motor speed and acceleration", () => {
    let q = [...HOME];
    const vel = Array(6).fill(0),
      goal = ik([0.7, 0.15, 0.3])!;
    for (let i = 0; i < 600; i++) {
      const old = [...vel];
      q = motorStep(q, vel, goal, 1 / 60);
      expect(
        vel.every((x, j) => Math.abs(x - old[j]) <= ACCEL / 60 + 1e-9),
      ).toBe(true);
      expect(vel.every((x) => Math.abs(x) <= 1.15 + 1e-9)).toBe(true);
    }
  });
});
describe("closed loop physics", () => {
  it("valid contact, lift, transport and release", async () => {
    const sim = await new Simulation().init();
    let last = sim.objects()[0].position;
    let graspFrame = null;
    for (let i = 0; i < 6000 && !sim.done; i++) {
      sim.step();
      const obj = sim.objects()[0];
      expect(distance(obj.position, last)).toBeLessThan(0.08);
      last = obj.position;
      if (sim.held && !graspFrame) graspFrame = sim.snapshot();
    }
    expect(graspFrame?.contact).toEqual([true, true]);
    expect(sim.done).toBe(true);
    expect(sim.events.some((e) => e.text.includes("Two-sided contact"))).toBe(
      true,
    );
    expect(sim.events.some((e) => e.text.includes("constraint removed"))).toBe(
      true,
    );
    expect(sim.reason).toContain("inside the tray");
    const recording: Recording = {
      schema: "nvfly/1",
      name: "First flight — seed 42",
      created: "2026-09-12T06:30:00Z",
      model: sim.controller.model,
      version: sim.controller.version,
      config: sim.config,
      frames: [...sim.frames, sim.snapshot()],
    };
    fs.mkdirSync("examples", { recursive: true });
    fs.writeFileSync(
      "examples/pick-and-place.nvfly.json",
      JSON.stringify(recording),
    );
    sim.dispose();
  });
  it("barrier causes safety recovery", async () => {
    const sim = await new Simulation({
      ...DEFAULT,
      preset: "Obstruction",
    }).init();
    for (let i = 0; i < 2000 && !sim.done; i++) sim.step();
    expect(sim.events.some((e) => e.source === "safety")).toBe(true);
    expect(sim.events.some((e) => e.text.includes("excluded"))).toBe(true);
    expect(sim.done).toBe(true);
    expect(sim.target).not.toBe("banana-1");
    expect(sim.reason).toContain("inside the tray");
    fs.mkdirSync("examples", { recursive: true });
    fs.writeFileSync(
      "examples/obstruction.nvfly.json",
      JSON.stringify({
        schema: "nvfly/1",
        name: "Barrier recovery",
        created: "2026-09-12T06:30:00Z",
        model: sim.controller.model,
        version: sim.controller.version,
        config: sim.config,
        frames: [...sim.frames, sim.snapshot()],
      }),
    );
    sim.dispose();
  });
  it("unreachable selection recovers without moving outside limits", async () => {
    const config = structuredClone(DEFAULT);
    config.objects[0].position = [1.7, 0.065, 0];
    config.preferences = [1, -1, -1];
    const sim = await new Simulation(config).init();
    for (let i = 0; i < 300; i++) sim.step();
    expect(
      sim.events.some((e) => e.text.includes("outside joint-limited")),
    ).toBe(true);
    expect(sim.q.every((n, i) => n >= LIMITS[i][0] && n <= LIMITS[i][1])).toBe(
      true,
    );
    sim.dispose();
  });
  it("target choice and preference test use their selected output", async () => {
    for (const preset of [
      "Target choice",
      "Preference test",
      "Baseline comparison",
    ]) {
      const sim = await new Simulation({
        ...DEFAULT,
        preset,
        preferences: [-1, 1, -1],
      }).init();
      for (let i = 0; i < 1200 && !sim.done; i++) sim.step();
      expect(sim.target).toBe("cube-2");
      expect(sim.done).toBe(true);
      expect(sim.held).toBeNull();
      sim.dispose();
    }
  });
  it("baseline is an explicitly different decision rule", async () => {
    const sim = await new Simulation({
      ...DEFAULT,
      preset: "Baseline comparison",
      baseline: true,
    }).init();
    for (let i = 0; i < 1200 && !sim.done; i++) sim.step();
    expect(sim.target).toBe("cube-2");
    expect(sim.controller.model).toBe("nearest-object baseline");
    expect(sim.output.activity).toEqual([]);
    sim.dispose();
  });
  it("moving target changes position and is followed", async () => {
    const sim = await new Simulation({
      ...DEFAULT,
      preset: "Moving target",
    }).init();
    for (let i = 0; i < 600; i++) sim.step();
    const obj = sim.objects().find((o) => o.id === sim.target)!;
    expect(distance(obj.position, DEFAULT.objects[0].position)).toBeGreaterThan(
      0.03,
    );
    expect(
      distance(fk(sim.q)[3], [obj.position[0], 0.23, obj.position[2]]),
    ).toBeLessThan(0.1);
    sim.dispose();
  });
  it("reset and mode changes clear motion safely", async () => {
    const sim = await new Simulation().init();
    for (let i = 0; i < 100; i++) sim.step();
    sim.setMode("manual");
    expect(sim.goal).toEqual(sim.q);
    sim.reset();
    expect(sim.time).toBe(0);
    expect(sim.target).toBeNull();
    sim.dispose();
  });
});
describe("persistence and replay", () => {
  it("roundtrips recordings and rejects malformed imports", async () => {
    const sim = await new Simulation().init();
    for (let i = 0; i < 20; i++) sim.step();
    const r: Recording = {
      schema: "nvfly/1",
      name: "roundtrip",
      created: new Date().toISOString(),
      model: sim.controller.model,
      version: "1.0.0",
      config: sim.config,
      frames: sim.frames,
    };
    expect(validate(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(() => validate({ ...r, schema: "nvfly/2" })).toThrow();
    const invalid = structuredClone(r);
    invalid.frames[0].q[0] = Infinity;
    expect(() => validate(invalid)).toThrow();
    const inputs = structuredClone(r);
    inputs.frames[0].inputs[0].values = [];
    expect(() => validate(inputs)).toThrow();
    expect(frameIndex(r.frames, r.frames.at(-1)!.time)).toBe(
      r.frames.length - 1,
    );
    sim.dispose();
  });
  it("persists across storage reloads and supports removal", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    });
    const sim = await new Simulation().init();
    const r: Recording = {
      schema: "nvfly/1",
      name: "stored",
      created: new Date().toISOString(),
      model: sim.controller.model,
      version: "1.0.0",
      config: sim.config,
      frames: sim.frames,
    };
    save(r);
    expect(load()[0]).toEqual(r);
    remove(0);
    expect(load()).toEqual([]);
    vi.unstubAllGlobals();
    sim.dispose();
  });
});
describe("neural causality", () => {
  it("has reproducible state and preference-dependent choice", () => {
    const a = new FlyController(),
      b = new FlyController();
    a.initialize(42);
    b.initialize(42);
    const inputs = [0, 0.5, 1].map((kind, i) => ({
      id: String(i),
      values: [0.4, 0.04, 0.1, 0.5, 0.4, kind, 1, 0, 0, 0],
    }));
    for (let k = 0; k < 20; k++)
      expect(a.step(inputs, [0.25, 0.05, 0.15])).toEqual(
        b.step(inputs, [0.25, 0.05, 0.15]),
      );
    const x = a.step(inputs, [-1, 1, -1]);
    for (let k = 0; k < 30; k++) a.step(inputs, [-1, 1, -1]);
    expect(
      a.telemetry().scores.indexOf(Math.max(...a.telemetry().scores)),
    ).toBe(1);
    expect(x.activity).not.toEqual(b.telemetry().activity);
  });
});
