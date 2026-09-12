import { Vector3, Quaternion } from "three";
export type V3 = [number, number, number];
export const LIMITS = [
  [-2.9, 2.9],
  [-0.25, 2.6],
  [-2.8, 2.8],
  [-3.14, 3.14],
  [-3.14, 3.14],
  [-3.14, 3.14],
];
export const HOME = [0, 1.15, -1.65, -1.0707963268, 0, 0];
export const SPEED = 1.15,
  ACCEL = 2.8;
export const v = (p: V3) => new Vector3(...p);
export const arr = (p: Vector3) => p.toArray() as V3;
export const distance = (a: V3, b: V3) => v(a).distanceTo(v(b));
export function fk(q: number[]) {
  const [yaw, s, e, w] = q,
    p0 = new Vector3(0, 0.24, 0);
  const dir = (a: number, l: number) =>
    new Vector3(
      Math.cos(yaw) * Math.cos(a) * l,
      Math.sin(a) * l,
      Math.sin(yaw) * Math.cos(a) * l,
    );
  const p1 = p0.clone().add(dir(s, 0.72)),
    p2 = p1.clone().add(dir(s + e, 0.62)),
    p3 = p2.clone().add(dir(s + e + w, 0.18));
  return [p0, p1, p2, p3].map(arr);
}
export function ik(target: V3, previous = HOME): number[] | null {
  const [x, y, z] = target,
    r = Math.hypot(x, z),
    h = y + 0.18 - 0.24;
  const c = (r * r + h * h - 0.72 ** 2 - 0.62 ** 2) / (2 * 0.72 * 0.62);
  if (Math.abs(c) > 1 || y < 0.045) return null;
  const e = -Math.acos(c),
    s =
      Math.atan2(h, r) -
      Math.atan2(0.62 * Math.sin(e), 0.72 + 0.62 * Math.cos(e));
  const q = [
    Math.atan2(z, x),
    s,
    e,
    -Math.PI / 2 - s - e,
    previous[4],
    previous[5],
  ];
  return q.every((n, i) => n >= LIMITS[i][0] && n <= LIMITS[i][1]) ? q : null;
}
export function motorStep(
  q: number[],
  vel: number[],
  goal: number[],
  dt: number,
) {
  return q.map((p, i) => {
    const error = goal[i] - p;
    let desired =
      Math.sign(error) *
      Math.min(
        SPEED,
        Math.sqrt(2 * ACCEL * Math.abs(error)),
        Math.abs(error) / dt,
      );
    vel[i] += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, desired - vel[i]));
    const next = p + vel[i] * dt;
    return Math.max(LIMITS[i][0], Math.min(LIMITS[i][1], next));
  });
}
export function segmentDistance(p: V3, a: V3, b: V3) {
  const ab = v(b).sub(v(a)),
    t = Math.max(
      0,
      Math.min(1, v(p).sub(v(a)).dot(ab) / Math.max(1e-9, ab.lengthSq())),
    );
  return v(a).addScaledVector(ab, t).distanceTo(v(p));
}
export function linkRotation(a: V3, b: V3) {
  return new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    v(b).sub(v(a)).normalize(),
  );
}
export function toolRotation(q: number[]) {
  return new Quaternion()
    .setFromAxisAngle(new Vector3(0, 1, 0), -q[0])
    .multiply(
      new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        q[1] + q[2] + q[3],
      ),
    )
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), q[4]))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), q[5]))
    .multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
    );
}
export function collision(
  q: number[],
  objects: { id: string; position: V3; size: number }[],
  target: string | null,
  barrier: boolean,
) {
  const p = fk(q);
  for (let j = 0; j < 3; j++)
    for (let k = 0; k <= 12; k++) {
      const point = arr(v(p[j]).lerp(v(p[j + 1]), k / 12));
      const radius = j === 2 ? 0.028 : 0.045;
      if (point[1] < radius - 0.002) return "Table clearance";
      if (
        barrier &&
        Math.abs(point[0] - 0.58) < 0.075 + radius &&
        Math.abs(point[2] - 0.05) < 0.22 + radius &&
        point[1] < 0.43 + radius
      )
        return "Barrier blocks trajectory";
      for (const o of objects)
        if (
          (o.id !== target || j < 2) &&
          distance(point, o.position) < o.size + radius
        )
          return `Object ${o.id} blocks trajectory`;
    }
  if (segmentDistance(p[3], p[0], p[1]) < 0.09) return "Arm self-collision";
  for (let i = 0; i <= 8; i++)
    if (segmentDistance(arr(v(p[2]).lerp(v(p[3]), i / 8)), p[0], p[1]) < 0.065)
      return "Arm self-collision";
  // Conservative swept finger endpoints protect manual wrist rotations as well.
  const rotation = toolRotation(q);
  for (const side of [-1, 1])
    for (const end of [-1, 1]) {
      const point = arr(
        new Vector3(0, end * 0.052, side * 0.125)
          .applyQuaternion(rotation)
          .add(v(p[3])),
      );
      if (point[1] < 0.01) return "Gripper table clearance";
      if (
        barrier &&
        Math.abs(point[0] - 0.58) < 0.1 &&
        Math.abs(point[2] - 0.05) < 0.245 &&
        point[1] < 0.45
      )
        return "Gripper blocked by barrier";
    }
  return null;
}
