import fs from "node:fs";
import assert from "node:assert/strict";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AnimationMixer } from "three";
const bytes = fs.readFileSync(
  new URL("../public/models/neurofly.glb", import.meta.url),
);
const json = JSON.parse(
  bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
);
assert.equal(json.skins.length, 1);
assert.equal(json.meshes.length, 1);
assert.equal(json.meshes[0].primitives.length, 8);
for (const name of ["Idle", "Antennae", "Groom", "Walk", "Flutter", "Hover"])
  assert(json.animations.some((a) => a.name === name));
assert(json.materials.some((m) => m.alphaMode === "BLEND"));
assert(json.skins[0].joints.length >= 26);
const gltf = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
const mixer = new AnimationMixer(gltf.scene);
const transforms = () => {
  const data = [];
  gltf.scene.traverse((o) => {
    if (o.isBone) data.push(...o.position.toArray(), ...o.quaternion.toArray());
  });
  return data;
};
for (const clip of gltf.animations) {
  mixer.stopAllAction();
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  const a = transforms();
  mixer.setTime(0.43);
  const b = transforms();
  assert(
    a.some((x, i) => Math.abs(x - b[i]) > 1e-5),
    `${clip.name} must animate bones`,
  );
}
const report = {
  bytes: bytes.length,
  meshes: json.meshes.length,
  materialPrimitives: 8,
  bones: json.skins[0].joints.length,
  animations: gltf.animations.map((a) => ({
    name: a.name,
    duration: a.duration,
    tracks: a.tracks.length,
  })),
  transparency: "BLEND verified",
  playback: "All clips change rig transforms through Three.js AnimationMixer",
};
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/asset-validation.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
