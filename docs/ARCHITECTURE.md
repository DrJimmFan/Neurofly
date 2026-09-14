# Architecture and model notes

## One actual control loop

Scene → sensory encoder → recurrent controller → confidence/hysteresis decoder → task state machine → trajectory check → inverse kinematics → bounded joint servos → Rapier physics → updated sensory feedback.

Physics advances in fixed 1/60-second steps. Every sixth physics step updates sensory inputs and the controller. The same simulation time drives rendering, fly animation and telemetry. Pause discards accumulated wall time; hidden tabs do not integrate their absence. Wall-time increments are capped at 50 ms and speed is limited to 0.5–4×. Heavy biological models are not present; the small network and geometry checks run on the main thread. The comparison operation yields before doing a bounded headless simulation. A worker is appropriate if the adapter is replaced with a substantially larger model.

## Structured sensory inputs

Each available object has ten normalized inputs, displayed in the inspection table:

| Index | Channel | Normalization |
| --- | --- | --- |
| 0–2 | x, y, z relative to the arm base | metres / 1.5 |
| 3 | distance from the base | Euclidean distance / 1.5, capped at 1 |
| 4 | collision-proxy size | radius or cube half-extent / 0.15 |
| 5 | category | banana = 0, cube = 0.5, ball = 1 |
| 6 | visibility | binary structured barrier-occlusion rule |
| 7 | gripper contact | selected object has contact with either finger |
| 8 | approach progress | max(0, 1 − end-effector distance / 0.5 m) |
| 9 | tray outcome | object is within 0.16 m of tray center |

These are simulator values, not processed camera pixels. Position, progress, contact, and placement feedback affect subsequent network steps. Safety-rejected objects are excluded from the available input set until reset or obstacle removal. The renderer is never used as model input.

## Fly-inspired recurrent controller v1.0.0

For each object, maintain 8 tanh units. Initialization uses a reproducible 32-bit LCG (multiplier 1664525, increment 1013904223). The 80 shared input weights are uniform in [−0.07, 0.07]. Each unit retains 0.35 of its own previous activation and receives 0.12 of its neighboring unit's previous activation.

For units 0–3 the configured drive is `1.6 * categoryPreference + .35 * visibility - .25 * distance`. For units 4–7 it is `.6 * contact + .4 * approachProgress`. The recurrent sum, seeded linear input projection, and drive pass through tanh. A target logit is three times the mean of units 0–3 plus `.6 * (visibility - .5)`. Softmax at logit scale 2 gives target scores.

Approach = sigmoid(2 + max(0, target logits)); grasp = sigmoid(8 * (maxProgress − .8) + maxContact); release = sigmoid(10 * (maxTrayOutcome − .7)). These readouts are explicit hand-configured components of the adapter, not learned biological measurements. The approach output is predominantly positive in this version; the interface exposes its magnitude but this model is not a learned avoidance controller. Conventional safety has the final say.

Default preferences: banana **0.25**, cube **0.05**, ball **0.15**. The banana's usual selection is an expected consequence of this configuration, not an experimental discovery. Other preferences, object positions, visibility and seeds can change responses. Tests verify that changing preferences changes the selected target. Parameters are hand-configured, not trained on connectome or behavioral data.

The decoder requires target confidence ≥ min(0.34, 1/object count), and retains an existing selection unless another score exceeds it by 0.08. Execution locks the selected target until completion or a safety rejection. The manual interface and nearest-object baseline are separately labeled.

The adapter interface includes `initialize(seed)`, `step(inputs, preferences)`, `reset()`, `serialize()`, `telemetry()`, `model`, and `version`. Replace this interface to integrate a future model. The exact Fly/Wirehead repository URL was not supplied; its license, interface, and dependencies have not been evaluated. No Fly/Wirehead code is included.

## Execution and safety ownership

Neural transitions: Observe→Select from target scores; Select→Approach from approach > 0.55; Align→Close from grasp > 0.65; Lower→Release from release > 0.65.

Conventional transitions: arrival checks, alignment, contact verification, lift, transport, lowering, return clearance and completion. A state transition includes a source tag and explanation in the timeline. The moving-target preset stays in Align and updates its target from current structured position feedback. Choice and preference experiments stop after reaching the selected object's clearance position. Baseline comparison runs both controllers from the same initial configuration, then reports the actually selected targets and completion times.

Before a trajectory is accepted, 24 points of its joint-space segment are checked. Every servo step is checked again. Checks cover link/table clearance, link/object collision proxies, a fixed barrier, non-adjacent link self-collision and conservative gripper endpoints. A dynamic barrier interruption freezes the current motor goal, preventing stale motion from restarting during reselection. Safety can exclude a target and ask the neural controller to select another. If none remains, the arm stays blocked with a reason. If a held load becomes blocked, it is retained while the user removes the obstruction.

This is a simplified tabletop robotics simulator, not a certified motion planner. Collision geometry is approximate and discrete. Unusual user configurations may require repositioning objects or resetting. Invalid requests are reported instead of being labeled successful.

## Six-axis arm

Coordinates: Y up, X forward, Z lateral; metres and radians. Base shoulder height 0.24 m. Upper arm 0.72 m, forearm 0.62 m, terminal link 0.18 m.

| Joint | Axis / purpose | Limits (radians) |
| --- | --- | --- |
| J1 | Base yaw about Y | −2.9 to 2.9 |
| J2 | Shoulder pitch | −0.25 to 2.6 |
| J3 | Elbow pitch | −2.8 to 2.8 |
| J4 | Terminal pitch | −π to π |
| J5 | Local wrist roll | −π to π |
| J6 | Local wrist yaw | −π to π |

The first four transforms determine tool position; the co-located terminal wrist axes determine orientation. `fk` produces shoulder, elbow, wrist, and tool positions; `toolRotation` supplies the complete orientation. Renderer groups follow the same parent chain. The analytic IK solves the elbow-down position solution and compensates J4 to keep the terminal link vertical. It preserves J5/J6. This is constrained position IK, not arbitrary six-dimensional pose IK or a model of a named commercial robot. Manual sliders expose all six axes; manual end-effector entry solves the constrained position task.

Normal servo velocity is bounded to 1.15 rad/s and acceleration to 2.8 rad/s². The controller uses a braking-distance target speed, then acceleration-limited velocity integration. A collision or mode-change stop can override acceleration limits to stop immediately; this emergency stop is a simulation safety approximation. The gripper closes at 0.08 m/s. Manual commands execute only while Run is active. Switching modes clears the trajectory and releases any attachment.

## Physics and grasp approximation

Rapier owns gravity, object rigid-body poses, contact manifolds, and load constraints. Objects are dynamic with friction and damping; robot links and fingers are position-based kinematic servo bodies. Links use capsule proxies. Cube physics uses a box; ball and banana use spheres (the banana's visual shape is intentionally more detailed than its proxy). Table and barrier have box colliders. The marked tray is a destination region on the tabletop, not a separate container physics model.

A fixed impulse joint attaches the object only when **both finger contact manifolds exist**, gap is closed to the object's diameter, and object/tool distance is below 0.1 m. The attachment anchor preserves the current object offset; object positions are never teleported during grasp or transport. Opening the gripper removes the joint, and physics settles the object. Fixed attachment simplifies friction-only grasp mechanics; it does not simulate tactile compliance or force-controlled robotic actuation. The 60 Hz contact test verifies actual Rapier contact, rather than a cosmetic close animation. The optional manual mode can inspect joint servos and opening/closing; automatic contact-gated attachment is part of neural task execution.

## Fly asset and schematic overlay

The editable Blender asset has 26 bones, a skinned mesh with eight material primitives, and six animations. Its 802,408-byte GLB includes translucent wing membranes, veins, setae, eye facets, articulated legs and antennae. The browser loads the exported GLB and uses Three.js AnimationMixer. Each clip demonstrably changes rig transforms. This is a custom expressive visual model inspired by a fruit fly, not a scientific morphological reconstruction.

The optional translucent head contains eight markers whose scale/opacity are driven by the first eight actual controller activations. The interface calls this **schematic**. Neither the marker placement nor the fly's body movement is a measured neural signal. Fly clips remain cosmetic and share the simulation clock.

## Storage and replay

`neurofly/1` JSON recordings contain name, creation time, seed, initial objects and preferences, preset, model/version, joint goals and velocities, object positions and rotations, neural state, raw inputs and outputs, contact, held object, barrier state and timeline. Frames are recorded at 10 Hz, plus initial/final state. Playback chooses frames using recorded timestamps and renders those states directly, without rerunning physics. It is faithful to recorded samples, with a deliberately stepped 10 Hz playback cadence; unrecorded intermediate 60 Hz states are not claimed.

Saved sessions use browser localStorage, capped at 12 entries. Storage quota failures produce an actionable error. Imported JSON is limited to 40 MB and validated for version, dimensions, finite numbers, supported object types and timeline structure. Recordings store up to 18,000 periodic frames (30 minutes). Export sooner for practical browser-storage sizes. No cross-device physics determinism is promised. Replay does not restore a live continuation at an arbitrary frame: **Reopen setup** starts a new run from the stored initial configuration.
