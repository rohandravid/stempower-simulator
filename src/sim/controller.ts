// Ties everything together: owns the circuit, the hardware, the running
// sketch generator, and the per-frame time budget. Framework-agnostic —
// the React layer subscribes via onChange and calls tick() from rAF.

import { analyzeDynamic, analyzeStatic } from '../circuit/analysis';
import type { Circuit, CircuitDiagnostic, DynamicAnalysis, PinOutputs } from '../circuit/types';
import { SketchParseError, SketchRuntimeError } from '../interpreter/errors';
import { SketchRunner, type VmYield } from '../interpreter/interpreter';
import { parseSketch } from '../interpreter/parser';
import { Hardware } from './hardware';

export type SimStatus = 'idle' | 'running' | 'error';

export interface SimError {
  message: string;
  line?: number;
  kind: 'parse' | 'runtime';
}

/** How much of each animation frame the interpreter may use. */
const FRAME_BUDGET_MS = 4;

export class SimController {
  readonly hardware = new Hardware();

  status: SimStatus = 'idle';
  error: SimError | null = null;

  private circuit: Circuit = { components: [], wires: [] };
  private circuitVersion = 0;

  private gen: Generator<VmYield, void, void> | null = null;
  private runner: SketchRunner | null = null;
  private startWall = 0;
  private waitUntilMs = 0;

  private dynamicCache: DynamicAnalysis | null = null;
  private dynamicKey = '';
  private staticCache: CircuitDiagnostic[] = [];
  private staticVersion = -1;

  /** Bumped on any observable change; cheap subscription for React. */
  version = 0;
  onChange: (() => void) | null = null;

  constructor(private nowFn: () => number = () => performance.now()) {
    this.hardware.readDigital = (pin) => this.dynamic().digitalReads[pin] ?? 0;
    this.hardware.readAnalog = (pin) => this.dynamic().analogReads[pin] ?? 0;
    this.hardware.readDht = (pin) => this.dynamic().dhtByPin[pin];
    this.hardware.clock = () => (this.status === 'running' ? this.nowFn() - this.startWall : 0);
  }

  private notify(): void {
    this.version += 1;
    this.onChange?.();
  }

  // --- circuit ---------------------------------------------------------------

  getCircuit(): Circuit {
    return this.circuit;
  }

  setCircuit(circuit: Circuit): void {
    this.circuit = circuit;
    this.circuitVersion += 1;
    this.notify();
  }

  /** Live LED states + reads, recomputed lazily when pins or wiring change. */
  dynamic(): DynamicAnalysis {
    const key = `${this.circuitVersion}:${this.hardware.outputsVersion}`;
    if (!this.dynamicCache || this.dynamicKey !== key) {
      const outputs: PinOutputs =
        this.status === 'running' || this.status === 'error'
          ? this.hardware.snapshotOutputs()
          : { modes: {}, digital: {}, pwm: {} };
      this.dynamicCache = analyzeDynamic(this.circuit, outputs);
      this.dynamicKey = key;
    }
    return this.dynamicCache;
  }

  /** Static wiring lint, recomputed when the circuit is edited. */
  staticDiagnostics(): CircuitDiagnostic[] {
    if (this.staticVersion !== this.circuitVersion) {
      this.staticCache = analyzeStatic(this.circuit).diagnostics;
      this.staticVersion = this.circuitVersion;
    }
    return this.staticCache;
  }

  // --- run control -------------------------------------------------------------

  /**
   * Parse and start the sketch. On parse failure returns the error (for
   * editor markers) and leaves the simulation stopped.
   */
  start(source: string): SimError | null {
    this.stop();
    let runner: SketchRunner;
    try {
      const program = parseSketch(source);
      this.hardware.reset();
      this.hardware.clearSerial();
      runner = new SketchRunner(program, this.hardware);
    } catch (e) {
      if (e instanceof SketchParseError) {
        this.error = { message: e.message, line: e.line, kind: 'parse' };
      } else if (e instanceof SketchRuntimeError) {
        this.error = { message: e.message, line: e.line, kind: 'runtime' };
      } else {
        this.error = { message: (e as Error).message, kind: 'parse' };
      }
      this.status = 'error';
      this.notify();
      return this.error;
    }
    this.runner = runner;
    this.gen = runner.run();
    this.status = 'running';
    this.error = null;
    this.startWall = this.nowFn();
    this.waitUntilMs = 0;
    this.notify();
    return null;
  }

  stop(): void {
    const wasRunning = this.status !== 'idle';
    this.gen = null;
    this.runner = null;
    this.status = 'idle';
    this.error = null;
    this.hardware.reset(); // pins float again; LEDs go dark
    if (wasRunning) this.notify();
  }

  get simTimeMs(): number {
    return this.status === 'running' ? this.nowFn() - this.startWall : 0;
  }

  /**
   * Advance the sketch within this frame's time budget. Call once per
   * animation frame while running.
   */
  tick(): void {
    if (this.status !== 'running' || !this.gen) return;
    const frameStart = this.nowFn();
    const versionBefore = this.hardware.outputsVersion + this.hardware.serialVersion;

    try {
      while (this.nowFn() - frameStart < FRAME_BUDGET_MS) {
        if (this.simTimeMs < this.waitUntilMs) break; // sleeping in delay()
        const r = this.gen.next();
        if (r.done) {
          // Can't normally happen (loop() repeats forever) but stay safe.
          this.status = 'idle';
          break;
        }
        if (r.value.type === 'delay') {
          this.waitUntilMs = r.value.untilMs;
        }
      }
    } catch (e) {
      if (e instanceof SketchRuntimeError) {
        this.error = { message: e.message, line: e.line, kind: 'runtime' };
      } else {
        this.error = {
          message: (e as Error).message,
          line: this.runner?.currentLine,
          kind: 'runtime',
        };
      }
      this.status = 'error';
      this.gen = null;
    }

    if (
      versionBefore !== this.hardware.outputsVersion + this.hardware.serialVersion ||
      this.status !== 'running'
    ) {
      this.notify();
    }
  }
}
