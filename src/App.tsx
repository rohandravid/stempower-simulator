import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { autoPlace, demoCircuit, DEMO_SKETCH, type Demo } from './circuit/model';
import type { Circuit, CircuitDiagnostic, ComponentKind } from './circuit/types';
import { Assistant, type AssistantContext } from './components/Assistant';
import { CircuitCanvas, type Selection } from './components/CircuitCanvas';
import { Diagnostics } from './components/Diagnostics';
import { Editor } from './components/Editor';
import { Palette } from './components/Palette';
import { SerialMonitor } from './components/SerialMonitor';
import { Toolbar } from './components/Toolbar';
import { TutorialPanel } from './components/TutorialPanel';
import { STR } from './i18n/strings';
import { SimController } from './sim/controller';
import { TUTORIALS, type Tutorial } from './tutorials/tutorials';

type Tab = 'code' | 'serial' | 'ai';

interface ActiveTutorial {
  tutorial: Tutorial;
  step: number;
  /** Indexes of steps whose check has passed at least once (latched). */
  done: ReadonlySet<number>;
}

function App() {
  const controllerRef = useRef<SimController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new SimController();
    controllerRef.current.setCircuit(demoCircuit());
  }
  const ctl = controllerRef.current;

  // Re-render whenever the controller reports a change (serial, LEDs, status…).
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    ctl.onChange = bump;
    return () => {
      ctl.onChange = null;
    };
  }, [ctl]);

  const [code, setCode] = useState(DEMO_SKETCH);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('code');
  const [tutorial, setTutorial] = useState<ActiveTutorial | null>(null);

  // Drive the simulation from requestAnimationFrame while running.
  useEffect(() => {
    if (ctl.status !== 'running') return;
    let raf = 0;
    const frame = () => {
      ctl.tick();
      if (ctl.status === 'running') raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ctl, ctl.status]);

  const circuit = ctl.getCircuit();
  const dynamic = ctl.dynamic();

  const updateCircuit = (next: Circuit) => {
    ctl.setCircuit(next);
  };

  const addComponent = (kind: ComponentKind) => {
    const comp = autoPlace(circuit, kind);
    if (!comp) return; // breadboard full — silently ignore, it's 30 columns
    updateCircuit({ ...circuit, components: [...circuit.components, comp] });
    setSelection({ type: 'component', id: comp.id });
  };

  const deleteSelection = () => {
    if (!selection) return;
    if (selection.type === 'component') {
      updateCircuit({ ...circuit, components: circuit.components.filter((c) => c.id !== selection.id) });
    } else {
      updateCircuit({ ...circuit, wires: circuit.wires.filter((w) => w.id !== selection.id) });
    }
    setSelection(null);
  };

  // Delete key removes the selected part/wire (unless typing in the editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement;
      if (target.closest('.cm-editor') || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      if (!selection) return;
      e.preventDefault();
      deleteSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const loadExample = (demo: Demo) => {
    ctl.stop();
    updateCircuit(demo.build());
    setCode(demo.sketch);
    setSelection(null);
    setTab('code');
    setTutorial(null);
  };

  const startTutorial = (demo: Demo) => {
    const tut = TUTORIALS[demo.id];
    if (!tut) {
      loadExample(demo);
      return;
    }
    ctl.stop();
    updateCircuit({ components: [], wires: [] });
    setCode(tut.starterCode);
    setSelection(null);
    setTab('code');
    setTutorial({ tutorial: tut, step: 0, done: new Set() });
  };

  const clearCircuit = () => {
    if (!window.confirm(STR.clearConfirm)) return;
    ctl.stop();
    updateCircuit({ components: [], wires: [] });
    setSelection(null);
  };

  const selectedComponent =
    selection?.type === 'component' ? circuit.components.find((c) => c.id === selection.id) : undefined;

  const flipLed = () => {
    if (!selectedComponent || selectedComponent.kind !== 'led') return;
    updateCircuit({
      ...circuit,
      components: circuit.components.map((c) =>
        c.id === selectedComponent.id
          ? { ...c, pins: { anode: c.pins.cathode, cathode: c.pins.anode } }
          : c,
      ),
    });
  };

  const run = () => {
    const err = ctl.start(code);
    if (!err) setTab('serial'); // watch the output; parse errors keep the editor visible
    else setTab('code');
  };

  // Merge static wiring lint with live electrical faults; when the live
  // analysis flags a component, drop the static item about the same part.
  const diagnostics = useMemo((): CircuitDiagnostic[] => {
    const dynDiags = dynamic.diagnostics;
    const flagged = new Set(dynDiags.map((d) => d.componentId).filter(Boolean));
    const statics = ctl.staticDiagnostics().filter((d) => !d.componentId || !flagged.has(d.componentId));
    return [...dynDiags, ...statics];
  }, [ctl, dynamic]);

  // Evaluate the active tutorial step's live check on every render. Completion
  // latches into `done` so a blinking LED or a released button can't undo it.
  const tutStep = tutorial ? tutorial.tutorial.steps[tutorial.step] : null;
  const checkNow =
    tutorial !== null &&
    tutStep !== null &&
    (!tutStep.check ||
      tutStep.check({ circuit, code, status: ctl.status, serial: ctl.hardware.serialText, dynamic }));
  const tutStepDone = tutorial !== null && (checkNow || tutorial.done.has(tutorial.step));
  useEffect(() => {
    if (tutorial && checkNow && !tutorial.done.has(tutorial.step)) {
      setTutorial({ ...tutorial, done: new Set(tutorial.done).add(tutorial.step) });
    }
  });

  const tutorialGo = (delta: 1 | -1, markDone = false) => {
    if (!tutorial) return;
    const done = markDone ? new Set(tutorial.done).add(tutorial.step) : tutorial.done;
    const step = tutorial.step + delta;
    if (step >= tutorial.tutorial.steps.length) setTutorial(null);
    else if (step >= 0) setTutorial({ ...tutorial, step, done });
  };

  // Everything Spark (the AI tutor) needs to see, gathered at send time.
  const getAssistantContext = (): AssistantContext => ({
    code,
    serialTail: ctl.hardware.serialText.slice(-1500),
    diagnostics: [
      ...(ctl.error ? [`${ctl.error.kind} error${ctl.error.line ? ` on line ${ctl.error.line}` : ''}: ${ctl.error.message}`] : []),
      ...diagnostics.map((d) => `${d.level}: ${d.message}`),
      ...(tutorial && tutStep
        ? [
            `note: the student is following the "${tutorial.tutorial.name}" tutorial, ` +
              `on step ${tutorial.step + 1} of ${tutorial.tutorial.steps.length}: "${tutStep.title}"`,
          ]
        : []),
    ],
    circuit: ctl.getCircuit(),
  });

  return (
    <div className="app">
      <Toolbar
        status={ctl.status}
        onRun={run}
        onStop={() => ctl.stop()}
        onLoadExample={loadExample}
        onStartTutorial={startTutorial}
        onClear={clearCircuit}
      />
      <main className="workspace">
        <Palette
          onAdd={addComponent}
          canDelete={selection !== null}
          onDelete={deleteSelection}
          canFlip={selectedComponent?.kind === 'led'}
          onFlip={flipLed}
        />
        <section className="canvas-pane">
          {tutorial && (
            <TutorialPanel
              tutorial={tutorial.tutorial}
              stepIndex={tutorial.step}
              stepDone={tutStepDone}
              onBack={() => tutorialGo(-1)}
              onNext={() => tutorialGo(1)}
              onSkip={() => tutorialGo(1, true)}
              onExit={() => setTutorial(null)}
              onInsertCode={(snippet) => {
                ctl.stop(); // old sketch keeps running otherwise, hiding the Run button
                setCode(snippet);
                setTab('code');
              }}
            />
          )}
          <div className="circuit-canvas">
            <CircuitCanvas
              circuit={circuit}
              onCircuitChange={updateCircuit}
              leds={dynamic.leds}
              motors={dynamic.motors}
              modulesPowered={dynamic.modulesPowered}
              selection={selection}
              onSelect={setSelection}
            />
          </div>
          <Diagnostics simError={ctl.error} diagnostics={diagnostics} />
        </section>
        <section className="side-pane">
          <div className="tabs">
            <button className="tab" data-active={tab === 'code'} onClick={() => setTab('code')}>
              <span className="tab-icon" aria-hidden="true">✏️</span> {STR.tabCode}
            </button>
            <button className="tab" data-active={tab === 'serial'} onClick={() => setTab('serial')}>
              <span className="tab-icon" aria-hidden="true">🖥️</span> {STR.tabSerial}
            </button>
            <button className="tab" data-active={tab === 'ai'} onClick={() => setTab('ai')}>
              <span className="tab-icon" aria-hidden="true">✨</span> {STR.tabAiHelper}
            </button>
          </div>
          <div className="tab-body">
            {tab === 'code' && (
              <Editor
                value={code}
                onChange={setCode}
                errorLine={ctl.error?.line ?? null}
                errorMessage={ctl.error?.message ?? null}
              />
            )}
            {tab === 'serial' && (
              <SerialMonitor text={ctl.hardware.serialText} onClear={() => ctl.hardware.clearSerial()} />
            )}
            {tab === 'ai' && <Assistant getContext={getAssistantContext} />}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
