// Electrical analysis: nets via union-find, conduction graph over components,
// LED lit-state, digital/analog reads, and wiring diagnostics.

import { groupKey, ANALOG_PINS } from './model';
import type {
  Circuit,
  CircuitDiagnostic,
  DynamicAnalysis,
  LedState,
  NodeId,
  PinName,
  PinOutputs,
  PlacedComponent,
  StaticAnalysis,
} from './types';

// ---------------------------------------------------------------------------
// Union-find over group keys
// ---------------------------------------------------------------------------

export class UnionFind {
  private parent = new Map<string, string>();

  find(k: string): string {
    let p = this.parent.get(k);
    if (p === undefined) {
      this.parent.set(k, k);
      return k;
    }
    if (p !== k) {
      p = this.find(p);
      this.parent.set(k, p);
    }
    return p;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ---------------------------------------------------------------------------
// Net graph
// ---------------------------------------------------------------------------

interface Edge {
  from: string;
  to: string;
  /** 'both' for resistors/pots/buttons; LEDs conduct anode->cathode only. */
  dir: 'both' | 'forward';
  /** True when the edge limits current (resistor, pot track). */
  resistive: boolean;
  isLed: boolean;
  compId: string;
}

interface NetInfo {
  /** 0..1 supply duty: 1 for 5V/3V3/HIGH pins, pwm/255 for analogWrite pins. */
  sourceDuty: number | null;
  isGround: boolean;
  /** For static lint: could this net ever be driven high / low by the Uno? */
  potentialSource: boolean;
  potentialGround: boolean;
  pullup: boolean;
}

interface Graph {
  net: (node: NodeId) => string;
  edges: Edge[];
  info: Map<string, NetInfo>;
}

function conducts(comp: PlacedComponent): boolean {
  return comp.kind !== 'button' || comp.props.pressed === true;
}

function buildGraph(circuit: Circuit, pins: PinOutputs): Graph {
  const uf = new UnionFind();
  for (const w of circuit.wires) uf.union(groupKey(w.a), groupKey(w.b));

  const net = (node: NodeId) => uf.find(groupKey(node));

  const edges: Edge[] = [];
  for (const comp of circuit.components) {
    if (comp.kind === 'led') {
      edges.push({
        from: net(comp.pins.anode),
        to: net(comp.pins.cathode),
        dir: 'forward',
        resistive: false,
        isLed: true,
        compId: comp.id,
      });
    } else if (comp.kind === 'potentiometer') {
      const wiper = net(comp.pins.wiper);
      for (const end of ['end1', 'end2'] as const) {
        edges.push({
          from: net(comp.pins[end]),
          to: wiper,
          dir: 'both',
          resistive: true,
          isLed: false,
          compId: comp.id,
        });
      }
    } else if (comp.kind === 'motor') {
      // A motor winding is a resistive load between its terminals.
      edges.push({
        from: net(comp.pins.m1),
        to: net(comp.pins.m2),
        dir: 'both',
        resistive: true,
        isLed: false,
        compId: comp.id,
      });
    } else if (comp.kind === 'resistor' || comp.kind === 'button') {
      if (conducts(comp)) {
        edges.push({
          from: net(comp.pins.p1),
          to: net(comp.pins.p2),
          dir: 'both',
          resistive: comp.kind === 'resistor',
          isLed: false,
          compId: comp.id,
        });
      }
    }
    // battery / lm393 / dht11 / l298n: no passive edges — their pins act as
    // supplies or driven outputs, handled via net info below.
  }

  // Classify nets by the Uno pins living on them.
  const info = new Map<string, NetInfo>();
  const getInfo = (n: string): NetInfo => {
    let i = info.get(n);
    if (!i) {
      i = { sourceDuty: null, isGround: false, potentialSource: false, potentialGround: false, pullup: false };
      info.set(n, i);
    }
    return i;
  };

  const allUnoPins = ['5V', '3V3', 'GND1', 'GND2',
    ...Array.from({ length: 14 }, (_, i) => `D${i}`),
    ...Array.from({ length: 6 }, (_, i) => `A${i}`)];

  for (const pin of allUnoPins) {
    const n = uf.find(groupKey(`uno.${pin}`));
    const i = getInfo(n);
    if (pin === '5V' || pin === '3V3') {
      i.sourceDuty = 1;
      i.potentialSource = true;
      continue;
    }
    if (pin.startsWith('GND')) {
      i.isGround = true;
      i.potentialGround = true;
      continue;
    }
    // Digital / analog pin: driven state depends on the sketch.
    i.potentialSource = true;
    i.potentialGround = true;
    const mode = pins.modes[pin];
    if (mode === 'OUTPUT') {
      const pwm = pins.pwm[pin];
      if (pwm !== undefined) {
        if (pwm > 0) i.sourceDuty = Math.max(i.sourceDuty ?? 0, Math.min(pwm, 255) / 255);
        else i.isGround = true;
      } else if (pins.digital[pin] === 1) {
        i.sourceDuty = Math.max(i.sourceDuty ?? 0, 1);
      } else {
        i.isGround = true;
      }
    } else if (mode === 'INPUT_PULLUP') {
      i.pullup = true;
    }
  }

  // Batteries are unconditional supplies, like the Uno's 5V and GND pins.
  for (const comp of circuit.components) {
    if (comp.kind !== 'battery') continue;
    const plus = getInfo(uf.find(groupKey(comp.pins.plus)));
    plus.sourceDuty = 1;
    plus.potentialSource = true;
    const minus = getInfo(uf.find(groupKey(comp.pins.minus)));
    minus.isGround = true;
    minus.potentialGround = true;
  }

  // Make sure every net touched by an edge or module pin has an info record.
  for (const e of edges) {
    getInfo(e.from);
    getInfo(e.to);
  }
  for (const comp of circuit.components) {
    for (const node of Object.values(comp.pins)) getInfo(net(node));
  }

  return { net, edges, info };
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

interface ReachOptions {
  /**
   * Direction current flows relative to the search: searching from an LED's
   * anode toward supply means walking *against* current, so LED edges are
   * traversed cathode->anode ('upstream'). Searching from a cathode toward
   * ground walks *with* current ('downstream').
   */
  ledTraversal: 'upstream' | 'downstream' | 'none';
  /** Predicate deciding whether a net terminates the search. */
  isTarget: (info: NetInfo) => boolean;
  /** Component id whose edges are skipped (the LED under analysis itself). */
  excludeComp?: string;
}

interface ReachResult {
  reachable: boolean;
  /** Reachable using at least one resistive edge. */
  withResistor: boolean;
  /** Reachable using zero resistive edges. */
  withoutResistor: boolean;
  /** Max source duty among reached target nets (only meaningful for supply searches). */
  bestDuty: number;
}

function reach(graph: Graph, start: string, opts: ReachOptions): ReachResult {
  // State = (net, sawResistor). BFS both parities.
  const seen = new Set<string>();
  const queue: Array<[string, boolean]> = [[start, false]];
  seen.add(`${start}|0`);
  const result: ReachResult = { reachable: false, withResistor: false, withoutResistor: false, bestDuty: 0 };

  while (queue.length > 0) {
    const [n, sawR] = queue.shift()!;
    const info = graph.info.get(n);
    if (info && opts.isTarget(info)) {
      result.reachable = true;
      if (sawR) result.withResistor = true;
      else result.withoutResistor = true;
      result.bestDuty = Math.max(result.bestDuty, info.sourceDuty ?? 0);
      // Targets still propagate (a 5V rail can sit mid-path), keep walking.
    }
    for (const e of graph.edges) {
      if (e.compId === opts.excludeComp) continue;
      let next: string | null = null;
      if (e.isLed) {
        if (opts.ledTraversal === 'none') continue;
        if (opts.ledTraversal === 'downstream' && e.from === n) next = e.to;
        if (opts.ledTraversal === 'upstream' && e.to === n) next = e.from;
      } else {
        if (e.from === n) next = e.to;
        else if (e.to === n) next = e.from;
      }
      if (next === null) continue;
      const nextR = sawR || e.resistive;
      const key = `${next}|${nextR ? 1 : 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push([next, nextR]);
      }
    }
  }
  return result;
}

const isSource = (i: NetInfo) => i.sourceDuty !== null && i.sourceDuty > 0;
const isGround = (i: NetInfo) => i.isGround;
const isPotentialSource = (i: NetInfo) => i.potentialSource;
const isPotentialGround = (i: NetInfo) => i.potentialGround;

// ---------------------------------------------------------------------------
// Modules: sensors/drivers that read net state, then drive their output pins
// ---------------------------------------------------------------------------

const ALL_UNO_IO_PINS: PinName[] = [
  ...Array.from({ length: 14 }, (_, i) => `D${i}`),
  ...Array.from({ length: 6 }, (_, i) => `A${i}`),
];

interface ModuleEffects {
  powered: Record<string, boolean>;
  dhtByPin: Record<PinName, { temperatureC: number; humidityPct: number }>;
  /** Net -> analog voltage driven onto it (e.g. the LM393's AO pin). */
  analogVolts: Map<string, number>;
}

function moduleIsPowered(graph: Graph, comp: PlacedComponent, potential: boolean): boolean {
  const src = potential ? isPotentialSource : isSource;
  const gnd = potential ? isPotentialGround : isGround;
  const vcc = reach(graph, graph.net(comp.pins.vcc), { ledTraversal: 'none', isTarget: src });
  const g = reach(graph, graph.net(comp.pins.gnd), { ledTraversal: 'none', isTarget: gnd });
  return vcc.reachable && g.reachable;
}

/** Digital level a module input pin sees on its net. Floating reads LOW. */
function readNetLevel(graph: Graph, node: NodeId): 0 | 1 {
  const n = graph.net(node);
  const toGround = reach(graph, n, { ledTraversal: 'downstream', isTarget: isGround });
  const toSource = reach(graph, n, { ledTraversal: 'upstream', isTarget: isSource });
  if (toGround.withoutResistor) return 0;
  if (toSource.withoutResistor) return 1;
  if (toGround.reachable) return 0;
  if (toSource.reachable) return 1;
  return 0;
}

/**
 * Evaluate every powered module against the current graph, then apply all
 * output drives at once. Inputs are read from the un-driven graph, so module
 * chains resolve in a single pass (module→module feedback isn't simulated).
 */
function applyModuleEffects(circuit: Circuit, graph: Graph): ModuleEffects {
  const effects: ModuleEffects = { powered: {}, dhtByPin: {}, analogVolts: new Map() };
  const drives: Array<() => void> = [];
  const info = (n: string) => graph.info.get(n)!;

  for (const comp of circuit.components) {
    if (comp.kind === 'lm393') {
      const on = moduleIsPowered(graph, comp, false);
      effects.powered[comp.id] = on;
      if (!on) continue;
      const moisture = comp.props.moisture ?? 0.5;
      const doNet = graph.net(comp.pins.do);
      const aoNet = graph.net(comp.pins.ao);
      drives.push(() => {
        const i = info(doNet);
        if (moisture < 0.5) i.sourceDuty = Math.max(i.sourceDuty ?? 0, 1); // dry → DO HIGH
        else i.isGround = true; // wet → DO LOW
        // Like the real module: AO voltage rises as the soil dries out.
        effects.analogVolts.set(aoNet, 5 * (1 - moisture));
      });
    } else if (comp.kind === 'dht11') {
      const on = moduleIsPowered(graph, comp, false);
      effects.powered[comp.id] = on;
      if (!on) continue;
      const dataNet = graph.net(comp.pins.data);
      for (const pin of ALL_UNO_IO_PINS) {
        if (graph.net(`uno.${pin}`) === dataNet) {
          effects.dhtByPin[pin] = {
            temperatureC: comp.props.temperatureC ?? 24,
            humidityPct: comp.props.humidityPct ?? 60,
          };
        }
      }
    } else if (comp.kind === 'radar') {
      const on = moduleIsPowered(graph, comp, false);
      effects.powered[comp.id] = on;
      if (!on) continue;
      const speedMph = comp.props.speedMph ?? 0;
      const aoNet = graph.net(comp.pins.ao);
      drives.push(() => {
        // AO voltage rises with the target's speed, like the real module.
        effects.analogVolts.set(aoNet, 5 * Math.min(1, Math.max(0, speedMph / 100)));
      });
    } else if (comp.kind === 'l298n') {
      const on = moduleIsPowered(graph, comp, false);
      effects.powered[comp.id] = on;
      if (!on) continue;
      const enaNet = graph.net(comp.pins.ena);
      const toSrc = reach(graph, enaNet, { ledTraversal: 'none', isTarget: isSource });
      const toGnd = reach(graph, enaNet, { ledTraversal: 'none', isTarget: isGround });
      // An unconnected ENA behaves like the factory jumper: full speed.
      const duty = toSrc.reachable ? toSrc.bestDuty : toGnd.reachable ? 0 : 1;
      const in1 = readNetLevel(graph, comp.pins.in1);
      const in2 = readNetLevel(graph, comp.pins.in2);
      const out1 = graph.net(comp.pins.out1);
      const out2 = graph.net(comp.pins.out2);
      drives.push(() => {
        const o1 = info(out1);
        const o2 = info(out2);
        if (in1 === 1 && in2 === 0) {
          o1.sourceDuty = Math.max(o1.sourceDuty ?? 0, duty);
          o2.isGround = true;
        } else if (in2 === 1 && in1 === 0) {
          o2.sourceDuty = Math.max(o2.sourceDuty ?? 0, duty);
          o1.isGround = true;
        } else {
          o1.isGround = true; // both HIGH or both LOW: stop
          o2.isGround = true;
        }
      });
    }
  }

  for (const apply of drives) apply();
  return effects;
}

// ---------------------------------------------------------------------------
// Dynamic analysis (every sim tick)
// ---------------------------------------------------------------------------

export function analyzeDynamic(circuit: Circuit, pins: PinOutputs): DynamicAnalysis {
  const graph = buildGraph(circuit, pins);
  const effects = applyModuleEffects(circuit, graph);
  const leds: Record<string, LedState> = {};
  const diagnostics: CircuitDiagnostic[] = [];

  for (const comp of circuit.components) {
    if (comp.kind !== 'led') continue;
    const anode = graph.net(comp.pins.anode);
    const cathode = graph.net(comp.pins.cathode);
    const up = reach(graph, anode, { ledTraversal: 'upstream', isTarget: isSource, excludeComp: comp.id });
    const down = reach(graph, cathode, { ledTraversal: 'downstream', isTarget: isGround, excludeComp: comp.id });
    const lit = up.reachable && down.reachable;
    const burnout = lit && up.withoutResistor && down.withoutResistor;
    const state: LedState = {
      lit,
      brightness: lit ? up.bestDuty : 0,
      burnout,
    };
    leds[comp.id] = state;
    if (burnout) {
      diagnostics.push({
        level: 'error',
        message: 'LED has no resistor in series — on real hardware it would burn out!',
        componentId: comp.id,
      });
    }
  }

  // Live short circuit: a supply net that reaches a ground net through
  // zero resistance and no LED (LED case is reported as burnout above).
  for (const [n, i] of graph.info) {
    if (!isSource(i)) continue;
    if (i.isGround) {
      diagnostics.push({ level: 'error', message: 'Short circuit! A power source is wired directly to ground.' });
      break;
    }
    const r = reach(graph, n, { ledTraversal: 'none', isTarget: isGround });
    if (r.withoutResistor) {
      diagnostics.push({ level: 'error', message: 'Short circuit! Power reaches ground with no resistor in the path.' });
      break;
    }
  }

  // Motor speeds from the voltage across their terminals.
  const motors: Record<string, number> = {};
  for (const comp of circuit.components) {
    if (comp.kind !== 'motor') continue;
    const v1 = supplyVoltageOf(graph, graph.net(comp.pins.m1));
    const v2 = supplyVoltageOf(graph, graph.net(comp.pins.m2));
    motors[comp.id] = Math.max(-1, Math.min(1, (v1 - v2) / 5));
  }

  // digitalRead values for every D/A pin.
  const digitalReads: Record<PinName, 0 | 1> = {};
  const analogReads: Record<PinName, number> = {};
  const allPins = ALL_UNO_IO_PINS;

  // Map from net -> pot wipers on it, for analogRead interpolation.
  const potByWiperNet = new Map<string, PlacedComponent>();
  for (const comp of circuit.components) {
    if (comp.kind === 'potentiometer') potByWiperNet.set(graph.net(comp.pins.wiper), comp);
  }

  for (const pin of allPins) {
    const n = graph.net(`uno.${pin}`);
    const info = graph.info.get(n)!;
    // Exclude this pin's own drive when sensing (matters only for OUTPUT pins,
    // whose reads we don't care much about; keep it simple and include it).
    const toGround = reach(graph, n, { ledTraversal: 'downstream', isTarget: isGround });
    const toSource = reach(graph, n, { ledTraversal: 'upstream', isTarget: isSource });

    let value: 0 | 1;
    if (toGround.withoutResistor && !(isSource(info))) value = 0;
    else if (toSource.withoutResistor) value = 1;
    else if (toGround.reachable) value = 0;
    else if (toSource.reachable) value = 1;
    else value = info.pullup ? 1 : 0;
    digitalReads[pin] = value;

    if (ANALOG_PINS.has(pin)) {
      const pot = potByWiperNet.get(n);
      if (effects.analogVolts.has(n)) {
        analogReads[pin] = Math.round((effects.analogVolts.get(n)! / 5) * 1023);
      } else if (pot) {
        const v1 = supplyVoltageOf(graph, graph.net(pot.pins.end1));
        const v2 = supplyVoltageOf(graph, graph.net(pot.pins.end2));
        const t = pot.props.position ?? 0.5;
        const volts = v1 + (v2 - v1) * t;
        analogReads[pin] = Math.round((volts / 5) * 1023);
      } else if (toSource.reachable && !toGround.withoutResistor) {
        analogReads[pin] = 1023;
      } else if (toGround.reachable) {
        analogReads[pin] = 0;
      } else {
        analogReads[pin] = info.pullup ? 1023 : 0;
      }
    }
  }

  return {
    leds,
    motors,
    modulesPowered: effects.powered,
    dhtByPin: effects.dhtByPin,
    digitalReads,
    analogReads,
    diagnostics,
  };
}

/** Voltage a pot end sees: 5V-ish supply, ground, or 0 when floating. */
function supplyVoltageOf(graph: Graph, n: string): number {
  const info = graph.info.get(n);
  if (!info) return 0;
  if (info.isGround) return 0;
  if (info.sourceDuty !== null) return 5 * info.sourceDuty;
  const toSource = reach(graph, n, { ledTraversal: 'none', isTarget: isSource });
  if (toSource.reachable) return 5 * toSource.bestDuty;
  return 0; // grounded or floating
}

// ---------------------------------------------------------------------------
// Static analysis (when the circuit is edited) — wiring lint
// ---------------------------------------------------------------------------

export function analyzeStatic(circuit: Circuit): StaticAnalysis {
  // Potential-source/ground analysis is independent of the running sketch.
  const graph = buildGraph(circuit, { modes: {}, digital: {}, pwm: {} });
  const diagnostics: CircuitDiagnostic[] = [];

  // Hard short: a supply net (5V/3V3/battery +) is also a ground net purely
  // through wires.
  for (const [, i] of graph.info) {
    if (i.sourceDuty !== null && i.isGround) {
      diagnostics.push({
        level: 'error',
        message: 'Short circuit! Power (5V or battery +) is wired directly to GND. Remove the wire before powering the board.',
      });
      break;
    }
  }

  // Module power lint. A potentially-powered module's outputs can drive
  // anything, so mark them as potential sources/grounds for the LED lint below.
  const MODULE_TITLES: Partial<Record<string, string>> = {
    lm393: 'LM393 soil moisture sensor',
    dht11: 'DHT11 sensor',
    radar: 'Radar speed sensor',
    l298n: 'L298N motor driver',
  };
  const MODULE_OUT_ROLES: Partial<Record<string, string[]>> = {
    lm393: ['do', 'ao'],
    radar: ['ao'],
    l298n: ['out1', 'out2'],
  };
  for (const comp of circuit.components) {
    const title = MODULE_TITLES[comp.kind];
    if (!title) continue;
    if (!moduleIsPowered(graph, comp, true)) {
      diagnostics.push({
        level: 'hint',
        message: `The ${title} is not powered — connect VCC to 5V (or a battery +) and GND to GND.`,
        componentId: comp.id,
      });
      continue;
    }
    for (const role of MODULE_OUT_ROLES[comp.kind] ?? []) {
      const i = graph.info.get(graph.net(comp.pins[role]))!;
      i.potentialSource = true;
      i.potentialGround = true;
    }
  }

  for (const comp of circuit.components) {
    if (comp.kind !== 'led') continue;
    const anode = graph.net(comp.pins.anode);
    const cathode = graph.net(comp.pins.cathode);
    const up = reach(graph, anode, { ledTraversal: 'upstream', isTarget: isPotentialSource, excludeComp: comp.id });
    const down = reach(graph, cathode, { ledTraversal: 'downstream', isTarget: isPotentialGround, excludeComp: comp.id });

    if (up.reachable && down.reachable) {
      if (up.withoutResistor && down.withoutResistor) {
        diagnostics.push({
          level: 'warning',
          message: 'LED has no resistor in series — it will burn out. Add a resistor (e.g. 220 Ω).',
          componentId: comp.id,
        });
      }
      continue; // wired up fine
    }

    // Would it work flipped?
    const upR = reach(graph, cathode, { ledTraversal: 'upstream', isTarget: isPotentialSource, excludeComp: comp.id });
    const downR = reach(graph, anode, { ledTraversal: 'downstream', isTarget: isPotentialGround, excludeComp: comp.id });
    if (upR.reachable && downR.reachable) {
      diagnostics.push({
        level: 'warning',
        message: 'LED is reversed — current only flows from the long leg (+, anode) to the short leg (−, cathode). Flip it around.',
        componentId: comp.id,
      });
    } else {
      diagnostics.push({
        level: 'hint',
        message: 'LED is not in a complete circuit — check that one leg leads to a pin or 5V and the other leads to GND.',
        componentId: comp.id,
      });
    }
  }

  return { diagnostics };
}
