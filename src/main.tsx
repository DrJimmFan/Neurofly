import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Maximize2,
  ChevronRight,
  Activity,
  Box,
  SlidersHorizontal,
  FolderOpen,
  Download,
  Upload,
  Save,
  Plus,
  X,
  Info,
  Bug,
  ArrowUpRight,
} from "lucide-react";
import {
  Simulation,
  DEFAULT,
  DT,
  PRESETS,
  type Frame,
  type Config,
  type Kind,
} from "./simulation";
import { LabRenderer } from "./renderer";
import { FixedClock } from "./clock";
import { LIMITS, fk, type V3 } from "./robotics";
import {
  load,
  save,
  remove,
  download,
  validate,
  frameIndex,
  type Recording,
} from "./persistence";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/space-grotesk";
import "./style.css";
const fixed = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");
function App() {
  const host = useRef<HTMLDivElement>(null),
    sim = useRef<Simulation | null>(null),
    view = useRef<LabRenderer | null>(null),
    runningRef = useRef(false),
    speedRef = useRef(1),
    replayRef = useRef<Recording | null>(null),
    replayTime = useRef(0),
    schematicRef = useRef(false);
  const [frame, setFrame] = useState<Frame | null>(null),
    [running, setRunning] = useState(false),
    [speed, setSpeed] = useState(1),
    [config, setConfig] = useState<Config>(structuredClone(DEFAULT)),
    [error, setError] = useState(""),
    [asset, setAsset] = useState("Loading fly asset…"),
    [panel, setPanel] = useState<"experiment" | "sessions" | "about">(
      "experiment",
    ),
    [sessions, setSessions] = useState<Recording[]>([]),
    [schematic, setSchematic] = useState(false),
    [name, setName] = useState("First flight"),
    [replay, setReplay] = useState<Recording | null>(null),
    [onboard, setOnboard] = useState(
      () => !localStorage.getItem("nvfly.onboard"),
    ),
    [clip, setClip] = useState("Idle"),
    [manual, setManual] = useState<V3>([0.7, 0.3, 0]),
    [compare, setCompare] = useState<string>("");
  const update = () => {
    if (sim.current) setFrame(sim.current.snapshot());
  };
  const run = (value: boolean) => {
    runningRef.current = value;
    setRunning(value);
  };
  useEffect(() => {
    let cancelled = false,
      id = 0,
      last = performance.now(),
      ui = 0;
    const clock = new FixedClock();
    let lab: LabRenderer | undefined;
    const engine = new Simulation();
    sim.current = engine;
    engine
      .init()
      .then(() => {
        if (cancelled) {
          engine.dispose();
          return;
        }
        try {
          lab = new LabRenderer(host.current!, setAsset);
          view.current = lab;
          setFrame(engine.snapshot());
          setSessions(load());
        } catch (e) {
          setError(
            "3D graphics could not start. Enable WebGL in a supported browser. " +
              String(e),
          );
          return;
        }
        const loop = (now: number) => {
          const elapsed = Math.min((now - last) / 1000, 0.05);
          last = now;
          if (!document.hidden && runningRef.current) {
            if (replayRef.current) {
              replayTime.current += elapsed * speedRef.current;
              const frames = replayRef.current.frames;
              const index = frameIndex(frames, replayTime.current);
              setFrame(frames[index]);
              if (index === frames.length - 1) {
                runningRef.current = false;
                setRunning(false);
              }
            } else {
              clock.advance(elapsed, speedRef.current, true, () =>
                engine.step(),
              );
              if (engine.done) {
                runningRef.current = false;
                setRunning(false);
              }
            }
          } else clock.reset();
          const source = replayRef.current
            ? replayRef.current.frames[
                frameIndex(replayRef.current.frames, replayTime.current)
              ]
            : engine.snapshot();
          lab!.draw(source, schematicRef.current);
          if (now - ui > 100) {
            ui = now;
            setFrame(source);
          }
          id = requestAnimationFrame(loop);
        };
        id = requestAnimationFrame(loop);
      })
      .catch((e) =>
        setError("The simulation could not initialize: " + String(e)),
      );
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      lab?.dispose();
      if (lab) engine.dispose();
    };
  }, []);
  function reset(next = config) {
    run(false);
    replayRef.current = null;
    setReplay(null);
    sim.current?.reset(next);
    update();
    setCompare("");
  }
  function configure(next: Config) {
    setConfig(next);
    reset(next);
  }
  function recording(): Recording {
    const s = sim.current!;
    return {
      schema: "nvfly/1",
      name: name.trim() || "Untitled experiment",
      created: new Date().toISOString(),
      model: s.controller.model,
      version: s.controller.version,
      config: structuredClone(s.config),
      frames: [...s.frames, s.snapshot()],
    };
  }
  function persist() {
    try {
      save(replay ?? recording());
      setSessions(load());
      setError("");
      setPanel("sessions");
    } catch (e) {
      setError(String(e));
    }
  }
  function open(r: Recording) {
    run(false);
    setConfig(structuredClone(r.config));
    replayRef.current = r;
    replayTime.current = 0;
    setReplay(r);
    setFrame(r.frames[0]);
    setName(r.name);
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 40_000_000)
        throw Error("File exceeds the 40 MB import limit.");
      const r = validate(JSON.parse(await file.text()));
      save(r);
      setSessions(load());
      open(r);
      setPanel("sessions");
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function compareRuns() {
    run(false);
    setCompare("Computing both controllers from the same initial scene…");
    await new Promise((r) => setTimeout(r, 30));
    const results = [];
    for (const baseline of [false, true]) {
      const s = await new Simulation({
        ...config,
        preset: "Baseline comparison",
        baseline,
      }).init();
      for (let i = 0; i < 1800 && !s.done; i++) s.step();
      results.push(
        `${baseline ? "Nearest baseline" : "Fly-inspired"}: ${s.target ?? "no target"} · ${s.stage} · ${s.time.toFixed(1)} s`,
      );
      s.dispose();
    }
    setCompare(results.join(" / "));
  }
  const changeObject = (index: number, axis: 0 | 2, value: number) => {
    const next = structuredClone(config);
    next.objects[index].position[axis] = value;
    configure(next);
  };
  const target = frame?.objects.find((o) => o.id === frame.target),
    selection = frame?.inputs.findIndex((i) => i.id === frame.target) ?? -1,
    confidence = frame?.output.scores[selection] ?? 0;
  return (
    <div className="app">
      <header inert={onboard}>
        <a className="brand" href="#" aria-label="NVFLY home">
          <span className="brandmark">
            <Bug size={24} />
          </span>
          <strong>
            NVFLY<span>Neural Control Lab</span>
          </strong>
        </a>
        <nav aria-label="Workspace navigation">
          <button
            className={panel === "experiment" ? "selected" : ""}
            onClick={() => setPanel("experiment")}
          >
            Workspace
          </button>
          <button
            className={panel === "sessions" ? "selected" : ""}
            onClick={() => {
              setPanel("sessions");
              setSessions(load());
            }}
          >
            Experiments <span className="count">{sessions.length}</span>
          </button>
          <button
            className={panel === "about" ? "selected" : ""}
            onClick={() => setPanel("about")}
          >
            About the model <ArrowUpRight size={13} />
          </button>
        </nav>
        <span className="local-badge">
          LOCAL SIMULATION <span>v1.0</span>
        </span>
      </header>
      <main inert={onboard}>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              BIO-INSPIRED ROBOTICS / INTERACTIVE LAB
            </div>
            <h1>A small brain. A new reach.</h1>
            <p>
              Explore how a fly-inspired network turns sensory input into
              robotic action.
            </p>
          </div>
          <button className="quiet" onClick={() => setOnboard(true)}>
            <Info size={16} /> Quick guide
          </button>
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="lab-layout">
          <section className="workspace">
            <div className="workspace-top">
              <span className="live-dot" />
              <strong>
                {replay
                  ? "RECORDED PLAYBACK"
                  : frame?.mode === "manual"
                    ? "MANUAL CONTROL"
                    : "LIVE WORKSPACE"}
              </strong>
              <span className="divider" />
              <span>{config.preset}</span>
              <span className="workspace-right">
                {running ? "RUNNING" : "PAUSED"}{" "}
                <span className="clock">{fixed(frame?.time ?? 0, 1)} s</span>
              </span>
            </div>
            <div className="viewport" ref={host}>
              <div className="scene-caption">
                <span className="tag">01 / OBSERVATION CHAMBER</span>
                <span>Fly-inspired. Human-engineered.</span>
              </div>
              {!frame && (
                <div className="loading">
                  Initializing physics and controller…
                </div>
              )}
              <div className="scene-bottom">
                <span>Drag to orbit · Scroll to zoom</span>
                <button
                  title="Reset camera"
                  aria-label="Reset camera"
                  onClick={() => view.current?.resetCamera()}
                >
                  <Maximize2 size={17} />
                </button>
              </div>
            </div>
            <div className="transport">
              <button
                className="run"
                disabled={!frame}
                onClick={() => {
                  if (sim.current?.done && !replay) reset();
                  if (
                    replay &&
                    replayTime.current >= replay.frames.at(-1)!.time
                  )
                    replayTime.current = 0;
                  run(!running);
                }}
              >
                {running ? <Pause size={17} /> : <Play size={17} />}{" "}
                {running
                  ? "Pause"
                  : replay
                    ? "Play recording"
                    : "Run experiment"}
              </button>
              <button
                className="icon-button"
                title="Reset experiment"
                aria-label="Reset experiment"
                disabled={!frame}
                onClick={() => reset()}
              >
                <RotateCcw size={18} />
              </button>
              <button
                className="icon-button"
                title="Advance one physics step (1/60 s)"
                aria-label="Single step"
                disabled={!frame || running || !!replay}
                onClick={() => {
                  sim.current?.step();
                  update();
                }}
              >
                <SkipForward size={18} />
              </button>
              <div className="speed">
                <label htmlFor="speed">Speed</label>
                <select
                  id="speed"
                  value={speed}
                  onChange={(e) => {
                    const n = +e.target.value;
                    setSpeed(n);
                    speedRef.current = n;
                  }}
                >
                  {[0.5, 1, 2, 4].map((x) => (
                    <option key={x} value={x}>
                      {x}×
                    </option>
                  ))}
                </select>
              </div>
              <span className="physics-note">
                60 Hz physics <span> / </span> 10 Hz controller
              </span>
            </div>
            {replay && (
              <div className="replay">
                <label>
                  Playback position{" "}
                  <input
                    aria-label="Playback position"
                    type="range"
                    min="0"
                    max={replay.frames.length - 1}
                    value={frameIndex(replay.frames, replayTime.current)}
                    onChange={(e) => {
                      run(false);
                      replayTime.current = replay.frames[+e.target.value].time;
                      setFrame(replay.frames[+e.target.value]);
                    }}
                  />
                </label>
                <button onClick={() => reset()}>Exit playback</button>
              </div>
            )}
            <div className="decision">
              <span className="decision-icon">
                <Activity size={20} />
              </span>
              <div>
                <div className="eyebrow">
                  {replay ? "RECORDED DECISION" : "CONTROLLER DECISION"}{" "}
                  <span className="stage">
                    {frame?.stage ?? "Initializing"}
                  </span>
                </div>
                <p>{frame?.reason ?? "Preparing the lab."}</p>
              </div>
              <div className="decision-target">
                <small>CURRENT TARGET</small>
                <strong>
                  {target?.kind ?? "—"}{" "}
                  <span>
                    {confidence > 0 ? `${Math.round(confidence * 100)}%` : ""}
                  </span>
                </strong>
              </div>
            </div>
          </section>
          <aside className="sidebar">
            {panel === "experiment" ? (
              <>
                <div className="panel-title">
                  <SlidersHorizontal size={17} />
                  <h2>Experiment setup</h2>
                  <span>01</span>
                </div>
                <label className="field">
                  Experiment
                  <select
                    value={config.preset}
                    disabled={running || !!replay}
                    onChange={(e) =>
                      configure({ ...config, preset: e.target.value })
                    }
                  >
                    {PRESETS.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <p className="help">
                  {
                    (
                      {
                        "Pick and place":
                          "Choose an object, grasp it, and deliver it to the marked tray.",
                        "Target choice":
                          "Inspect a neural choice and reach toward the selected object.",
                        "Moving target":
                          "Follow a slowly moving object using updated sensory feedback.",
                        Obstruction:
                          "A barrier blocks the scene. Inspect safety rejection and reselection.",
                        "Preference test":
                          "Adjust category preferences below and compare the network response.",
                        "Baseline comparison":
                          "Compare the network with an explicitly labeled nearest-object controller.",
                      } as Record<string, string>
                    )[config.preset]
                  }
                </p>
                <div className="field">
                  Control mode
                  <div className="segmented">
                    <button
                      className={frame?.mode === "neural" ? "active" : ""}
                      disabled={!!replay}
                      onClick={() => {
                        run(false);
                        sim.current?.setMode("neural");
                        update();
                      }}
                      aria-label="Neural mode"
                    >
                      Neural
                    </button>
                    <button
                      className={frame?.mode === "manual" ? "active" : ""}
                      disabled={!!replay}
                      onClick={() => {
                        run(false);
                        sim.current?.setMode("manual");
                        update();
                      }}
                      aria-label="Manual mode"
                    >
                      Manual
                    </button>
                  </div>
                </div>
                <div className="model-card">
                  <span className="model-icon">
                    <Activity size={19} />
                  </span>
                  <div>
                    <strong>
                      {config.baseline
                        ? "Nearest-object baseline"
                        : "Fly-inspired RNN"}
                    </strong>
                    <span>
                      {config.baseline
                        ? "Conventional distance rule"
                        : "8 recurrent units per object · v1.0.0"}
                    </span>
                  </div>
                  <span className="chip">LOCAL</span>
                </div>
                <div className="field-row">
                  <label className="field">
                    Random seed
                    <input
                      type="number"
                      aria-label="Random seed"
                      min="0"
                      max="4294967295"
                      value={config.seed}
                      disabled={running || !!replay}
                      onChange={(e) =>
                        configure({
                          ...config,
                          seed: Math.max(
                            0,
                            Math.min(4294967295, Number(e.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Fly animation
                    <select
                      value={clip}
                      onChange={(e) => {
                        setClip(e.target.value);
                        view.current?.playClip(e.target.value);
                      }}
                    >
                      {[
                        "Idle",
                        "Antennae",
                        "Groom",
                        "Walk",
                        "Flutter",
                        "Hover",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="micro">
                  Fly motion is cosmetic. Arm behavior is computed.
                </p>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={schematic}
                    onChange={(e) => {
                      setSchematic(e.target.checked);
                      schematicRef.current = e.target.checked;
                    }}
                  />
                  <span>Schematic head activity</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={frame?.barrier ?? false}
                    disabled={!!replay}
                    onChange={(e) => {
                      sim.current?.setBarrier(e.target.checked);
                      update();
                    }}
                  />
                  <span>Introduce barrier</span>
                </label>
                {frame?.mode === "manual" && (
                  <details open>
                    <summary>Manual arm controls</summary>
                    {LIMITS.map(([min, max], i) => (
                      <label className="slider-label" key={i}>
                        Joint {i + 1}
                        <span>{fixed(frame.q[i])} rad</span>
                        <input
                          aria-label={`Joint ${i + 1}`}
                          type="range"
                          min={min}
                          max={max}
                          step=".01"
                          value={frame.goal[i]}
                          onChange={(e) => {
                            sim.current?.setJoint(i, +e.target.value);
                            update();
                          }}
                        />
                      </label>
                    ))}
                    <div className="coords">
                      {manual.map((x, i) => (
                        <label key={i}>
                          {["X", "Y", "Z"][i]}
                          <input
                            aria-label={`End effector ${["X", "Y", "Z"][i]}`}
                            type="number"
                            step=".05"
                            value={x}
                            onChange={(e) =>
                              setManual(
                                manual.map((n, j) =>
                                  j === i ? +e.target.value : n,
                                ) as V3,
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        sim.current?.setManualTarget(manual);
                        update();
                      }}
                    >
                      Set end-effector target
                    </button>
                    <button
                      onClick={() => {
                        if (sim.current)
                          sim.current.gapGoal =
                            sim.current.gapGoal > 0.15 ? 0.04 : 0.22;
                        update();
                      }}
                    >
                      Open / close gripper
                    </button>
                    <p className="micro">
                      Press Run to execute manual motor commands.
                    </p>
                  </details>
                )}
                <details open={config.preset === "Preference test"}>
                  <summary>Configured preferences</summary>
                  <p className="micro">
                    Hand-configured category biases, not learned discoveries.
                    Higher values increase preference.
                  </p>
                  {["Banana", "Cube", "Ball"].map((kind, i) => (
                    <label key={kind} className="slider-label">
                      {kind}
                      <span>{fixed(config.preferences[i])}</span>
                      <input
                        aria-label={`${kind} preference`}
                        disabled={running || !!replay}
                        type="range"
                        min="-1"
                        max="1"
                        step=".05"
                        value={config.preferences[i]}
                        onChange={(e) => {
                          const p = [...config.preferences];
                          p[i] = +e.target.value;
                          configure({ ...config, preferences: p });
                        }}
                      />
                    </label>
                  ))}
                </details>
                <details>
                  <summary>Objects & positions</summary>
                  <p className="micro">
                    Editing resets the run. Position in metres from the arm
                    base. Maximum 9 objects.
                  </p>
                  {config.objects.map((obj, i) => (
                    <div className="object-editor" key={obj.id}>
                      <strong>{obj.id}</strong>
                      <label className="slider-label">
                        Size · {fixed(obj.size * 1000, 0)} mm radius
                        <input
                          aria-label={`${obj.id} size`}
                          type="range"
                          min=".045"
                          max=".095"
                          step=".005"
                          disabled={running || !!replay}
                          value={obj.size}
                          onChange={(e) => {
                            const next = structuredClone(config);
                            next.objects[i].size = +e.target.value;
                            next.objects[i].position[1] = +e.target.value;
                            configure(next);
                          }}
                        />
                      </label>
                      <div className="coords">
                        {([0, 2] as const).map((axis) => (
                          <label key={axis}>
                            {axis === 0 ? "X" : "Z"}
                            <input
                              aria-label={`${obj.id} ${axis === 0 ? "X" : "Z"}`}
                              type="number"
                              min="-1"
                              max="1.6"
                              step=".05"
                              disabled={running || !!replay}
                              value={obj.position[axis]}
                              onChange={(e) =>
                                changeObject(i, axis, +e.target.value)
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="add-objects">
                    {(["banana", "cube", "ball"] as Kind[]).map((kind) => (
                      <button
                        key={kind}
                        disabled={
                          running || !!replay || config.objects.length >= 9
                        }
                        onClick={() =>
                          configure({
                            ...config,
                            objects: [
                              ...config.objects,
                              {
                                id: `${kind}-${config.objects.length + 1}`,
                                kind,
                                position: [
                                  0.8,
                                  0.065,
                                  0.35 + (config.objects.length - 3) * 0.16,
                                ],
                                size: 0.065,
                                rotation: { x: 0, y: 0, z: 0, w: 1 },
                              },
                            ],
                          })
                        }
                      >
                        <Plus size={12} />
                        {kind}
                      </button>
                    ))}
                  </div>
                </details>
                {config.preset === "Baseline comparison" && (
                  <div>
                    <button className="wide" onClick={compareRuns}>
                      Compare both controllers
                    </button>
                    <p role="status" className="help">
                      {compare}
                    </p>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={config.baseline}
                        disabled={running}
                        onChange={(e) =>
                          configure({ ...config, baseline: e.target.checked })
                        }
                      />
                      Use nearest-object baseline
                    </label>
                  </div>
                )}
                <div className="save-box">
                  <label className="field">
                    Experiment name
                    <input
                      aria-label="Experiment name"
                      value={name}
                      maxLength={160}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <button className="wide" disabled={!frame} onClick={persist}>
                    <Save size={15} /> Save experiment
                  </button>
                </div>
              </>
            ) : panel === "sessions" ? (
              <>
                <div className="panel-title">
                  <FolderOpen size={17} />
                  <h2>Saved experiments</h2>
                </div>
                <p className="help">
                  Stored in this browser. Export a recording to keep a portable
                  copy.
                </p>
                <label className="file-button">
                  <Upload size={15} /> Import recording
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => importFile(e.target.files?.[0])}
                  />
                </label>
                <button
                  className="wide"
                  disabled={!frame}
                  onClick={() => download(replay ?? recording())}
                >
                  <Download size={15} /> Export current run
                </button>
                {sessions.length === 0 ? (
                  <p className="empty">
                    Your experiments will appear here after you save a run.
                  </p>
                ) : (
                  sessions.map((r, i) => (
                    <article className="session" key={r.created + i}>
                      <h3>{r.name}</h3>
                      <p>
                        {r.config.preset} ·{" "}
                        {fixed(r.frames.at(-1)?.time ?? 0, 1)} s
                      </p>
                      <small>
                        {r.model} · seed {r.config.seed}
                      </small>
                      <div>
                        <button onClick={() => open(r)}>
                          <Play size={14} /> Replay
                        </button>
                        <button
                          onClick={() => {
                            configure(r.config);
                            setName(r.name);
                            setPanel("experiment");
                          }}
                        >
                          Reopen setup
                        </button>
                        <button
                          aria-label={`Export ${r.name}`}
                          onClick={() => download(r)}
                        >
                          <Download size={14} />
                        </button>
                        <button
                          aria-label={`Delete ${r.name}`}
                          onClick={() => {
                            remove(i);
                            setSessions(load());
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </>
            ) : (
              <>
                <div className="panel-title">
                  <Info size={17} />
                  <h2>About NVFLY</h2>
                </div>
                <p className="help">
                  An independent, fly-inspired control experiment. This is not a
                  reconstructed fly brain, camera vision, or measured dopamine
                  activity.
                </p>
                <h3>The actual pipeline</h3>
                <ol className="pipeline-list">
                  {[
                    "Structured scene inputs",
                    "Sensory normalization",
                    "Seeded recurrent network",
                    "Thresholds & target hysteresis",
                    "Task state machine",
                    "Checked trajectory & inverse kinematics",
                    "Bounded joint motors",
                    "Rapier physics & feedback",
                  ].map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <p className="help">
                  The network uses 8 recurrent units per object, seeded small
                  input weights, persistent activity, and disclosed category
                  biases. It is hand-configured, not trained on biological
                  recordings.
                </p>
                <p className="help">
                  The gripper uses a physics constraint only after two-sided
                  contact and closure. Arm motors are kinematic servos; a
                  conventional collision guard checks every movement. Banana
                  physics uses a spherical proxy.
                </p>
                <p className="help">
                  Replay displays recorded states. Cross-device deterministic
                  physics is not claimed. The exact Fly/Wirehead repository was
                  not supplied and is not integrated.
                </p>
                <a className="text-link" href="/models/nvfly.glb" download>
                  Download animated fly GLB <Download size={14} />
                </a>
              </>
            )}
          </aside>
        </div>
        <section className="telemetry">
          <div className="telemetry-card">
            <div className="card-label">
              <Activity size={15} /> Neural activity{" "}
              <span>ACTUAL RNN STATE</span>
            </div>
            <div
              className="activity-graph"
              aria-label="Actual recurrent neuron activations"
            >
              {(frame?.output.activity.length
                ? frame.output.activity
                : Array(24).fill(0)
              ).map((n, i) => (
                <div
                  key={i}
                  title={`Unit ${i + 1}: ${fixed(n, 4)}`}
                  style={{
                    height: `${12 + Math.abs(n) * 88}%`,
                    opacity: 0.3 + Math.abs(n) * 0.7,
                    background: n < 0 ? "#af9b71" : undefined,
                  }}
                />
              ))}
            </div>
            <div className="card-foot">
              <span>
                {config.baseline
                  ? "Baseline active · network bypassed"
                  : "Persistent recurrent state"}
              </span>
              <strong>{frame?.output.activity.length ?? 24} units</strong>
            </div>
          </div>
          <div className="telemetry-card">
            <div className="card-label">
              <Box size={15} /> Arm state <span>6 AXES</span>
            </div>
            <div className="metrics">
              <div>
                <small>GRIPPER</small>
                <strong>
                  {frame?.held
                    ? "Holding"
                    : (frame?.gap ?? 0.22) < 0.21
                      ? "Closed"
                      : "Open"}
                  <span>{fixed((frame?.gap ?? 0.22) * 1000, 0)} mm</span>
                </strong>
              </div>
              <div>
                <small>SAFETY</small>
                <strong className={frame?.blocked ? "warning" : "green"}>
                  {frame?.blocked ? "Blocked" : "Clear"}
                  <span>
                    {frame?.contact.filter(Boolean).length ?? 0}/2 contacts
                  </span>
                </strong>
              </div>
            </div>
            <div className="card-foot">
              <span>End effector</span>
              <code>
                {frame
                  ? fk(frame.q)[3]
                      .map((n) => fixed(n))
                      .join(" / ")
                  : "—"}{" "}
                m
              </code>
            </div>
          </div>
          <div className="telemetry-card event-card">
            <div className="card-label">
              Event timeline <span>SIMULATION CLOCK</span>
            </div>
            <div className="events">
              {(frame?.events.slice(-3).reverse() ?? []).map((e, i) => (
                <div key={e.time + "-" + i}>
                  <time>{fixed(e.time, 1)}</time>
                  <span>
                    <b className={e.source}>{e.source}</b> {e.text}
                  </span>
                </div>
              ))}
              {!frame?.events.length && (
                <p>Ready when you are. Click Run experiment to begin.</p>
              )}
            </div>
          </div>
        </section>
        <details className="technical">
          <summary>
            Inspect sensory inputs, raw outputs & motor commands{" "}
            <ChevronRight size={14} />
          </summary>
          <div className="technical-grid">
            <div>
              <h3>Structured simulation inputs</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Object",
                        "x",
                        "y",
                        "z",
                        "distance",
                        "size",
                        "category",
                        "visible",
                        "contact",
                        "near",
                        "tray",
                      ].map((x) => (
                        <th key={x}>{x}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {frame?.inputs.map((input) => (
                      <tr key={input.id}>
                        <td>{input.id}</td>
                        {input.values.map((x, i) => (
                          <td key={i}>{fixed(x)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="micro">
                Normalized values. Category: banana 0 · cube 0.5 · ball 1. These
                are structured inputs, not pixels.
              </p>
              <h3>Raw neural outputs</h3>
              <p className="mono">
                Target scores:{" "}
                {frame?.output.scores.map((n) => fixed(n, 3)).join(" / ")}
                <br />
                Approach {fixed(frame?.output.approach ?? 0, 3)} · Grasp{" "}
                {fixed(frame?.output.grasp ?? 0, 3)} · Release{" "}
                {fixed(frame?.output.release ?? 0, 3)}
              </p>
            </div>
            <div>
              <h3>Joint motors · radians</h3>
              <table>
                <thead>
                  <tr>
                    <th>Joint</th>
                    <th>Position</th>
                    <th>Goal</th>
                    <th>Velocity</th>
                  </tr>
                </thead>
                <tbody>
                  {frame?.q.map((n, i) => (
                    <tr key={i}>
                      <td>J{i + 1}</td>
                      <td>{fixed(n, 3)}</td>
                      <td>{fixed(frame.goal[i], 3)}</td>
                      <td>{fixed(frame.velocity[i], 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
        <footer>
          <span>
            <Bug size={14} /> NVFLY <span>Independent by design.</span>
          </span>
          <span>
            {asset} <span>·</span> Structured inputs, transparent decisions.
          </span>
        </footer>
      </main>
      {onboard && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
          >
            <span className="modal-bug">
              <Bug size={32} />
            </span>
            <div className="eyebrow">WELCOME TO THE LAB</div>
            <h2 id="welcome-title">Meet your smallest operator.</h2>
            <p>
              Run a real closed-loop experiment: a fly-inspired network chooses
              an object, and a robotic arm picks it up.
            </p>
            <ol>
              <li>
                <strong>Run the experiment.</strong> Watch the arm and its
                current decision.
              </li>
              <li>
                <strong>Change the conditions.</strong> Try a barrier, moving
                target, or new preferences.
              </li>
              <li>
                <strong>Keep the evidence.</strong> Inspect telemetry, save your
                run, and replay recorded states.
              </li>
            </ol>
            <p className="micro">
              The fly animation is cosmetic. Neural activity comes from the
              controller. No account or API required.
            </p>
            <button
              autoFocus
              className="run"
              onClick={() => {
                localStorage.setItem("nvfly.onboard", "1");
                setOnboard(false);
              }}
            >
              Enter the lab <ChevronRight size={17} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
