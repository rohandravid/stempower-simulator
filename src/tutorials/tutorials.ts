// Guided project tutorials: step-by-step walkthroughs with live checks.
// Each tutorial mirrors a demo from the Projects menu, but starts from an
// empty board and verifies the student's own circuit and code as they build.

import { UnionFind } from '../circuit/analysis';
import { groupKey, DEMO_SKETCH } from '../circuit/model';
import type { Circuit, ComponentKind, DynamicAnalysis, NodeId, PlacedComponent } from '../circuit/types';
import type { SimStatus } from '../sim/controller';

export interface TutorialCheckContext {
  circuit: Circuit;
  code: string;
  status: SimStatus;
  serial: string;
  dynamic: DynamicAnalysis;
}

export interface TutorialStep {
  title: string;
  /** Instruction text; blank lines split paragraphs. */
  body: string;
  /** Arduino code shown in a snippet box the student can copy into the editor. */
  code?: string;
  /** Short label for what the live check is waiting for. */
  checkLabel?: string;
  /** Live check; once it passes the step stays completed. */
  check?: (ctx: TutorialCheckContext) => boolean;
}

export interface Tutorial {
  demoId: string;
  name: string;
  starterCode: string;
  steps: TutorialStep[];
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

type Conn = (a: NodeId, b: NodeId) => boolean;

/** Connectivity through wires + the board's own groups (columns, rails, pins). */
function connectivity(circuit: Circuit): Conn {
  const uf = new UnionFind();
  for (const w of circuit.wires) {
    try {
      uf.union(groupKey(w.a), groupKey(w.b));
    } catch {
      // Wire to a node we can't classify — ignore it.
    }
  }
  return (a, b) => {
    try {
      return uf.find(groupKey(a)) === uf.find(groupKey(b));
    } catch {
      return false;
    }
  };
}

function find(circuit: Circuit, kind: ComponentKind): PlacedComponent | undefined {
  return circuit.components.find((c) => c.kind === kind);
}

function toGround(conn: Conn, node: NodeId): boolean {
  return conn(node, 'uno.GND1') || conn(node, 'uno.GND2');
}

function toSupply(conn: Conn, node: NodeId): boolean {
  return conn(node, 'uno.5V') || conn(node, 'uno.3V3');
}

/** `from` reaches ground through the resistor (either leg first). */
function throughResistorToGround(conn: Conn, from: NodeId, res: PlacedComponent): boolean {
  return (
    (conn(from, res.pins.p1) && toGround(conn, res.pins.p2)) ||
    (conn(from, res.pins.p2) && toGround(conn, res.pins.p1))
  );
}

function codeHas(code: string, ...patterns: RegExp[]): boolean {
  return patterns.every((p) => p.test(code));
}

/** The classic LED chain: pin -> anode, cathode -> resistor -> GND. */
function ledChainWired(ctx: TutorialCheckContext, pin: NodeId): boolean {
  const conn = connectivity(ctx.circuit);
  const led = find(ctx.circuit, 'led');
  const res = find(ctx.circuit, 'resistor');
  if (!led || !res) return false;
  return conn(pin, led.pins.anode) && throughResistorToGround(conn, led.pins.cathode, res);
}

/**
 * Same as ledChainWired, but for boards with more than one LED: finds *any*
 * LED (other than `excludeId`) wired pin -> anode, cathode -> resistor -> GND.
 */
function anyLedChainWired(ctx: TutorialCheckContext, pin: NodeId, excludeId?: string): PlacedComponent | undefined {
  const conn = connectivity(ctx.circuit);
  const resistors = ctx.circuit.components.filter((c) => c.kind === 'resistor');
  return ctx.circuit.components.find((c) => {
    if (c.kind !== 'led' || c.id === excludeId) return false;
    if (!conn(pin, c.pins.anode)) return false;
    return resistors.some((res) => throughResistorToGround(conn, c.pins.cathode, res));
  });
}

const STARTER_CODE = `void setup() {

}

void loop() {

}
`;

// ---------------------------------------------------------------------------
// Tutorial 1 — Blink + button
// ---------------------------------------------------------------------------

const BLINK_CODE = `const int LED_PIN = 13;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`;

const blinkTutorial: Tutorial = {
  demoId: 'blink',
  name: 'Blink + button',
  starterCode: STARTER_CODE,
  steps: [
    {
      title: 'Meet your lab bench',
      body: 'On the left is the Arduino Uno — the little computer that runs your code. Next to it is a breadboard, where parts plug in without soldering.\n\nSecret of the breadboard: all the holes in one column (within the top or bottom half) are connected to each other behind the scenes. Put two legs in the same column and they touch!',
    },
    {
      title: 'Add an LED',
      body: 'In the Parts panel on the left, click LED. It lands on the breadboard with two legs: the left leg is + (the anode) and the right leg is − (the cathode).\n\nCurrent only flows through an LED in one direction: from + to −.',
      checkLabel: 'Add an LED to the board',
      check: (ctx) => Boolean(find(ctx.circuit, 'led')),
    },
    {
      title: 'Add a resistor',
      body: 'Click Resistor in the Parts panel. LEDs are greedy — without a resistor to slow the current down, a real LED burns out in a flash (literally). 220 Ω is perfect.\n\nYou can drag parts around the breadboard if you want to rearrange them.',
      checkLabel: 'Add a resistor to the board',
      check: (ctx) => Boolean(find(ctx.circuit, 'resistor')),
    },
    {
      title: 'Wire power to the LED',
      body: "Time for your first wire! Tap pin 13 on the Uno (top row), then tap any hole in the same column as the LED's + leg (the left one).\n\nRemember: any hole in that column works — the breadboard connects the whole column.",
      checkLabel: 'Connect pin 13 to the LED’s + leg',
      check: (ctx) => {
        const led = find(ctx.circuit, 'led');
        return Boolean(led) && connectivity(ctx.circuit)('uno.D13', led!.pins.anode);
      },
    },
    {
      title: 'Complete the circuit',
      body: "Electricity needs a round trip: out of pin 13, through the LED, through the resistor, and back to GND.\n\nConnect the LED's − leg to the resistor: drag the resistor so one leg sits in the same column as the − leg, or add a wire between the two columns. Then wire the other resistor leg to a GND pin on the Uno.",
      checkLabel: 'LED − leg → resistor → GND',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const led = find(ctx.circuit, 'led');
        const res = find(ctx.circuit, 'resistor');
        return Boolean(led && res) && throughResistorToGround(conn, led!.pins.cathode, res!);
      },
    },
    {
      title: 'Write the blink code',
      body: 'Now let’s tell the Uno what to do. setup() runs once; loop() repeats forever. Type this into the Code tab (or use the button below):',
      code: BLINK_CODE,
      checkLabel: 'Code uses pinMode, digitalWrite and delay',
      check: (ctx) => codeHas(ctx.code, /pinMode\s*\(/, /digitalWrite\s*\(/, /delay\s*\(/),
    },
    {
      title: 'Run it!',
      body: 'Press the green Run button at the top. If your wiring and code are right, the LED blinks once a second.\n\nNot blinking? Check the Circuit check box under the canvas — it points out wiring problems.',
      checkLabel: 'Sketch running with the LED lit',
      check: (ctx) => ctx.status === 'running' && Object.values(ctx.dynamic.leds).some((l) => l.lit),
    },
    {
      title: 'Add a push button',
      body: 'Let’s make it interactive. Click Push button in the Parts panel. It bridges the gap in the middle of the breadboard: one leg in the top half, one in the bottom half. It only conducts while pressed.',
      checkLabel: 'Add a push button to the board',
      check: (ctx) => Boolean(find(ctx.circuit, 'button')),
    },
    {
      title: 'Wire the button',
      body: 'Wire pin 2 on the Uno to one button leg’s column, and the other leg’s column to GND.\n\nWe’ll use the Uno’s built-in pull-up resistor, so the pin reads HIGH normally and LOW while the button is pressed.',
      checkLabel: 'Pin 2 → button → GND',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const btn = find(ctx.circuit, 'button');
        if (!btn) return false;
        return (
          (conn('uno.D2', btn.pins.p1) && toGround(conn, btn.pins.p2)) ||
          (conn('uno.D2', btn.pins.p2) && toGround(conn, btn.pins.p1))
        );
      },
    },
    {
      title: 'Read the button in code',
      body: 'Replace your sketch with this one. INPUT_PULLUP switches on that built-in resistor, and digitalRead checks the pin: LOW means pressed.',
      code: DEMO_SKETCH,
      checkLabel: 'Code uses INPUT_PULLUP and digitalRead',
      check: (ctx) => codeHas(ctx.code, /INPUT_PULLUP/, /digitalRead\s*\(/),
    },
    {
      title: 'Press the button!',
      body: 'Run the sketch, then click and hold the button on the breadboard. The LED should stop blinking and stay on solid, and the Serial Monitor should say the button is pressed.',
      checkLabel: 'Hold the button while the sketch runs',
      check: (ctx) => {
        const btn = find(ctx.circuit, 'button');
        return ctx.status === 'running' && btn?.props.pressed === true;
      },
    },
    {
      title: 'You built it! 🎉',
      body: 'You just wired a real circuit and programmed it — that’s exactly how it works on physical hardware.\n\nTry making it yours: change the delay numbers to blink faster, or swap HIGH and LOW so the button turns the LED off instead. Ask Spark if you get stuck!',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tutorial 2 — Thirsty plant alarm
// ---------------------------------------------------------------------------

const PLANT_CODE = `const int SENSOR_PIN = 7;   // DO pin of the LM393
const int LED_PIN = 13;

void setup() {
  pinMode(SENSOR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int dry = digitalRead(SENSOR_PIN);  // HIGH = dry, LOW = wet
  if (dry == HIGH) {
    digitalWrite(LED_PIN, HIGH);
    Serial.println("Dry soil! Water the plant.");
  } else {
    digitalWrite(LED_PIN, LOW);
  }
  delay(200);
}
`;

const plantTutorial: Tutorial = {
  demoId: 'plant',
  name: 'Thirsty plant alarm',
  starterCode: STARTER_CODE,
  steps: [
    {
      title: 'The plan',
      body: 'We’ll build an alarm that lights an LED when a plant’s soil gets too dry, using an LM393 soil moisture sensor.\n\nThe sensor has a DO (digital output) pin that goes HIGH when the soil is dry and LOW when it’s wet — perfect for digitalRead.',
    },
    {
      title: 'Build the warning light',
      body: 'You know this part from the Blink project: add an LED and a resistor from the Parts panel.',
      checkLabel: 'LED and resistor on the board',
      check: (ctx) => Boolean(find(ctx.circuit, 'led') && find(ctx.circuit, 'resistor')),
    },
    {
      title: 'Wire the warning light',
      body: 'Wire pin 13 to the LED’s + column, the LED’s − column to one resistor leg, and the other resistor leg to GND.',
      checkLabel: 'Pin 13 → LED → resistor → GND',
      check: (ctx) => ledChainWired(ctx, 'uno.D13'),
    },
    {
      title: 'Add the soil sensor',
      body: 'Click Soil moisture in the Parts panel. The LM393 module appears below the boards with four pins: VCC (power in), GND, DO (digital out) and AO (analog out).\n\nIt also has a moisture slider — that’s our pretend soil.',
      checkLabel: 'Add the soil moisture sensor',
      check: (ctx) => Boolean(find(ctx.circuit, 'lm393')),
    },
    {
      title: 'Power the sensor',
      body: 'Modules need power before they can sense anything. Wire the Uno’s 5V pin to the sensor’s VCC, and the sensor’s GND to a GND pin on the Uno.',
      checkLabel: '5V → VCC and GND → GND',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const s = find(ctx.circuit, 'lm393');
        return Boolean(s) && toSupply(conn, s!.pins.vcc) && toGround(conn, s!.pins.gnd);
      },
    },
    {
      title: 'Connect the signal',
      body: 'Wire the sensor’s DO pin to pin 7 on the Uno. That’s the wire that carries the dry/wet message to your code.',
      checkLabel: 'DO → pin 7',
      check: (ctx) => {
        const s = find(ctx.circuit, 'lm393');
        return Boolean(s) && connectivity(ctx.circuit)(s!.pins.do, 'uno.D7');
      },
    },
    {
      title: 'Write the alarm code',
      body: 'Read the sensor, and use if / else to decide: dry means LED on and a warning in the Serial Monitor; wet means LED off.',
      code: PLANT_CODE,
      checkLabel: 'Code uses digitalRead and if / else',
      check: (ctx) => codeHas(ctx.code, /digitalRead\s*\(/, /if\s*\(/, /else/),
    },
    {
      title: 'Dry out the soil',
      body: 'Press Run, then drag the moisture slider on the sensor toward dry. The LED should switch on and the Serial Monitor should nag you to water the plant. Drag it back to wet and the alarm stops.',
      checkLabel: 'Running with dry soil and the LED lit',
      check: (ctx) => {
        const s = find(ctx.circuit, 'lm393');
        return (
          ctx.status === 'running' &&
          (s?.props.moisture ?? 1) < 0.5 &&
          Object.values(ctx.dynamic.leds).some((l) => l.lit)
        );
      },
    },
    {
      title: 'Plant saved! 🌱',
      body: 'You built a real sensor circuit: power, ground, and a signal wire — that pattern repeats in almost every electronics project.\n\nChallenge: use the AO pin with analogRead(A0) to print how dry the soil is as a number.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tutorial 3 — Weather station
// ---------------------------------------------------------------------------

const WEATHER_CODE = `#include <DHT.h>

DHT dht(2, DHT11);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  Serial.print("Temp: ");
  Serial.print(t);
  Serial.print(" C   Humidity: ");
  Serial.print(h);
  Serial.println(" %");
  delay(1000);
}
`;

const weatherTutorial: Tutorial = {
  demoId: 'weather',
  name: 'Weather station',
  starterCode: STARTER_CODE,
  steps: [
    {
      title: 'The plan',
      body: 'We’ll read temperature and humidity from a DHT11 sensor and print live readings to the Serial Monitor — a tiny weather station.\n\nThe DHT11 sends its readings over a single DATA wire using a special protocol, so we’ll use a library instead of digitalRead.',
    },
    {
      title: 'Add the DHT11',
      body: 'Click Temp & humidity in the Parts panel. The module has three pins: VCC, DATA and GND, plus T and H sliders so you can invent your own weather.',
      checkLabel: 'Add the DHT11 sensor',
      check: (ctx) => Boolean(find(ctx.circuit, 'dht11')),
    },
    {
      title: 'Wire it up',
      body: 'Three wires: the Uno’s 5V to VCC, DATA to pin 2, and GND to a GND pin on the Uno.\n\nPower, ground, signal — the same trio as every sensor.',
      checkLabel: '5V → VCC, DATA → pin 2, GND → GND',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const s = find(ctx.circuit, 'dht11');
        return (
          Boolean(s) &&
          toSupply(conn, s!.pins.vcc) &&
          toGround(conn, s!.pins.gnd) &&
          conn(s!.pins.data, 'uno.D2')
        );
      },
    },
    {
      title: 'Write the code',
      body: 'The DHT library does the hard work: dht.readTemperature() and dht.readHumidity() hand you the numbers, and Serial.print shows them.',
      code: WEATHER_CODE,
      checkLabel: 'Code uses the DHT library and Serial.print',
      check: (ctx) => codeHas(ctx.code, /#include\s*<DHT\.h>/, /readTemperature\s*\(/, /Serial\.print/),
    },
    {
      title: 'Run your station',
      body: 'Press Run and open the Serial Monitor tab. You should see a fresh temperature and humidity reading every second.',
      checkLabel: 'Readings appearing in the Serial Monitor',
      check: (ctx) => ctx.status === 'running' && ctx.serial.trim().length > 0,
    },
    {
      title: 'Make it a heatwave',
      body: 'Drag the T slider on the DHT11 up to 30 °C or more and watch the Serial Monitor follow along. That’s your simulated summer.',
      checkLabel: 'Temperature set to 30 °C or higher',
      check: (ctx) => {
        const s = find(ctx.circuit, 'dht11');
        return (s?.props.temperatureC ?? 0) >= 30;
      },
    },
    {
      title: 'Forecast complete! ⛅',
      body: 'You’ve used a library, floats, and the Serial Monitor — the everyday tools of Arduino programming.\n\nChallenge: add an LED that turns on when the temperature goes above 30 °C. You already know how to wire it!',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tutorial 4 — Motor speed control
// ---------------------------------------------------------------------------

const MOTOR_CODE = `const int ENA = 9;   // PWM speed pin
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

const motorTutorial: Tutorial = {
  demoId: 'motor',
  name: 'Motor speed control',
  starterCode: STARTER_CODE,
  steps: [
    {
      title: 'The plan',
      body: 'We’ll spin a DC motor and control its speed with a knob.\n\nKey idea: motors are power-hungry, so the Uno never drives one directly. A 9V battery supplies the muscle, and an L298N driver board is the middleman that lets the Uno’s tiny signals steer big currents.',
    },
    {
      title: 'Gather the big parts',
      body: 'From the Parts panel add three things: a 9V battery, a Motor driver (L298N), and a DC motor. They appear as modules below the boards — drag them apart if they crowd each other.',
      checkLabel: 'Battery, driver and motor on the canvas',
      check: (ctx) =>
        Boolean(find(ctx.circuit, 'battery') && find(ctx.circuit, 'l298n') && find(ctx.circuit, 'motor')),
    },
    {
      title: 'Power the driver',
      body: 'Wire the battery’s + to the driver’s 12V pin, and the battery’s − to the driver’s GND.\n\nThen add one more wire from the driver’s GND to a GND pin on the Uno. This shared ground lets the Uno and the driver agree on what "0 volts" means — without it, signals make no sense.',
      checkLabel: 'Battery → driver, plus a shared ground',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const bat = find(ctx.circuit, 'battery');
        const drv = find(ctx.circuit, 'l298n');
        if (!bat || !drv) return false;
        return (
          conn(bat.pins.plus, drv.pins.vcc) &&
          conn(bat.pins.minus, drv.pins.gnd) &&
          toGround(conn, drv.pins.gnd)
        );
      },
    },
    {
      title: 'Connect the motor',
      body: 'Wire the driver’s OUT1 to the motor’s M1, and OUT2 to M2. These carry the battery’s power to the motor, switched by the driver.',
      checkLabel: 'OUT1 → M1 and OUT2 → M2',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const drv = find(ctx.circuit, 'l298n');
        const mot = find(ctx.circuit, 'motor');
        if (!drv || !mot) return false;
        return (
          (conn(drv.pins.out1, mot.pins.m1) && conn(drv.pins.out2, mot.pins.m2)) ||
          (conn(drv.pins.out1, mot.pins.m2) && conn(drv.pins.out2, mot.pins.m1))
        );
      },
    },
    {
      title: 'Give the Uno the controls',
      body: 'Three signal wires from the Uno to the driver: pin 9 to ENA (speed — it’s a PWM pin), pin 8 to IN1 and pin 7 to IN2 (direction).',
      checkLabel: 'Pin 9 → ENA, pin 8 → IN1, pin 7 → IN2',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const drv = find(ctx.circuit, 'l298n');
        if (!drv) return false;
        return conn('uno.D9', drv.pins.ena) && conn('uno.D8', drv.pins.in1) && conn('uno.D7', drv.pins.in2);
      },
    },
    {
      title: 'Add the speed knob',
      body: 'Add a Knob (pot) from the Parts panel. Wire the Uno’s 5V to one end’s column, the middle pin (the wiper) to A0, and the other end to GND.\n\nTurning the knob slides the wiper between 0V and 5V, and analogRead turns that into a number from 0 to 1023.',
      checkLabel: '5V → end, wiper → A0, end → GND',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const pot = find(ctx.circuit, 'potentiometer');
        if (!pot) return false;
        const wiperOk = conn(pot.pins.wiper, 'uno.A0');
        const endsOk =
          (toSupply(conn, pot.pins.end1) && toGround(conn, pot.pins.end2)) ||
          (toSupply(conn, pot.pins.end2) && toGround(conn, pot.pins.end1));
        return wiperOk && endsOk;
      },
    },
    {
      title: 'Write the control code',
      body: 'Read the knob, then map its 0–1023 range onto the 0–255 range analogWrite understands, and send that to ENA as the speed.',
      code: MOTOR_CODE,
      checkLabel: 'Code uses analogRead, map and analogWrite',
      check: (ctx) => codeHas(ctx.code, /analogRead\s*\(/, /map\s*\(/, /analogWrite\s*\(/),
    },
    {
      title: 'Spin it up!',
      body: 'Press Run and drag the knob. The motor should spin, and the Serial Monitor shows the speed. Turn the knob all the way down and it stops.',
      checkLabel: 'Motor spinning while the sketch runs',
      check: (ctx) =>
        ctx.status === 'running' && Object.values(ctx.dynamic.motors).some((s) => Math.abs(s) > 0.05),
    },
    {
      title: 'Full speed ahead! 🏁',
      body: 'That was the hardest build in the lab: separate power, a shared ground, a driver chip and an analog input, all working together.\n\nChallenge: swap HIGH and LOW on IN1 and IN2 in the code and watch the motor reverse.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tutorial 5 — Speed trap
// ---------------------------------------------------------------------------

const SPEED_CODE = `const int SPEED_PIN = A0;    // AO pin of the radar sensor
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

const speedTrapTutorial: Tutorial = {
  demoId: 'speedtrap',
  name: 'Speed trap',
  starterCode: STARTER_CODE,
  steps: [
    {
      title: 'The plan',
      body: 'We’ll build a police speed trap: a radar sensor measures a passing car’s speed, and when it’s over the limit, red and blue lights alternate like a real patrol car.\n\nThe radar module has an AO (analog out) pin whose voltage rises with speed — perfect for analogRead.',
    },
    {
      title: 'Build the police lights',
      body: 'From the Parts panel, add two LEDs and two resistors — one pair for the red light, one pair for the blue light.',
      checkLabel: 'Two LEDs and two resistors on the board',
      check: (ctx) => {
        const leds = ctx.circuit.components.filter((c) => c.kind === 'led').length;
        const resistors = ctx.circuit.components.filter((c) => c.kind === 'resistor').length;
        return leds >= 2 && resistors >= 2;
      },
    },
    {
      title: 'Wire the red light',
      body: 'Wire pin 12 to one LED’s + column. Then wire that LED’s − column through a resistor to GND — same chain as every LED you’ve built.',
      checkLabel: 'Pin 12 → LED → resistor → GND',
      check: (ctx) => Boolean(anyLedChainWired(ctx, 'uno.D12')),
    },
    {
      title: 'Wire the blue light',
      body: 'Now do the same for the other LED: pin 13 → LED → resistor → GND. Use the second LED and resistor you added.',
      checkLabel: 'Pin 13 → a different LED → resistor → GND',
      check: (ctx) => {
        const red = anyLedChainWired(ctx, 'uno.D12');
        return Boolean(anyLedChainWired(ctx, 'uno.D13', red?.id));
      },
    },
    {
      title: 'Add the radar sensor',
      body: 'Click Speed sensor in the Parts panel. It lands as a module below the boards with three pins: VCC, GND, and AO — plus a speed slider so you can invent your own traffic.',
      checkLabel: 'Add the speed sensor',
      check: (ctx) => Boolean(find(ctx.circuit, 'radar')),
    },
    {
      title: 'Power the sensor',
      body: 'Wire the Uno’s 5V to the sensor’s VCC, and the sensor’s GND to a GND pin on the Uno.',
      checkLabel: '5V → VCC and GND → GND',
      check: (ctx) => {
        const conn = connectivity(ctx.circuit);
        const s = find(ctx.circuit, 'radar');
        return Boolean(s) && toSupply(conn, s!.pins.vcc) && toGround(conn, s!.pins.gnd);
      },
    },
    {
      title: 'Connect the signal',
      body: 'Wire the sensor’s AO pin to A0 on the Uno. That’s the analog voltage your code will read as a speed.',
      checkLabel: 'AO → A0',
      check: (ctx) => {
        const s = find(ctx.circuit, 'radar');
        return Boolean(s) && connectivity(ctx.circuit)(s!.pins.ao, 'uno.A0');
      },
    },
    {
      title: 'Write the speed-trap code',
      body: 'Read the sensor, convert it to mph with map(), and compare it to a speed limit. Over the limit? Alternate the red and blue LEDs. Under it? Keep both off.',
      code: SPEED_CODE,
      checkLabel: 'Code uses analogRead, map and if / else',
      check: (ctx) => codeHas(ctx.code, /analogRead\s*\(/, /map\s*\(/, /if\s*\(/, /else/),
    },
    {
      title: 'Catch a speeder!',
      body: 'Press Run, then drag the sensor’s speed slider above 55 mph. The red and blue LEDs should start alternating — busted! Drag it back down and the lights turn off.',
      checkLabel: 'Running with the sensor over the speed limit and a light lit',
      check: (ctx) => {
        const s = find(ctx.circuit, 'radar');
        return (
          ctx.status === 'running' &&
          (s?.props.speedMph ?? 0) > 55 &&
          Object.values(ctx.dynamic.leds).some((l) => l.lit)
        );
      },
    },
    {
      title: 'Busted! 🚨',
      body: 'You just built a real analog sensor circuit with two-way indicator logic — the same pattern behind traffic radar, alarms, and warning lights everywhere.\n\nChallenge: add a Serial.println() that only prints "SPEEDING!" when a car is over the limit.',
    },
  ],
};

// ---------------------------------------------------------------------------

export const TUTORIALS: Record<string, Tutorial> = {
  blink: blinkTutorial,
  plant: plantTutorial,
  weather: weatherTutorial,
  motor: motorTutorial,
  speedtrap: speedTrapTutorial,
};
