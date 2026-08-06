// Core circuit data types shared by the model, analysis, simulator and UI.

/**
 * A connection point on the board.
 * Formats:
 *   'uno.D13' | 'uno.A0' | 'uno.5V' | 'uno.3V3' | 'uno.GND1' | 'uno.GND2'
 *   'bb.a12'          breadboard hole, row a-j, column 1-30
 *   'bb.top+.5'       power rail hole: top+/top-/bot+/bot-, index 1-30
 *   'mod.<compId>.<role>'  a pin on a free-floating module (LM393, DHT11, …)
 */
export type NodeId = string;

/** Arduino pin name: 'D0'..'D13' or 'A0'..'A5'. */
export type PinName = string;

export type ComponentKind =
  | 'led'
  | 'resistor'
  | 'button'
  | 'potentiometer'
  | 'lm393'
  | 'dht11'
  | 'radar'
  | 'l298n'
  | 'motor'
  | 'battery';

/** Kinds that float freely on the canvas instead of plugging into the breadboard. */
export const MODULE_KINDS: ReadonlySet<ComponentKind> = new Set([
  'lm393', 'dht11', 'radar', 'l298n', 'motor', 'battery',
]);

export interface ComponentProps {
  /** LED color (css color for the lens). */
  color?: string;
  /** Resistor value in ohms (display only). */
  ohms?: number;
  /** Push button state (live-toggled during simulation). */
  pressed?: boolean;
  /** Potentiometer wiper travel 0..1 (0 = at end1, 1 = at end2). */
  position?: number;
  /** LM393 soil moisture: 0..1 (0 = bone dry, 1 = soaked), set by dragging. */
  moisture?: number;
  /** DHT11: simulated readings, set by dragging the module's sliders. */
  temperatureC?: number;
  humidityPct?: number;
  /** Radar speed sensor: simulated target speed in mph, set by dragging the module's slider. */
  speedMph?: number;
}

export interface PlacedComponent {
  id: string;
  kind: ComponentKind;
  /**
   * Pin role -> board node.
   *   led: anode, cathode
   *   resistor: p1, p2
   *   button: p1, p2   (conducts when pressed)
   *   potentiometer: end1, wiper, end2
   *   lm393: vcc, gnd, do, ao        (module — pins are its own mod.* nodes)
   *   dht11: vcc, data, gnd
   *   radar: vcc, gnd, ao
   *   l298n: vcc, gnd, ena, in1, in2, out1, out2
   *   motor: m1, m2
   *   battery: plus, minus
   */
  pins: Record<string, NodeId>;
  props: ComponentProps;
  /** Top-left canvas position — only for MODULE_KINDS. */
  pos?: { x: number; y: number };
}

export interface Wire {
  id: string;
  a: NodeId;
  b: NodeId;
  color: string;
}

export interface Circuit {
  components: PlacedComponent[];
  wires: Wire[];
}

export type PinMode = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP';

/** Electrical state of the Uno's pins as driven by the running sketch. */
export interface PinOutputs {
  modes: Partial<Record<PinName, PinMode>>;
  /** Last digitalWrite value for OUTPUT pins. */
  digital: Partial<Record<PinName, 0 | 1>>;
  /** Last analogWrite duty (0..255); takes precedence over `digital` when set. */
  pwm: Partial<Record<PinName, number>>;
}

export const IDLE_PIN_OUTPUTS: PinOutputs = { modes: {}, digital: {}, pwm: {} };

export interface LedState {
  lit: boolean;
  /** 0..1; follows PWM duty when driven by analogWrite. */
  brightness: number;
  /** Lit with a zero-resistance path on both sides — would burn out. */
  burnout: boolean;
}

export type DiagnosticLevel = 'error' | 'warning' | 'hint';

export interface CircuitDiagnostic {
  level: DiagnosticLevel;
  message: string;
  componentId?: string;
}

/** Recomputed every simulation tick from circuit + pin outputs. */
export interface DynamicAnalysis {
  leds: Record<string, LedState>;
  /** Motor speed per motor component id, -1..1 (sign = direction). */
  motors: Record<string, number>;
  /** True per module id when its VCC/GND are actually powered right now. */
  modulesPowered: Record<string, boolean>;
  /** DHT11 readings keyed by the Uno pin their DATA line connects to. */
  dhtByPin: Record<PinName, { temperatureC: number; humidityPct: number }>;
  /** Value seen by digitalRead for every pin (already accounting for INPUT_PULLUP). */
  digitalReads: Record<PinName, 0 | 1>;
  /** Value seen by analogRead for A0..A5, 0..1023. */
  analogReads: Record<PinName, number>;
  /** Live electrical faults (e.g. short through a pressed button). */
  diagnostics: CircuitDiagnostic[];
}

/** Recomputed when the circuit itself changes; static wiring lint. */
export interface StaticAnalysis {
  diagnostics: CircuitDiagnostic[];
}
