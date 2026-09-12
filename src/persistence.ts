import { PRESETS, type Config, type Frame } from "./simulation";
export type Recording = {
  schema: "nvfly/1";
  name: string;
  created: string;
  model: string;
  version: string;
  config: Config;
  frames: Frame[];
};
const KEY = "nvfly.sessions.v1";
export function validate(data: unknown): Recording {
  const r = data as Recording;
  if (!r || r.schema !== "nvfly/1")
    throw Error("Incompatible recording. Expected NVFLY format nvfly/1.");
  if (
    typeof r.name !== "string" ||
    r.name.length > 160 ||
    typeof r.model !== "string" ||
    r.version !== "1.0.0" ||
    typeof r.created !== "string" ||
    !r.config ||
    !Number.isInteger(r.config.seed) ||
    !Array.isArray(r.frames) ||
    r.frames.length === 0 ||
    r.frames.length > 18001
  )
    throw Error("Invalid recording header, model version or frame count.");
  const finite = (xs: unknown, n: number) =>
    Array.isArray(xs) &&
    xs.length === n &&
    xs.every(
      (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e6,
    );
  if (
    !finite(r.config.preferences, 3) ||
    r.config.preferences.some((x) => Math.abs(x) > 1) ||
    !Array.isArray(r.config.objects) ||
    r.config.objects.length < 1 ||
    r.config.objects.length > 9 ||
    !(PRESETS as readonly string[]).includes(r.config.preset) ||
    typeof r.config.baseline !== "boolean"
  )
    throw Error("Invalid experiment configuration.");
  const object = (o: Frame["objects"][number]) => {
    if (
      !o ||
      !["banana", "cube", "ball"].includes(o.kind) ||
      typeof o.id !== "string" ||
      o.id.length > 100 ||
      !finite(o.position, 3) ||
      !Number.isFinite(o.size) ||
      o.size < 0.02 ||
      o.size > 0.2 ||
      !o.rotation ||
      !finite([o.rotation.x, o.rotation.y, o.rotation.z, o.rotation.w], 4)
    )
      throw Error("Invalid object in recording.");
  };
  r.config.objects.forEach(object);
  let previous = -1;
  for (const f of r.frames) {
    if (
      !f ||
      !Number.isFinite(f.time) ||
      f.time < previous ||
      !finite(f.q, 6) ||
      !finite(f.goal, 6) ||
      !finite(f.velocity, 6) ||
      !Number.isFinite(f.gap) ||
      f.gap < 0 ||
      f.gap > 1 ||
      !Array.isArray(f.objects) ||
      f.objects.length > 9 ||
      !f.output ||
      !Array.isArray(f.output.activity) ||
      f.output.activity.length > 72 ||
      !f.output.activity.every(Number.isFinite) ||
      !Array.isArray(f.output.scores) ||
      f.output.scores.length > 9 ||
      !f.output.scores.every(Number.isFinite) ||
      !finite([f.output.approach, f.output.grasp, f.output.release], 3) ||
      !Array.isArray(f.inputs) ||
      f.inputs.length > 9 ||
      !Array.isArray(f.events) ||
      f.events.length > 300 ||
      !Array.isArray(f.contact) ||
      f.contact.length !== 2 ||
      !f.contact.every((x) => typeof x === "boolean") ||
      typeof f.reason !== "string" ||
      f.reason.length > 1000 ||
      typeof f.stage !== "string" ||
      typeof f.barrier !== "boolean" ||
      !["neural", "manual"].includes(f.mode)
    )
      throw Error("Invalid or non-finite frame data.");
    previous = f.time;
    f.objects.forEach(object);
    for (const input of f.inputs)
      if (typeof input.id !== "string" || !finite(input.values, 10))
        throw Error("Invalid sensory input.");
    for (const e of f.events)
      if (
        !Number.isFinite(e.time) ||
        typeof e.text !== "string" ||
        e.text.length > 1000 ||
        !["neural", "safety", "execution", "user"].includes(e.source)
      )
        throw Error("Invalid timeline event.");
  }
  return r;
}
export function frameIndex(frames: Frame[], time: number) {
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
export function load(): Recording[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]").map(validate);
  } catch {
    return [];
  }
}
export function save(recording: Recording) {
  const list = load();
  list.unshift(validate(recording));
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    throw Error(
      "Browser storage is full. Export your recording and remove older sessions.",
    );
  }
}
export function remove(index: number) {
  const list = load();
  list.splice(index, 1);
  localStorage.setItem(KEY, JSON.stringify(list));
}
export function download(r: Recording) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(r)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = r.name.replace(/[^\w-]/g, "_") + ".nvfly.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
