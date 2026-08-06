# StemPower Arduino Lab

A free, browser-based Arduino simulator built for StemPower's classrooms: a drag-and-drop
circuit builder, a real code editor, and student code that actually drives the simulated
circuit — plus an optional AI tutor.

![Stack](https://img.shields.io/badge/stack-Vite%20%2B%20React%2018%20%2B%20TypeScript-blue)

## Quick start

```bash
npm install
npm run dev          # simulator at http://localhost:5173
```

That's it — the simulator is fully usable with no configuration. A demo circuit
(blinking LED + push button) and matching sketch are preloaded; press **Run**.

### Optional: the AI tutor

The "AI Helper" chat panel needs a small local server with an Anthropic API key:

```bash
cp .env.example server/.env    # then paste your ANTHROPIC_API_KEY into it
npm run server                 # starts http://localhost:8917 (Vite proxies /api to it)
```

Without the key the panel politely disables itself; the simulator is unaffected.

## What students can do

- **Build circuits** on an SVG Uno + half-size breadboard: LEDs, resistors, push
  buttons, a potentiometer, an LM393 soil moisture sensor module, a DHT11
  temperature/humidity sensor, a radar speed sensor, an L298N motor driver, a
  DC motor, and a 9V battery pack. Tap a hole, then another hole, to run a
  wire. Drag parts to move them (legs snap to holes). Tap a part to select
  it, then Delete (key or button) to remove it. Reversed a LED? Select it and
  hit **Flip LED** instead of rewiring.
- **Sensor and driver modules** (LM393, DHT11, radar, L298N) float below the
  breadboard and wire up with normal wires like any other part. Each shows a
  green power dot once it's correctly powered. The LM393 has a draggable
  dry↔wet moisture slider and exposes both a DO (digital: HIGH when the soil
  is dry) and AO (analog: voltage rises as the soil dries) output. The DHT11 has
  draggable T (temperature) and H (humidity) sliders and is read from code
  with `#include <DHT.h>`, `DHT dht(2, DHT11);`, `dht.readTemperature()`,
  `dht.readHumidity()`, and `isnan()` for sensor-error checks. The radar speed
  sensor has a draggable 0–100 mph slider and exposes an AO (analog: voltage
  rises with speed) output, read with `analogRead()`. The L298N takes
  an ENA PWM speed input plus IN1/IN2 direction pins and drives the animated
  DC motor (leave ENA unwired and it behaves like the board's factory
  jumper — full speed); the motor's rotor visibly shows current speed and
  direction.
- **Write real Arduino code** in a CodeMirror editor with C++ highlighting and
  error markers. Supported: `setup`/`loop`, variables (`int`, `float`, `bool`,
  `char`, `const`), `if`/`else`, `while`, `do`/`while`, `for`, `break`/`continue`,
  functions with parameters and return values, recursion, `#define`, and the
  core API: `pinMode`, `digitalWrite`, `digitalRead`, `analogWrite` (PWM),
  `analogRead`, `delay`, `millis`, `map`, `constrain`, `min`/`max`/`abs`/`pow`/`sqrt`,
  `random`/`randomSeed`, and `Serial.print`/`println` (with float digits and
  number bases).
- **Run it for real**: `digitalWrite(13, HIGH)` lights the LED wired to pin 13 —
  through the actual electrical connectivity of the breadboard (column groups,
  power rails, wires, component conduction). PWM dims the LED. `INPUT_PULLUP`
  works the way the classic button lesson expects. The pot and the LM393/DHT11
  modules drive `analogRead`/`digitalRead` the same way.
- **Get diagnostics**: "LED has no resistor — it will burn out", reversed-LED
  and open-circuit hints, short-circuit detection, and parse/runtime errors with
  line numbers in plain language.
- **Interact live**: hold the button cap, twist the pot knob, drag the LM393
  moisture slider, drag the DHT11's T/H sliders, or drag the radar sensor's
  speed slider while the sketch runs; the serial monitor streams output.
- **Load a project** from the toolbar's **Projects** menu: Blink + button,
  Thirsty plant alarm (LM393), Weather station (DHT11), Motor speed
  control (L298N), and Speed trap (radar sensor + alternating red/blue LEDs)
  each swap in a matching circuit and sketch. **Clear circuit** wipes the
  board back to empty when you want to start from scratch.

## Architecture

```
src/
├── interpreter/   Arduino C++ subset → tokenizer → parser → generator-based VM
├── circuit/       breadboard/Uno model + electrical analysis (union-find nets,
│                  reachability for LED state, reads and wiring lint)
├── sim/           hardware pin state + run controller (rAF loop, 4ms budget)
├── components/    React UI (SVG canvas, editor, serial, diagnostics, AI chat)
└── i18n/          all UI strings in one module (Hindi = a dictionary away)
server/index.mjs   one Express endpoint → Claude API (the AI tutor)
```

Design decisions worth knowing:

- **Source-level interpreter instead of avr8js.** avr8js executes compiled AVR
  hex, which requires an avr-gcc compile server — real infrastructure and more
  failure modes. A bounded interpreter "compiles" instantly, gives friendly
  line-numbered errors, and is heavily unit-tested. avr8js remains on the
  roadmap as a high-accuracy mode.
- **The VM is generator-based** and time-budgeted per animation frame (~4 ms),
  so `while (true) {}` can never freeze the browser tab.
- **`delay()` runs in real time** (`millis()` tracks the wall clock), so blink
  timing looks like real hardware.
- **Electrical model**: breadboard column halves, rails, and Uno pins are nets
  (union-find, merged by wires); components are conditional edges (resistor
  always conducts, button when pressed, LED forward-only). An LED lights when
  its anode reaches a supply and its cathode reaches ground; a zero-resistance
  path on both sides flags burnout.

## Testing

```bash
npm test           # vitest: 94 tests — interpreter, circuit analysis, controller, app smoke
npm run build      # tsc type-check + production build
```

The interpreter and circuit analysis (the two riskiest modules) carry the bulk
of the test suite: blink timing, control flow, functions/recursion, `#define`,
Serial formatting, parse-error positions, infinite-loop yielding, pullup button
reads, reversed/missing-resistor/short detection, module analysis (LM393
DO/AO thresholds, DHT11 reads, L298N ENA/direction → motor speed), and a full
demo-circuit integration test through the controller, plus the radar sensor's
AO-to-speed scaling and its speed-trap demo.

## Known limitations (v1)

- Interpreter subset: no arrays, pointers, `String` class, `switch`, or type
  casts yet — each produces a clear "not supported yet" error with a line number.
- Numbers are JS doubles; 16-bit `int` overflow is not emulated (`int` division
  and modulo are truncated correctly).
- No serial *input* (`Serial.available()` returns 0, `Serial.read()` returns −1).
- `tone()` has no buzzer component yet, so it's still unsupported.
- DHT11 is the only supported sensor library (`#include <DHT.h>`); no others.
- Module simulation is one-pass: a module's outputs can't feed another
  module's inputs in the same tick (e.g. chaining an LM393 into an L298N
  input isn't modeled).
- Online only (plain static site — no PWA/offline caching yet, by design: fewer
  stale-cache bugs).

## Roadmap

- More components (buzzer + `tone()`, RGB LED, servo, LCD)
- Serial input box
- Hindi UI (strings are already centralized)
- Save/load + shareable circuit links
- Offline PWA mode
- avr8js high-accuracy execution mode

Built for [StemPower] — teaching Arduino to students everywhere.
