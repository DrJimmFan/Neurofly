# Validation report

Validated locally on Windows on 12 September 2026. Delivery remains on this PC; no Git initialization, commits, GitHub repository, push, or deployment was performed.

## Passed

- TypeScript checking and Vite production build.
- 14 automated tests covering FK/IK roundtrips, joint limits, unreachable targets, normal motor velocity/acceleration bounds, fixed-step pause/speed behavior, actual two-sided grasp contact, non-teleporting transport, release inside the tray, obstruction recovery to another target, target choice, preference-dependent decisions, nearest-object baseline, moving-target tracking, mode/reset behavior, seeded controller reproducibility, validated JSON roundtrip, browser-storage behavior and timestamp-based replay lookup.
- Default seed-42 pick/place completed in about 7.5 simulation seconds. Actual final object state is in `examples/pick-and-place.neurofly.json`.
- Barrier preset stops, excludes the blocked target, selects the ball and completes placement. Its real state recording is in `examples/obstruction.neurofly.json`.
- Blender GLB validation: 802,408 bytes, one skinned mesh, eight material primitives, 26 joints, six named clips. Every clip changes rig transforms through Three.js AnimationMixer. Wing BLEND transparency verified. Details: `asset-validation.json`.
- Browser production preview visibly rendered the actual exported fly, arm, objects and tray. The normal run reached Complete with the banana visibly inside the tray.
- Browser save/reload retained a named recording. Playback displayed recorded intermediate states and reached the recorded completion state.
- Browser imported the supplied barrier recording. Export created `Barrier_recovery.neurofly.json` in Downloads; its parsed content matched the imported example exactly at that verification point.
- Manual mode and changing joint positions were observed in the live browser preview. Schematic activity toggle is available and switches on.
- Desktop and the narrower in-app preview were visually inspected. Further device-specific visual polish was stopped at the user's request.

## Practical limitations

- This is a hand-configured fly-inspired controller, not a reconstructed biological brain. Category preferences are disclosed. The exact Fly/Wirehead URL was not supplied, so no integration or license review of that external repository was performed.
- Robot servos and collision checks are deliberately simplified. The banana uses a spherical physics proxy; grasping uses a contact-gated fixed constraint; the tray is a marked region. IK solves a downward terminal-link position task, not arbitrary full-pose optimization. See `ARCHITECTURE.md`.
- Replay is faithful to stored 10 Hz snapshots, not an exact reconstruction of all intermediate physics steps. Cross-device deterministic physics is not claimed.
- Long runs can exhaust browser storage; export recordings. The recording cap is 18,000 periodic frames. Browser graphics-support failure is handled with an error message, but forced GPU-loss testing was not performed.
- Vite warns about the size of the Rapier WASM/graphics chunks. Rapier emits an upstream initialization deprecation warning. Neither prevented the successful build or observed runs.
- Exhaustive mobile-device testing, every animation's browser visual inspection, and arbitrary adversarial scene configurations were not completed. The user requested stopping refinement after viewing the working version.

## Recheck

`npm test`, `npm run verify:asset`, `npm run build`, then `npm start` and open http://127.0.0.1:4173/.
