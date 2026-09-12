import RAPIER from "@dimforge/rapier3d-compat";
import {
  FlyController,
  Baseline,
  decode,
  type Sensory,
  type Output,
} from "./controller";
import {
  fk,
  ik,
  HOME,
  motorStep,
  collision,
  distance,
  arr,
  v,
  linkRotation,
  toolRotation,
  type V3,
} from "./robotics";
export const DT = 1 / 60;
export const PRESETS = [
  "Pick and place",
  "Target choice",
  "Moving target",
  "Obstruction",
  "Preference test",
  "Baseline comparison",
] as const;
export type Kind = "banana" | "cube" | "ball";
export type Obj = {
  id: string;
  kind: Kind;
  position: V3;
  size: number;
  rotation: { x: number; y: number; z: number; w: number };
};
export type Config = {
  seed: number;
  preferences: number[];
  preset: string;
  baseline: boolean;
  objects: Obj[];
};
export type Frame = {
  time: number;
  q: number[];
  velocity: number[];
  goal: number[];
  gap: number;
  objects: Obj[];
  target: string | null;
  stage: string;
  reason: string;
  inputs: Sensory[];
  output: Output;
  contact: boolean[];
  held: string | null;
  barrier: boolean;
  blocked: boolean;
  controllerState: unknown;
  mode: string;
  events: Event[];
};
export type Event = {
  time: number;
  text: string;
  source: "neural" | "safety" | "execution" | "user";
};
export const identity = { x: 0, y: 0, z: 0, w: 1 };
export const DEFAULT: Config = {
  seed: 42,
  preferences: [0.25, 0.05, 0.15],
  preset: "Pick and place",
  baseline: false,
  objects: [
    {
      id: "banana-1",
      kind: "banana",
      position: [0.73, 0.065, 0.04],
      size: 0.065,
      rotation: identity,
    },
    {
      id: "cube-2",
      kind: "cube",
      position: [0.49, 0.065, -0.4],
      size: 0.065,
      rotation: identity,
    },
    {
      id: "ball-3",
      kind: "ball",
      position: [0.99, 0.065, -0.35],
      size: 0.065,
      rotation: identity,
    },
  ],
};
export const TRAY: V3 = [0.28, 0.08, 0.86];
export class Simulation {
  world!: RAPIER.World;
  bodies = new Map<string, RAPIER.RigidBody>();
  colliders = new Map<string, RAPIER.Collider>();
  links: RAPIER.RigidBody[] = [];
  fingers: RAPIER.RigidBody[] = [];
  fingerColliders: RAPIER.Collider[] = [];
  palm!: RAPIER.RigidBody;
  barrierBody!: RAPIER.RigidBody;
  joint: RAPIER.ImpulseJoint | null = null;
  controller = new FlyController();
  config: Config;
  q = [...HOME];
  goal = [...HOME];
  velocity = Array(6).fill(0);
  gap = 0.22;
  gapGoal = 0.22;
  time = 0;
  stage = "Observe";
  stageTime = 0;
  target: string | null = null;
  held: string | null = null;
  reason = "Ready. Run your first experiment.";
  mode = "neural";
  barrier = false;
  contacts = [false, false];
  inputs: Sensory[] = [];
  output: Output = {
    scores: [],
    approach: 0,
    grasp: 0,
    release: 0,
    activity: [],
  };
  events: Event[] = [];
  frames: Frame[] = [];
  done = false;
  blocked = false;
  blockedGoal: number[] | null = null;
  manualGoal: V3 = [0.7, 0.3, 0];
  initialObjects: Obj[];
  excluded = new Set<string>();
  recovery = false;
  constructor(config: Config = DEFAULT) {
    this.config = structuredClone(config);
    this.initialObjects = structuredClone(config.objects);
  }
  async init() {
    await RAPIER.init();
    this.reset();
    return this;
  }
  reset(config = this.config) {
    this.config = structuredClone(config);
    this.initialObjects = structuredClone(config.objects);
    if (this.world) this.world.free();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    this.world.numSolverIterations = 12;
    this.bodies.clear();
    this.colliders.clear();
    this.links = [];
    this.fingers = [];
    this.fingerColliders = [];
    this.joint = null;
    this.q = [...HOME];
    this.goal = [...HOME];
    this.velocity = Array(6).fill(0);
    this.time = 0;
    this.stage = "Observe";
    this.stageTime = 0;
    this.target = null;
    this.held = null;
    this.gap = 0.22;
    this.gapGoal = 0.22;
    this.done = false;
    this.blocked = false;
    this.events = [];
    this.frames = [];
    this.excluded.clear();
    this.recovery = false;
    this.contacts = [false, false];
    this.mode = "neural";
    this.reason = "Ready. Run your first experiment.";
    this.controller = config.baseline ? new Baseline() : new FlyController();
    this.controller.initialize(config.seed);
    const table = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0.25, -0.065, 0),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.55, 0.065, 1.15).setFriction(0.8),
      table,
    );
    for (const obj of config.objects) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(...obj.position)
          .setRotation(obj.rotation)
          .setLinearDamping(1.4)
          .setAngularDamping(2)
          .setCcdEnabled(true),
      );
      const shape =
        obj.kind === "cube"
          ? RAPIER.ColliderDesc.cuboid(obj.size, obj.size, obj.size)
          : RAPIER.ColliderDesc.ball(obj.size);
      const co = this.world.createCollider(
        shape.setMass(0.09).setFriction(0.85).setRestitution(0.05),
        body,
      );
      this.bodies.set(obj.id, body);
      this.colliders.set(obj.id, co);
    }
    for (let i = 0; i < 3; i++) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased(),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.capsule(
          [0.315, 0.265, 0.065][i],
          [0.045, 0.045, 0.025][i],
        ),
        body,
      );
      this.links.push(body);
    }
    this.palm = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    for (let i = 0; i < 2; i++) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased(),
      );
      this.fingerColliders.push(
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.026, 0.052, 0.012).setFriction(1),
          body,
        ),
      );
      this.fingers.push(body);
    }
    this.barrierBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0.58, 0.215, 0.05),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.075, 0.215, 0.22),
      this.barrierBody,
    );
    this.barrier = false;
    this.barrierBody.setEnabled(false);
    this.syncBodies(true);
    this.encode();
    this.output = this.controller.step(this.inputs, config.preferences);
    this.frames.push(this.snapshot());
  }
  objects(): Obj[] {
    return this.initialObjects.map((o) => {
      const b = this.bodies.get(o.id)!;
      const p = b.translation();
      return { ...o, position: [p.x, p.y, p.z], rotation: { ...b.rotation() } };
    });
  }
  log(text: string, source: Event["source"]) {
    if (this.events.at(-1)?.text === text) return;
    this.events.push({ time: this.time, text, source });
    if (this.events.length > 300) this.events.shift();
    this.reason = text;
  }
  transition(
    stage: string,
    text: string,
    source: Event["source"] = "execution",
  ) {
    this.stage = stage;
    this.stageTime = this.time;
    this.log(text, source);
  }
  encode() {
    const ee = fk(this.q)[3];
    this.inputs = this.objects()
      .filter((o) => !this.excluded.has(o.id))
      .map((o) => ({
        id: o.id,
        values: [
          o.position[0] / 1.5,
          o.position[1] / 1.5,
          o.position[2] / 1.5,
          Math.min(1, Math.hypot(...o.position) / 1.5),
          o.size / 0.15,
          ["banana", "cube", "ball"].indexOf(o.kind) / 2,
          this.barrier &&
          o.position[0] > 0.63 &&
          Math.abs(o.position[2] - 0.05) < 0.22
            ? 0
            : 1,
          this.target === o.id && this.contacts.some(Boolean) ? 1 : 0,
          Math.max(0, 1 - distance(ee, o.position) / 0.5),
          distance(o.position, TRAY) < 0.16 ? 1 : 0,
        ],
      }));
  }
  setMode(mode: string) {
    this.mode = mode;
    this.goal = [...this.q];
    this.velocity.fill(0);
    this.blocked = false;
    this.done = false;
    this.stage = "Observe";
    this.target = null;
    this.gapGoal = 0.22;
    this.detach();
    this.log(
      `${mode === "manual" ? "Manual" : "Neural"} mode enabled; trajectory cleared.`,
      "user",
    );
  }
  detach() {
    if (this.joint) {
      this.world.removeImpulseJoint(this.joint, true);
      this.joint = null;
    }
    this.held = null;
  }
  setBarrier(enabled: boolean) {
    this.barrier = enabled;
    this.barrierBody.setEnabled(enabled);
    this.log(
      enabled
        ? "Barrier introduced. Safety checks active."
        : "Barrier removed.",
      "user",
    );
    if (this.blocked) {
      this.blocked = false;
      if (this.held) {
        this.goal = this.blockedGoal ?? this.goal;
        this.blockedGoal = null;
        this.log("Obstacle changed; resuming the checked transport.", "safety");
        return;
      }
      this.excluded.clear();
      this.transition("Observe", "Rechecking available targets.", "safety");
    }
  }
  reach(position: V3) {
    const solved = ik(position, this.q);
    if (!solved) {
      this.blocked = true;
      this.log(
        "Target is outside joint-limited workspace. Reposition it or reset.",
        "safety",
      );
      return false;
    }
    // Sample the complete joint-space segment before allowing any motor motion.
    for (let i = 1; i <= 24; i++) {
      const q = this.q.map((n, j) => n + ((solved[j] - n) * i) / 24);
      const issue = collision(
        q,
        this.objects().filter((o) => o.id !== this.held),
        this.target,
        this.barrier,
      );
      if (issue) {
        this.blocked = true;
        this.log(issue, "safety");
        return false;
      }
    }
    this.goal = solved;
    return true;
  }
  setManualTarget(p: V3) {
    this.manualGoal = p;
    this.blocked = false;
    this.reach(p);
  }
  setJoint(index: number, value: number) {
    this.blocked = false;
    const q = [...this.goal];
    q[index] = value;
    const issue = collision(q, this.objects(), null, this.barrier);
    if (issue) {
      this.log(issue, "safety");
      return;
    }
    this.goal = q;
  }
  arrived() {
    return (
      this.q.every((n, i) => Math.abs(n - this.goal[i]) < 0.012) &&
      this.velocity.every((n) => Math.abs(n) < 0.08)
    );
  }
  handleBlocked() {
    this.goal = [...this.q];
    this.velocity.fill(0);
    if (this.held) {
      this.log(
        "Paused with grasp retained. Remove the obstacle to continue.",
        "safety",
      );
      return;
    }
    if (this.target) this.excluded.add(this.target);
    this.target = null;
    this.blocked = false;
    if (this.inputs.length <= 1) {
      this.blocked = true;
      this.log(
        "No safe target remains. Reposition objects or remove the barrier.",
        "safety",
      );
    } else
      this.transition(
        "Observe",
        "Obstructed target excluded; neural controller will choose again.",
        "safety",
      );
  }
  execute() {
    const elapsed = this.time - this.stageTime,
      obj = this.objects().find((o) => o.id === this.target),
      ee = fk(this.q)[3];
    if (this.blocked) {
      if (this.mode === "neural" && elapsed > 1) this.handleBlocked();
      return;
    }
    if (this.stage === "Observe" && elapsed > 0.3) {
      const target = decode(
        this.output,
        this.inputs.map((i) => i.id),
        this.target,
      );
      if (target) {
        this.target = target;
        this.transition(
          "Select",
          `${this.config.baseline ? "Baseline" : "Neural outputs"} selected ${target}.`,
          "neural",
        );
      }
    } else if (this.stage === "Select" && obj && this.output.approach > 0.55) {
      if (this.reach([obj.position[0], 0.4, obj.position[2]]))
        this.transition(
          "Approach",
          "Approach tendency passed 0.55; executing a checked clearance path.",
          "neural",
        );
    } else if (this.stage === "Approach" && this.arrived() && obj) {
      if (
        ["Target choice", "Preference test", "Baseline comparison"].includes(
          this.config.preset,
        )
      ) {
        this.done = true;
        this.transition(
          "Complete",
          "Chosen target reached; choice experiment complete.",
        );
      } else if (
        this.reach([
          obj.position[0],
          Math.max(0.065, obj.position[1] + 0.006),
          obj.position[2],
        ])
      )
        this.transition("Align", "Aligning the gripper with the target.");
    } else if (
      this.stage === "Align" &&
      this.config.preset === "Moving target" &&
      obj
    ) {
      this.reach([obj.position[0], 0.23, obj.position[2]]);
      this.reason = "Tracking the moving target through sensory feedback.";
    } else if (
      this.stage === "Align" &&
      this.arrived() &&
      obj &&
      this.output.grasp > 0.65
    ) {
      this.gapGoal = Math.max(0.03, obj.size * 2 - 0.008);
      this.transition(
        "Close gripper",
        "Neural grasp intention passed 0.65. Waiting for two-sided contact.",
        "neural",
      );
    } else if (this.stage === "Close gripper" && obj) {
      if (
        this.contacts.every(Boolean) &&
        this.gap <= obj.size * 2 + 0.004 &&
        distance(ee, obj.position) < 0.1
      ) {
        const body = this.bodies.get(obj.id)!;
        const p = body.translation(),
          a = this.palm.translation();
        this.joint = this.world.createImpulseJoint(
          RAPIER.JointData.fixed(
            { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z },
            identity,
            { x: 0, y: 0, z: 0 },
            body.rotation(),
          ),
          this.palm,
          body,
          true,
        );
        this.joint.setContactsEnabled(false);
        this.held = obj.id;
        if (this.reach([ee[0], 0.48, ee[2]]))
          this.transition(
            "Lift",
            "Two-sided contact and closed fingers confirmed; fixed physics grasp attached.",
          );
      } else if (elapsed > 3) {
        this.gapGoal = 0.22;
        this.blocked = true;
        this.log("Grasp failed: no valid two-sided contact.", "safety");
      }
    } else if (this.stage === "Lift" && this.arrived()) {
      if (this.reach([TRAY[0], 0.48, TRAY[2]]))
        this.transition(
          "Transport",
          "Transporting the constrained object to the tray.",
        );
    } else if (this.stage === "Transport" && this.arrived()) {
      if (
        this.reach([
          TRAY[0],
          Math.max(0.085, (obj?.size ?? 0.065) + 0.015),
          TRAY[2],
        ])
      )
        this.transition("Lower", "Lowering into the destination tray.");
    } else if (
      this.stage === "Lower" &&
      this.arrived() &&
      this.output.release > 0.65
    ) {
      this.gapGoal = 0.22;
      this.detach();
      this.transition(
        "Release",
        "Neural release intention passed 0.65; grasp constraint removed.",
        "neural",
      );
    } else if (this.stage === "Release" && elapsed > 0.65) {
      if (this.reach([TRAY[0], 0.45, TRAY[2]]))
        this.transition("Return", "Object released; clearing the tray.");
    } else if (this.stage === "Return" && this.arrived()) {
      this.done = true;
      const placed = obj && distance(obj.position, TRAY) < 0.18;
      this.transition(
        "Complete",
        placed
          ? "Object settled inside the tray. Experiment complete."
          : "Run finished; object landed outside the tray.",
      );
    }
  }
  syncBodies(initial = false) {
    const points = fk(this.q);
    for (let i = 0; i < 3; i++) {
      const p = arr(
        v(points[i])
          .add(v(points[i + 1]))
          .multiplyScalar(0.5),
      );
      const rot = linkRotation(points[i], points[i + 1]);
      if (initial) {
        this.links[i].setTranslation(v(p), true);
        this.links[i].setRotation(rot, true);
      } else {
        this.links[i].setNextKinematicTranslation(v(p));
        this.links[i].setNextKinematicRotation(rot);
      }
    }
    const p = v(points[3]);
    if (initial) this.palm.setTranslation(p, true);
    else this.palm.setNextKinematicTranslation(p);
    const rot = toolRotation(this.q);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const pos = p
        .clone()
        .add(v([0, 0, side * (this.gap / 2 + 0.012)]).applyQuaternion(rot));
      if (initial) {
        this.fingers[i].setTranslation(pos, true);
        this.fingers[i].setRotation(rot, true);
      } else {
        this.fingers[i].setNextKinematicTranslation(pos);
        this.fingers[i].setNextKinematicRotation(rot);
      }
    }
  }
  step() {
    if (this.done) return;
    this.time += DT;
    if (
      this.config.preset === "Obstruction" &&
      this.time >= 1 &&
      this.time < 1 + DT
    )
      this.setBarrier(true);
    if (this.config.preset === "Moving target" && this.time > 1) {
      const body = this.bodies.get(this.target ?? "banana-1");
      if (body && !this.held) {
        body.setLinvel(
          {
            x: 0.035 * Math.cos(this.time * 0.3),
            y: body.linvel().y,
            z: 0.025 * Math.sin(this.time * 0.3),
          },
          true,
        );
      }
    }
    if (Math.round(this.time / DT) % 6 === 0) {
      this.encode();
      this.output = this.controller.step(this.inputs, this.config.preferences);
    }
    if (this.mode === "neural") this.execute();
    if (!this.blocked) {
      const next = motorStep(this.q, [...this.velocity], this.goal, DT);
      const issue = collision(
        next,
        this.objects().filter((o) => o.id !== this.held),
        this.target,
        this.barrier,
      );
      if (issue) {
        this.blocked = true;
        this.blockedGoal = [...this.goal];
        this.goal = [...this.q];
        this.velocity.fill(0);
        this.log(issue, "safety");
      } else this.q = motorStep(this.q, this.velocity, this.goal, DT);
    }
    this.gap += Math.max(
      -0.08 * DT,
      Math.min(0.08 * DT, this.gapGoal - this.gap),
    );
    if (this.gapGoal > 0.21 && this.held) this.detach();
    this.syncBodies();
    this.world.step();
    this.contacts = this.fingerColliders.map((f) => {
      let contact = false;
      const co = this.colliders.get(this.target ?? "");
      if (co)
        this.world.contactPair(f, co, (manifold) => {
          for (let i = 0; i < manifold.numContacts(); i++)
            if (manifold.contactDist(i) < 0.008) contact = true;
        });
      return contact;
    });
    if (Math.round(this.time / DT) % 6 === 0 && this.frames.length < 18000)
      this.frames.push(this.snapshot());
  }
  snapshot(): Frame {
    return structuredClone({
      time: this.time,
      q: this.q,
      velocity: this.velocity,
      goal: this.goal,
      gap: this.gap,
      objects: this.objects(),
      target: this.target,
      stage: this.stage,
      reason: this.reason,
      inputs: this.inputs,
      output: this.output,
      contact: this.contacts,
      held: this.held,
      barrier: this.barrier,
      blocked: this.blocked,
      controllerState: this.controller.serialize(),
      mode: this.mode,
      events: this.events,
    });
  }
  dispose() {
    this.world.free();
  }
}
