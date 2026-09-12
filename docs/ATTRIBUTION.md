# Third-party attribution

NVFLY is an independent project and is not affiliated with or endorsed by any company, research group, or model named in the brief.

| Component | Role | License / upstream |
| --- | --- | --- |
| React and React DOM | Product UI | MIT · https://github.com/facebook/react |
| Three.js | 3D rendering, GLB loading, animation | MIT · https://github.com/mrdoob/three.js |
| Rapier 3D | Browser physics | Apache-2.0 · https://github.com/dimforge/rapier |
| Lucide | Interface icons | ISC · https://github.com/lucide-icons/lucide |
| DM Sans, Space Grotesk | Locally bundled typography | SIL Open Font License 1.1 · Fontsource packages include license files |
| Vite | Development and static production build | MIT · https://github.com/vitejs/vite |
| TypeScript | Static checking | Apache-2.0 · https://github.com/microsoft/TypeScript |
| Vitest | Simulation/unit testing | MIT · https://github.com/vitest-dev/vitest |
| Prettier | Source formatting | MIT · https://github.com/prettier/prettier |
| Blender 5.2 | Original asset generation and editing | GPL-3.0-or-later application · https://www.blender.org/ |

The custom fly model, animation, and generation script were authored for this project. No downloaded animal meshes, textures, connectomes or pretrained model weights are included. Using Blender does not make its generated art a copy of Blender source code.

The neural controller is custom hand-configured code. It is not FlyWire, Wirehead, a reconstructed fly brain, or a measurement of dopamine activity. No unreviewed Fly/Wirehead repository was integrated.

Primary technical references consulted:

- https://rapier.rs/docs/user_guides/javascript/rigid_body_type/ — kinematic body behavior and the need for explicit obstacle checks.
- https://rapier.rs/docs/user_guides/javascript/joints/ — physics joints and constraints.
- https://www.rapier.rs/javascript3d/classes/World.html — contact manifolds and world stepping.
- https://threejs.org/docs/pages/AnimationMixer.html — GLB animation playback and simulation-time control.

Dependency license texts remain in `node_modules` in this local checkout. The lockfile records exact installed versions. No license for public distribution of the original NVFLY source has been selected; this delivery remains on the user's PC.
