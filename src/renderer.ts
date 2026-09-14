import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { fk, v, toolRotation, type V3 } from "./robotics";
import { TRAY, type Frame } from "./simulation";
export class LabRenderer {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(40, 1, 0.01, 100);
  renderer: T.WebGLRenderer;
  controls: OrbitControls;
  resize: ResizeObserver;
  objects = new Map<string, T.Object3D>();
  arm: T.Group[] = [];
  fingers: T.Mesh[] = [];
  barrier: T.Mesh;
  targetRing: T.Mesh;
  fly: T.Group | null = null;
  mixer: T.AnimationMixer | null = null;
  clips: T.AnimationClip[] = [];
  activeClip = "Idle";
  lastTime = 0;
  neurons: T.Mesh[] = [];
  headMaterials: T.MeshStandardMaterial[] = [];
  assetStatus = "Loading articulated fly…";
  onAsset: (s: string) => void;
  constructor(host: HTMLElement, onAsset: (s: string) => void) {
    this.onAsset = onAsset;
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.setClearColor("#101714");
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D robotics workspace. Drag to orbit; scroll to zoom.",
    );
    this.camera.position.set(2.5, 2.35, 3.1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.05, 0.3, 0.02);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.3;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.scene.fog = new T.Fog("#101714", 5, 12);
    this.scene.add(new T.HemisphereLight("#d9f2dd", "#263126", 2));
    const key = new T.DirectionalLight("#fff5df", 4);
    key.position.set(1, 4, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    const rim = new T.DirectionalLight("#86fdc0", 2);
    rim.position.set(-2, 1, -2);
    this.scene.add(rim);
    const floor = this.box([30, 0.06, 30], [0, -0.7, 0], "#0b110f");
    floor.receiveShadow = true;
    const table = this.box([3.1, 0.13, 2.3], [0.25, -0.065, 0], "#222d28");
    table.receiveShadow = true;
    const edge = this.box([3.12, 0.012, 2.32], [0.25, -0.02, 0], "#56665b");
    edge.position.y = -0.13;
    for (const x of [-1, 1.5])
      for (const z of [-0.85, 0.85])
        this.box([0.075, 0.55, 0.075], [x, -0.4, z], "#202923");
    const grid = new T.GridHelper(3, 30, "#49614f", "#34443a");
    grid.position.set(0.25, 0.002, 0);
    grid.scale.z = 0.76;
    const gm = grid.material as T.Material;
    gm.transparent = true;
    gm.opacity = 0.32;
    this.scene.add(grid);
    this.cylinder(0.19, 0.11, [0, 0.055, 0], "#171f1b");
    this.cylinder(0.14, 0.1, [0, 0.16, 0], "#859588");
    this.cylinder(0.105, 0.08, [0, 0.24, 0], "#283b2e");
    const root = new T.Group();
    root.position.y = 0.24;
    this.scene.add(root);
    this.arm.push(root);
    let parent = root;
    for (let i = 0; i < 3; i++) {
      const pivot = new T.Group();
      parent.add(pivot);
      this.arm.push(pivot);
      const len = [0.72, 0.62, 0.18][i];
      const mesh = new T.Mesh(
        new T.BoxGeometry(len, 0.095, i === 2 ? 0.07 : 0.105),
        this.mat(i === 2 ? "#475c4b" : "#b7c6ae"),
      );
      mesh.position.x = len / 2;
      mesh.castShadow = true;
      pivot.add(mesh);
      const stripe = new T.Mesh(
        new T.BoxGeometry(len * 0.63, 0.008, 0.108),
        this.mat("#63986c"),
      );
      stripe.position.set(len / 2, 0.05, 0);
      pivot.add(stripe);
      const joint = new T.Mesh(
        new T.CylinderGeometry(0.073, 0.073, 0.13, 24),
        this.mat("#25372c"),
      );
      joint.rotation.x = Math.PI / 2;
      pivot.add(joint);
      const cap = new T.Mesh(
        new T.CylinderGeometry(0.044, 0.044, 0.134, 24),
        this.mat("#879884"),
      );
      cap.rotation.x = Math.PI / 2;
      pivot.add(cap);
      parent = new T.Group();
      parent.position.x = len;
      pivot.add(parent);
    }
    const roll = new T.Group();
    parent.add(roll);
    this.arm.push(roll);
    const wrist = new T.Mesh(
      new T.CylinderGeometry(0.045, 0.045, 0.035, 24),
      this.mat("#74a17b"),
    );
    roll.add(wrist);
    for (let i = 0; i < 2; i++) {
      const finger = new T.Mesh(
        new T.BoxGeometry(0.052, 0.104, 0.024),
        this.mat("#b8c6b5"),
      );
      finger.castShadow = true;
      this.scene.add(finger);
      this.fingers.push(finger);
    }
    this.box([0.47, 0.017, 0.4], [TRAY[0], 0.009, TRAY[2]], "#344c38");
    for (const z of [TRAY[2] - 0.2, TRAY[2] + 0.2])
      this.box([0.48, 0.024, 0.014], [TRAY[0], 0.012, z], "#83b58b");
    for (const x of [TRAY[0] - 0.235, TRAY[0] + 0.235])
      this.box([0.014, 0.024, 0.4], [x, 0.012, TRAY[2]], "#83b58b");
    this.label("DESTINATION", [TRAY[0], 0.035, TRAY[2] + 0.27], 0.36);
    this.cylinder(0.39, 0.045, [-0.79, 0.025, -0.22], "#36483b");
    this.cylinder(0.36, 0.012, [-0.79, 0.054, -0.22], "#799680");
    const glass = new T.Mesh(
      new T.CylinderGeometry(0.37, 0.37, 0.63, 64, 1, true),
      new T.MeshPhysicalMaterial({
        color: "#b6efce",
        transparent: true,
        opacity: 0.055,
        roughness: 0.1,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    glass.position.set(-0.79, 0.36, -0.22);
    this.scene.add(glass);
    this.label("D. MELANOGASTER", [-0.79, 0.072, 0.21], 0.46);
    this.barrier = this.box([0.15, 0.43, 0.44], [0.58, 0.215, 0.05], "#c57c47");
    this.barrier.material = new T.MeshStandardMaterial({
      color: "#bd8055",
      transparent: true,
      opacity: 0.65,
    });
    this.targetRing = new T.Mesh(
      new T.RingGeometry(0.09, 0.097, 64),
      new T.MeshBasicMaterial({ color: "#aeefa2", side: T.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.targetRing);
    new GLTFLoader().load(
      "/models/neurofly.glb",
      (gltf) => {
        this.fly = gltf.scene;
        this.fly.scale.setScalar(0.4);
        this.fly.position.set(-0.79, 0.067, -0.22);
        this.fly.rotation.y = 0.25;
        this.scene.add(this.fly);
        this.fly.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.castShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats)
              if (m.name === "Head chitin schematic toggle")
                this.headMaterials.push(m);
          }
        });
        this.mixer = new T.AnimationMixer(this.fly);
        this.clips = gltf.animations;
        this.playClip("Idle");
        const head = this.fly.getObjectByName("head");
        if (head) {
          for (let i = 0; i < 8; i++) {
            const n = new T.Mesh(
              new T.SphereGeometry(0.025, 8, 8),
              new T.MeshBasicMaterial({
                color: "#90ffb0",
                transparent: true,
                depthTest: false,
              }),
            );
            n.position.set(
              ((i % 3) - 1) * 0.1,
              0.09 + Math.floor(i / 3) * 0.05,
              0,
            );
            n.visible = false;
            head.add(n);
            this.neurons.push(n);
          }
        }
        this.assetStatus = `Fly loaded · ${gltf.animations.length} animation clips`;
        this.onAsset(this.assetStatus);
      },
      undefined,
      () => {
        this.assetStatus = "Fly asset failed to load. Check /models/neurofly.glb.";
        this.onAsset(this.assetStatus);
      },
    );
    this.resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    });
    this.resize.observe(host);
  }
  mat(color: string) {
    return new T.MeshStandardMaterial({
      color,
      roughness: 0.42,
      metalness: 0.25,
    });
  }
  box(size: V3, p: V3, color: string) {
    const o = new T.Mesh(new T.BoxGeometry(...size), this.mat(color));
    o.position.set(...p);
    o.castShadow = true;
    o.receiveShadow = true;
    this.scene.add(o);
    return o;
  }
  cylinder(r: number, h: number, p: V3, color: string) {
    const o = new T.Mesh(new T.CylinderGeometry(r, r, h, 48), this.mat(color));
    o.position.set(...p);
    o.castShadow = true;
    this.scene.add(o);
    return o;
  }
  label(text: string, p: V3, width: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#9aac9e";
    ctx.font = "24px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 40);
    const texture = new T.CanvasTexture(canvas);
    const mesh = new T.Mesh(
      new T.PlaneGeometry(width, width / 8),
      new T.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(...p);
    this.scene.add(mesh);
  }
  playClip(name: string) {
    this.activeClip = name;
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    const clip = this.clips.find(
      (c) => c.name === name || c.name.includes(name),
    );
    if (clip) this.mixer.clipAction(clip).play();
  }
  resetCamera() {
    this.camera.position.set(2.5, 2.35, 3.1);
    this.controls.target.set(0.05, 0.3, 0.02);
    this.controls.update();
  }
  draw(frame: Frame, schematic: boolean) {
    const q = frame.q;
    this.arm[0].rotation.y = -q[0];
    this.arm[1].rotation.z = q[1];
    this.arm[2].rotation.z = q[2];
    this.arm[3].rotation.z = q[3];
    this.arm[4].rotation.x = q[4];
    this.arm[4].rotation.y = q[5];
    const ee = v(fk(q)[3]),
      rot = toolRotation(q);
    for (let i = 0; i < 2; i++) {
      this.fingers[i].position
        .copy(ee)
        .add(
          v([
            0,
            0,
            (i === 0 ? -1 : 1) * (frame.gap / 2 + 0.012),
          ]).applyQuaternion(rot),
        );
      this.fingers[i].quaternion.copy(rot);
    }
    const seen = new Set<string>();
    for (const obj of frame.objects) {
      seen.add(obj.id);
      let mesh = this.objects.get(obj.id);
      if (!mesh) {
        if (obj.kind === "banana") {
          const curve = new T.CatmullRomCurve3([
            new T.Vector3(-0.1, 0, 0),
            new T.Vector3(-0.055, -0.025, 0),
            new T.Vector3(0.025, -0.029, 0),
            new T.Vector3(0.1, 0.025, 0),
          ]);
          mesh = new T.Mesh(
            new T.TubeGeometry(curve, 16, 0.035, 10, false),
            this.mat("#e3cb56"),
          );
        } else
          mesh = new T.Mesh(
            obj.kind === "cube"
              ? new T.BoxGeometry(obj.size * 2, obj.size * 2, obj.size * 2)
              : new T.SphereGeometry(obj.size, 32, 20),
            this.mat(obj.kind === "cube" ? "#9baba6" : "#bf8569"),
          );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        mesh.userData.referenceSize = obj.kind === "banana" ? 0.065 : obj.size;
        this.objects.set(obj.id, mesh);
      }
      mesh.scale.setScalar(obj.size / mesh.userData.referenceSize);
      mesh.position.set(...obj.position);
      mesh.quaternion.set(
        obj.rotation.x,
        obj.rotation.y,
        obj.rotation.z,
        obj.rotation.w,
      );
    }
    for (const [id, mesh] of this.objects)
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.objects.delete(id);
      }
    const target = frame.objects.find((o) => o.id === frame.target);
    this.targetRing.visible = !!target;
    if (target)
      this.targetRing.position.set(
        target.position[0],
        0.007,
        target.position[2],
      );
    this.barrier.visible = frame.barrier;
    if (this.mixer) this.mixer.setTime(frame.time);
    for (const mat of this.headMaterials) {
      mat.transparent = schematic;
      mat.opacity = schematic ? 0.25 : 1;
    }
    this.neurons.forEach((n, i) => {
      n.visible = schematic;
      const activity = Math.abs(frame.output.activity[i] ?? 0);
      n.scale.setScalar(0.5 + activity * 2);
      (n.material as T.MeshBasicMaterial).opacity = 0.25 + activity * 0.75;
    });
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.resize.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          m.dispose(),
        );
      }
    });
  }
}
