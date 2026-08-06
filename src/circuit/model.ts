// Board geometry, node bookkeeping, component placement and the demo circuit.
// All coordinates are in SVG user units (viewBox 0 0 1000 430).

import { MODULE_KINDS } from './types';
import type { Circuit, ComponentKind, NodeId, PinName, PlacedComponent, Wire } from './types';

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

export const VIEW_W = 1000;
export const VIEW_H = 640;

/** Y where freshly added modules land (below the Uno + breadboard). */
export const MODULE_STRIP_Y = 470;

/** Breadboard layout. */
export const BB = {
  x: 400,
  y: 30,
  cols: 30,
  pitch: 18,
  left: 26, // offset of column 1 from board edge
};

export const BB_ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
export type BbRow = (typeof BB_ROWS)[number];
export const RAILS = ['top+', 'top-', 'bot+', 'bot-'] as const;
export type Rail = (typeof RAILS)[number];

/** Vertical offset (in pitch units from BB.y) of each breadboard row of holes. */
const ROW_OFFSET: Record<string, number> = {
  'top+': 1.0,
  'top-': 2.0,
  a: 3.6,
  b: 4.6,
  c: 5.6,
  d: 6.6,
  e: 7.6,
  f: 9.4,
  g: 10.4,
  h: 11.4,
  i: 12.4,
  j: 13.4,
  'bot+': 15.0,
  'bot-': 16.0,
};

export const BB_W = BB.left * 2 + (BB.cols - 1) * BB.pitch;
export const BB_H = (ROW_OFFSET['bot-'] + 1.2) * BB.pitch;

/** Uno board layout. */
export const UNO = { x: 20, y: 60, w: 340, h: 250 };

export const UNO_DIGITAL: PinName[] = [
  'D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0',
];
export const UNO_POWER: PinName[] = ['3V3', '5V', 'GND1', 'GND2'];
export const UNO_ANALOG: PinName[] = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

export const PWM_PINS = new Set<PinName>(['D3', 'D5', 'D6', 'D9', 'D10', 'D11']);
export const ANALOG_PINS = new Set<PinName>(UNO_ANALOG);

const UNO_PIN_PITCH = 22;

export interface BoardNode {
  id: NodeId;
  x: number;
  y: number;
  label: string;
  /** Short label drawn next to the hole (empty for breadboard grid holes). */
  kind: 'uno' | 'bb' | 'rail';
}

function unoPinNodes(): BoardNode[] {
  const nodes: BoardNode[] = [];
  // Digital header along the top edge, D13 leftmost.
  UNO_DIGITAL.forEach((pin, i) => {
    nodes.push({
      id: `uno.${pin}`,
      x: UNO.x + 30 + i * UNO_PIN_PITCH,
      y: UNO.y + 14,
      label: pin.replace(/^D/, ''),
      kind: 'uno',
    });
  });
  // Power + analog header along the bottom edge.
  const bottom = [...UNO_POWER, ...UNO_ANALOG];
  bottom.forEach((pin, i) => {
    nodes.push({
      id: `uno.${pin}`,
      x: UNO.x + 52 + i * UNO_PIN_PITCH,
      y: UNO.y + UNO.h - 14,
      label: pin.startsWith('GND') ? 'GND' : pin,
      kind: 'uno',
    });
  });
  return nodes;
}

function bbNodes(): BoardNode[] {
  const nodes: BoardNode[] = [];
  for (const rail of RAILS) {
    for (let c = 1; c <= BB.cols; c++) {
      nodes.push({
        id: `bb.${rail}.${c}`,
        x: BB.x + BB.left + (c - 1) * BB.pitch,
        y: BB.y + ROW_OFFSET[rail] * BB.pitch,
        label: '',
        kind: 'rail',
      });
    }
  }
  for (const row of BB_ROWS) {
    for (let c = 1; c <= BB.cols; c++) {
      nodes.push({
        id: `bb.${row}${c}`,
        x: BB.x + BB.left + (c - 1) * BB.pitch,
        y: BB.y + ROW_OFFSET[row] * BB.pitch,
        label: '',
        kind: 'bb',
      });
    }
  }
  return nodes;
}

export const ALL_NODES: BoardNode[] = [...unoPinNodes(), ...bbNodes()];

const NODE_BY_ID = new Map(ALL_NODES.map((n) => [n.id, n]));

export function nodePosition(id: NodeId): { x: number; y: number } {
  const n = NODE_BY_ID.get(id);
  if (!n) throw new Error(`Unknown node: ${id}`);
  return { x: n.x, y: n.y };
}

export function isValidNode(id: NodeId): boolean {
  return NODE_BY_ID.has(id);
}

/** Nearest board node within maxDist of (x, y), or null. */
export function nearestNode(x: number, y: number, maxDist = 12): BoardNode | null {
  let best: BoardNode | null = null;
  let bestD = maxDist * maxDist;
  for (const n of ALL_NODES) {
    const d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
    if (d <= bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Electrical grouping — which holes are intrinsically the same net
// ---------------------------------------------------------------------------

/**
 * Nodes with the same group key are permanently connected by the board itself:
 * breadboard column halves (a-e / f-j), whole power rails, single Uno pins.
 * Module pins are each their own net.
 */
export function groupKey(id: NodeId): string {
  const parts = id.split('.');
  if (parts[0] === 'uno') return `uno:${parts[1]}`;
  if (parts[0] === 'mod') return `mod:${parts[1]}:${parts[2]}`;
  if (parts[0] === 'bb') {
    if (parts.length === 3) return `rail:${parts[1]}`; // bb.top+.5
    const row = parts[1][0];
    const col = parts[1].slice(1);
    return 'abcde'.includes(row) ? `col:${col}:A` : `col:${col}:B`;
  }
  throw new Error(`Unknown node: ${id}`);
}

/** Uno pin name from a node id like 'uno.D13', or null. */
export function unoPinOf(id: NodeId): PinName | null {
  return id.startsWith('uno.') ? id.slice(4) : null;
}

// ---------------------------------------------------------------------------
// Modules (free-floating parts with their own pins)
// ---------------------------------------------------------------------------

export interface ModulePinDef {
  role: string;
  label: string;
  /** Offset of the pin from the module's top-left `pos`. */
  dx: number;
  dy: number;
}

export interface ModuleDef {
  w: number;
  h: number;
  title: string;
  pins: ModulePinDef[];
}

export const MODULE_DEFS: Partial<Record<ComponentKind, ModuleDef>> = {
  lm393: {
    w: 96,
    h: 70,
    title: 'Soil moisture',
    pins: [
      { role: 'vcc', label: 'VCC', dx: 12, dy: 70 },
      { role: 'gnd', label: 'GND', dx: 36, dy: 70 },
      { role: 'do', label: 'DO', dx: 60, dy: 70 },
      { role: 'ao', label: 'AO', dx: 84, dy: 70 },
    ],
  },
  dht11: {
    w: 84,
    h: 74,
    title: 'DHT11',
    pins: [
      { role: 'vcc', label: 'VCC', dx: 14, dy: 74 },
      { role: 'data', label: 'DATA', dx: 42, dy: 74 },
      { role: 'gnd', label: 'GND', dx: 70, dy: 74 },
    ],
  },
  radar: {
    w: 100,
    h: 76,
    title: 'Speed sensor',
    pins: [
      { role: 'vcc', label: 'VCC', dx: 16, dy: 76 },
      { role: 'gnd', label: 'GND', dx: 50, dy: 76 },
      { role: 'ao', label: 'AO', dx: 84, dy: 76 },
    ],
  },
  l298n: {
    w: 132,
    h: 88,
    title: 'L298N motor driver',
    pins: [
      { role: 'vcc', label: '12V', dx: 14, dy: 88 },
      { role: 'gnd', label: 'GND', dx: 38, dy: 88 },
      { role: 'ena', label: 'ENA', dx: 66, dy: 88 },
      { role: 'in1', label: 'IN1', dx: 90, dy: 88 },
      { role: 'in2', label: 'IN2', dx: 114, dy: 88 },
      { role: 'out1', label: 'OUT1', dx: 132, dy: 26 },
      { role: 'out2', label: 'OUT2', dx: 132, dy: 58 },
    ],
  },
  motor: {
    w: 78,
    h: 78,
    title: 'DC motor',
    pins: [
      { role: 'm1', label: 'M1', dx: 0, dy: 26 },
      { role: 'm2', label: 'M2', dx: 0, dy: 54 },
    ],
  },
  battery: {
    w: 80,
    h: 54,
    title: '9V battery',
    pins: [
      { role: 'plus', label: '+', dx: 80, dy: 16 },
      { role: 'minus', label: '−', dx: 80, dy: 40 },
    ],
  },
};

export function isModule(kind: ComponentKind): boolean {
  return MODULE_KINDS.has(kind);
}

export function modulePinNode(compId: string, role: string): NodeId {
  return `mod.${compId}.${role}`;
}

/** Position of any node, including module pins (which live on the circuit). */
export function resolveNodePosition(circuit: Circuit, id: NodeId): { x: number; y: number } {
  if (id.startsWith('mod.')) {
    const [, compId, role] = id.split('.');
    const comp = circuit.components.find((c) => c.id === compId);
    const def = comp && MODULE_DEFS[comp.kind];
    const pin = def?.pins.find((p) => p.role === role);
    if (!comp || !def || !pin || !comp.pos) throw new Error(`Unknown module pin: ${id}`);
    return { x: comp.pos.x + pin.dx, y: comp.pos.y + pin.dy };
  }
  return nodePosition(id);
}

export interface WireTarget {
  id: NodeId;
  x: number;
  y: number;
}

/** Every node a wire may attach to: board nodes + all module pins. */
export function allWireTargets(circuit: Circuit): WireTarget[] {
  const targets: WireTarget[] = ALL_NODES.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  for (const comp of circuit.components) {
    const def = MODULE_DEFS[comp.kind];
    if (!def || !comp.pos) continue;
    for (const pin of def.pins) {
      targets.push({ id: modulePinNode(comp.id, pin.role), x: comp.pos.x + pin.dx, y: comp.pos.y + pin.dy });
    }
  }
  return targets;
}

/** Nearest wireable node within maxDist of (x, y), or null. */
export function nearestTarget(circuit: Circuit, x: number, y: number, maxDist = 12): WireTarget | null {
  let best: WireTarget | null = null;
  let bestD = maxDist * maxDist;
  for (const t of allWireTargets(circuit)) {
    const d = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** First free spot in the module strip for a module of the given size. */
function freeModulePos(circuit: Circuit, w: number, h: number): { x: number; y: number } {
  const others = circuit.components.filter((c) => c.pos && MODULE_DEFS[c.kind]);
  const overlaps = (x: number, y: number): boolean =>
    others.some((c) => {
      const d = MODULE_DEFS[c.kind]!;
      return x < c.pos!.x + d.w + 24 && x + w + 24 > c.pos!.x && y < c.pos!.y + d.h + 24 && y + h + 24 > c.pos!.y;
    });
  for (let y = MODULE_STRIP_Y; y + h < VIEW_H - 8; y += 40) {
    for (let x = 20; x + w < VIEW_W - 8; x += 20) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 20, y: MODULE_STRIP_Y };
}

export function makeModule(circuit: Circuit, kind: ComponentKind, at?: { x: number; y: number }): PlacedComponent {
  const def = MODULE_DEFS[kind];
  if (!def) throw new Error(`${kind} is not a module`);
  const id = freshId(kind.slice(0, 3));
  const pins: Record<string, NodeId> = {};
  for (const pin of def.pins) pins[pin.role] = modulePinNode(id, pin.role);
  const props: PlacedComponent['props'] = {};
  if (kind === 'lm393') props.moisture = 0.7;
  if (kind === 'dht11') {
    props.temperatureC = 24;
    props.humidityPct = 60;
  }
  if (kind === 'radar') props.speedMph = 35;
  return { id, kind, pins, props, pos: at ?? freeModulePos(circuit, def.w, def.h) };
}

// ---------------------------------------------------------------------------
// Component construction & placement
// ---------------------------------------------------------------------------

let idCounter = 0;
export function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

/** Pin roles per breadboard kind, in the order legs appear when placed. */
export const PIN_ROLES: Partial<Record<ComponentKind, string[]>> = {
  led: ['anode', 'cathode'],
  resistor: ['p1', 'p2'],
  button: ['p1', 'p2'],
  potentiometer: ['end1', 'wiper', 'end2'],
};

/**
 * Default hole layout for a breadboard part anchored at column `col`.
 * Buttons bridge the center channel; everything else sits in the top half.
 */
export function defaultPins(kind: ComponentKind, col: number): Record<string, NodeId> {
  switch (kind) {
    case 'led':
      return { anode: `bb.b${col}`, cathode: `bb.b${col + 1}` };
    case 'resistor':
      return { p1: `bb.d${col}`, p2: `bb.d${col + 3}` };
    case 'button':
      return { p1: `bb.e${col}`, p2: `bb.f${col}` };
    case 'potentiometer':
      return { end1: `bb.g${col}`, wiper: `bb.g${col + 1}`, end2: `bb.g${col + 2}` };
    default:
      throw new Error(`${kind} is a module — use makeModule`);
  }
}

/** Number of breadboard columns a freshly placed part spans. */
const KIND_SPAN: Partial<Record<ComponentKind, number>> = {
  led: 2,
  resistor: 4,
  button: 1,
  potentiometer: 3,
};

const LED_COLORS = ['#e63b3b', '#3bd05e', '#ffd23b', '#3b8fe6'];

export function makeComponent(kind: ComponentKind, col: number): PlacedComponent {
  const id = freshId(kind.slice(0, 3));
  const props: PlacedComponent['props'] = {};
  if (kind === 'led') props.color = LED_COLORS[idCounter % LED_COLORS.length];
  if (kind === 'resistor') props.ohms = 220;
  if (kind === 'button') props.pressed = false;
  if (kind === 'potentiometer') props.position = 0.5;
  return { id, kind, pins: defaultPins(kind, col), props };
}

/** Breadboard column groups (col + half) already used by a component leg. */
function occupiedGroups(circuit: Circuit): Set<string> {
  const used = new Set<string>();
  for (const comp of circuit.components) {
    for (const node of Object.values(comp.pins)) {
      if (node.startsWith('bb.')) used.add(groupKey(node));
    }
  }
  return used;
}

/** True if every leg of `pins` lands in a column group no other component uses. */
export function placementIsFree(circuit: Circuit, pins: Record<string, NodeId>, ignoreId?: string): boolean {
  const others: Circuit = {
    components: circuit.components.filter((c) => c.id !== ignoreId),
    wires: [],
  };
  const used = occupiedGroups(others);
  for (const node of Object.values(pins)) {
    if (!isValidNode(node)) return false;
    if (node.startsWith('bb.') && !node.includes('+') && !node.includes('-')) {
      if (used.has(groupKey(node))) return false;
    }
  }
  return true;
}

/**
 * Looser check for moving an existing part: legs may land in a column group
 * another part already uses — that's how parts connect without wires — but
 * never in the exact same hole as another leg.
 */
export function placementHolesFree(circuit: Circuit, pins: Record<string, NodeId>, ignoreId?: string): boolean {
  const taken = new Set<NodeId>();
  for (const comp of circuit.components) {
    if (comp.id === ignoreId) continue;
    for (const node of Object.values(comp.pins)) taken.add(node);
  }
  return Object.values(pins).every((node) => isValidNode(node) && !taken.has(node));
}

/** Place a new part: modules land in the strip below, legs on free columns. */
export function autoPlace(circuit: Circuit, kind: ComponentKind): PlacedComponent | null {
  if (isModule(kind)) return makeModule(circuit, kind);
  const span = KIND_SPAN[kind]!;
  for (let col = 1; col + span - 1 <= BB.cols; col++) {
    const pins = defaultPins(kind, col);
    if (placementIsFree(circuit, pins)) {
      const comp = makeComponent(kind, col);
      comp.pins = pins;
      return comp;
    }
  }
  return null;
}

export function makeWire(a: NodeId, b: NodeId, color = '#2e7d32'): Wire {
  return { id: freshId('w'), a, b, color };
}

// ---------------------------------------------------------------------------
// Demo circuit: D13 -> LED -> 220R -> GND, and D2 -> button -> GND (pullup)
// ---------------------------------------------------------------------------

export function demoCircuit(): Circuit {
  const led: PlacedComponent = {
    id: freshId('led'),
    kind: 'led',
    pins: { anode: 'bb.b5', cathode: 'bb.b6' },
    props: { color: '#e63b3b' },
  };
  const resistor: PlacedComponent = {
    id: freshId('res'),
    kind: 'resistor',
    pins: { p1: 'bb.d6', p2: 'bb.d9' },
    props: { ohms: 220 },
  };
  const button: PlacedComponent = {
    id: freshId('but'),
    kind: 'button',
    pins: { p1: 'bb.e15', p2: 'bb.f15' },
    props: { pressed: false },
  };
  return {
    components: [led, resistor, button],
    wires: [
      makeWire('uno.D13', 'bb.a5', '#e6a23b'),
      makeWire('bb.a9', 'uno.GND1', '#444444'),
      makeWire('uno.D2', 'bb.a15', '#3b8fe6'),
      makeWire('bb.j15', 'uno.GND2', '#444444'),
    ],
  };
}

export const DEMO_SKETCH = `// Blink an LED and read a button.
// Press Run, then try pressing the button on the breadboard!

const int LED_PIN = 13;
const int BUTTON_PIN = 2;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(BUTTON_PIN) == LOW) {
    // Button pressed: LED on solid
    digitalWrite(LED_PIN, HIGH);
    Serial.println("Button pressed!");
    delay(100);
  } else {
    // Blink
    digitalWrite(LED_PIN, HIGH);
    delay(500);
    digitalWrite(LED_PIN, LOW);
    delay(500);
  }
}
`;

// ---------------------------------------------------------------------------
// Demo library — each example is a matching circuit + sketch
// ---------------------------------------------------------------------------

function thirstyPlantCircuit(): Circuit {
  const led: PlacedComponent = {
    id: freshId('led'), kind: 'led',
    pins: { anode: 'bb.b5', cathode: 'bb.b6' }, props: { color: '#ffd23b' },
  };
  const resistor: PlacedComponent = {
    id: freshId('res'), kind: 'resistor',
    pins: { p1: 'bb.d6', p2: 'bb.d9' }, props: { ohms: 220 },
  };
  const base: Circuit = { components: [led, resistor], wires: [] };
  const sensor = makeModule(base, 'lm393', { x: 430, y: MODULE_STRIP_Y });
  return {
    components: [...base.components, sensor],
    wires: [
      makeWire('uno.D13', 'bb.a5', '#e6a23b'),
      makeWire('bb.a9', 'uno.GND1', '#444444'),
      makeWire('uno.5V', sensor.pins.vcc, '#e63b3b'),
      makeWire(sensor.pins.gnd, 'uno.GND2', '#444444'),
      makeWire(sensor.pins.do, 'uno.D7', '#3b8fe6'),
    ],
  };
}

const THIRSTY_PLANT_SKETCH = `// Thirsty plant alarm: the LED turns on when the soil gets dry.
// Drag the moisture slider on the LM393 module and watch!

const int SENSOR_PIN = 7;   // DO pin of the LM393
const int LED_PIN = 13;

void setup() {
  pinMode(SENSOR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int dry = digitalRead(SENSOR_PIN);  // HIGH = dry soil, LOW = wet soil
  if (dry == HIGH) {
    digitalWrite(LED_PIN, HIGH);
    Serial.println("Dry soil! Water the plant.");
  } else {
    digitalWrite(LED_PIN, LOW);
  }
  delay(200);
}
`;

function weatherCircuit(): Circuit {
  const base: Circuit = { components: [], wires: [] };
  const dht = makeModule(base, 'dht11', { x: 440, y: MODULE_STRIP_Y });
  return {
    components: [dht],
    wires: [
      makeWire('uno.5V', dht.pins.vcc, '#e63b3b'),
      makeWire(dht.pins.data, 'uno.D2', '#3b8fe6'),
      makeWire(dht.pins.gnd, 'uno.GND2', '#444444'),
    ],
  };
}

const WEATHER_SKETCH = `// Weather station: read temperature and humidity.
// Drag the T and H sliders on the DHT11 module!
#include <DHT.h>

DHT dht(2, DHT11);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Check the DHT11 wiring!");
  } else {
    Serial.print("Temp: ");
    Serial.print(t);
    Serial.print(" C   Humidity: ");
    Serial.print(h);
    Serial.println(" %");
  }
  delay(1000);
}
`;

function motorCircuit(): Circuit {
  const pot: PlacedComponent = {
    id: freshId('pot'), kind: 'potentiometer',
    pins: { end1: 'bb.g20', wiper: 'bb.g21', end2: 'bb.g22' }, props: { position: 0.5 },
  };
  let base: Circuit = { components: [pot], wires: [] };
  const battery = makeModule(base, 'battery', { x: 40, y: MODULE_STRIP_Y + 16 });
  base = { components: [...base.components, battery], wires: [] };
  const driver = makeModule(base, 'l298n', { x: 260, y: MODULE_STRIP_Y });
  base = { components: [...base.components, driver], wires: [] };
  const motor = makeModule(base, 'motor', { x: 640, y: MODULE_STRIP_Y + 4 });
  return {
    components: [pot, battery, driver, motor],
    wires: [
      makeWire(battery.pins.plus, driver.pins.vcc, '#e63b3b'),
      makeWire(battery.pins.minus, driver.pins.gnd, '#444444'),
      makeWire(driver.pins.gnd, 'uno.GND1', '#444444'),
      makeWire('uno.D9', driver.pins.ena, '#9c27b0'),
      makeWire('uno.D8', driver.pins.in1, '#3b8fe6'),
      makeWire('uno.D7', driver.pins.in2, '#2e7d32'),
      makeWire(driver.pins.out1, motor.pins.m1, '#e6a23b'),
      makeWire(driver.pins.out2, motor.pins.m2, '#e6a23b'),
      makeWire('uno.5V', 'bb.j20', '#e63b3b'),
      makeWire('bb.j21', 'uno.A0', '#3b8fe6'),
      makeWire('bb.j22', 'uno.GND2', '#444444'),
    ],
  };
}

const MOTOR_SKETCH = `// Motor control: turn the knob to change the motor speed.

const int ENA = 9;   // PWM speed pin
const int IN1 = 8;   // direction
const int IN2 = 7;
const int KNOB = A0;

void setup() {
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int knob = analogRead(KNOB);
  int speed = map(knob, 0, 1023, 0, 255);
  digitalWrite(IN1, HIGH);   // forward
  digitalWrite(IN2, LOW);
  analogWrite(ENA, speed);
  Serial.print("Speed: ");
  Serial.println(speed);
  delay(200);
}
`;

function speedTrapCircuit(): Circuit {
  const redLed: PlacedComponent = {
    id: freshId('led'), kind: 'led',
    pins: { anode: 'bb.b5', cathode: 'bb.b6' }, props: { color: '#e63b3b' },
  };
  const redRes: PlacedComponent = {
    id: freshId('res'), kind: 'resistor',
    pins: { p1: 'bb.d6', p2: 'bb.d9' }, props: { ohms: 220 },
  };
  const blueLed: PlacedComponent = {
    id: freshId('led'), kind: 'led',
    pins: { anode: 'bb.b12', cathode: 'bb.b13' }, props: { color: '#3b8fe6' },
  };
  const blueRes: PlacedComponent = {
    id: freshId('res'), kind: 'resistor',
    pins: { p1: 'bb.d13', p2: 'bb.d16' }, props: { ohms: 220 },
  };
  const base: Circuit = { components: [redLed, redRes, blueLed, blueRes], wires: [] };
  const sensor = makeModule(base, 'radar', { x: 440, y: MODULE_STRIP_Y });
  return {
    components: [...base.components, sensor],
    wires: [
      makeWire('uno.D12', 'bb.a5', '#e63b3b'),
      makeWire('bb.a9', 'uno.GND1', '#444444'),
      makeWire('uno.D13', 'bb.a12', '#3b8fe6'),
      makeWire('bb.a16', 'uno.GND2', '#444444'),
      makeWire('uno.5V', sensor.pins.vcc, '#e6a23b'),
      makeWire(sensor.pins.gnd, 'uno.GND1', '#444444'),
      makeWire(sensor.pins.ao, 'uno.A0', '#9c27b0'),
    ],
  };
}

const SPEED_TRAP_SKETCH = `// Speed trap: catch speeders with a radar sensor and flashing lights.
// Drag the speed slider on the radar module and watch what happens!

const int SPEED_PIN = A0;    // AO pin of the radar sensor
const int RED_PIN = 12;
const int BLUE_PIN = 13;
const int SPEED_LIMIT = 55;  // mph

void setup() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int reading = analogRead(SPEED_PIN);
  int mph = map(reading, 0, 1023, 0, 100);
  Serial.print("Speed: ");
  Serial.print(mph);
  Serial.println(" mph");

  if (mph > SPEED_LIMIT) {
    // Busted! Alternate red and blue like a police light.
    digitalWrite(RED_PIN, HIGH);
    digitalWrite(BLUE_PIN, LOW);
    delay(200);
    digitalWrite(RED_PIN, LOW);
    digitalWrite(BLUE_PIN, HIGH);
    delay(200);
  } else {
    digitalWrite(RED_PIN, LOW);
    digitalWrite(BLUE_PIN, LOW);
    delay(200);
  }
}
`;

export interface Demo {
  id: string;
  name: string;
  /** One-line description shown in the Projects menu. */
  blurb: string;
  /** Concepts the project teaches, shown as small chips. */
  teaches: string[];
  build: () => Circuit;
  sketch: string;
}

export const DEMOS: Demo[] = [
  {
    id: 'blink', name: 'Blink + button',
    blurb: 'Make an LED blink, then control it with a push button.',
    teaches: ['digitalWrite', 'digitalRead', 'INPUT_PULLUP'],
    build: demoCircuit, sketch: DEMO_SKETCH,
  },
  {
    id: 'plant', name: 'Thirsty plant alarm',
    blurb: 'A soil moisture sensor warns you when a plant needs water.',
    teaches: ['sensors', 'digitalRead', 'if / else'],
    build: thirstyPlantCircuit, sketch: THIRSTY_PLANT_SKETCH,
  },
  {
    id: 'weather', name: 'Weather station',
    blurb: 'Read temperature and humidity from a DHT11 sensor.',
    teaches: ['sensors', 'Serial', 'float'],
    build: weatherCircuit, sketch: WEATHER_SKETCH,
  },
  {
    id: 'motor', name: 'Motor speed control',
    blurb: 'Spin a DC motor and set its speed with a knob.',
    teaches: ['analogRead', 'analogWrite', 'map'],
    build: motorCircuit, sketch: MOTOR_SKETCH,
  },
  {
    id: 'speedtrap', name: 'Speed trap',
    blurb: 'A radar sensor triggers alternating red/blue lights when a car speeds past.',
    teaches: ['analogRead', 'map', 'if / else'],
    build: speedTrapCircuit, sketch: SPEED_TRAP_SKETCH,
  },
];
