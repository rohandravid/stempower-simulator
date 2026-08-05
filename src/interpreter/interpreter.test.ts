import { describe, expect, it } from 'vitest';
import { SketchParseError, SketchRuntimeError } from './errors';
import { SketchRunner } from './interpreter';
import { parseSketch } from './parser';
import type { MachineIO } from '../sim/hardware';

interface FakeIO extends MachineIO {
  time: number;
  serial: string;
  events: Array<{ t: number; op: string; pin: number; value: number }>;
  digitalIn: Record<number, number>;
  analogIn: Record<number, number>;
  dht: Record<number, { temperature: number; humidity: number }>;
}

function fakeIO(): FakeIO {
  const io: FakeIO = {
    time: 0,
    serial: '',
    events: [],
    digitalIn: {},
    analogIn: {},
    dht: {},
    dhtRead: (pin, what) => io.dht[pin]?.[what] ?? NaN,
    pinMode: (pin, mode) => io.events.push({ t: io.time, op: 'pinMode', pin, value: mode }),
    digitalWrite: (pin, value) => io.events.push({ t: io.time, op: 'digitalWrite', pin, value }),
    digitalRead: (pin) => io.digitalIn[pin] ?? 0,
    analogWrite: (pin, value) => io.events.push({ t: io.time, op: 'analogWrite', pin, value }),
    // Accept both analogRead(0) and analogRead(A0) i.e. 14, like real hardware.
    analogRead: (pin) => io.analogIn[pin >= 14 ? pin - 14 : pin] ?? 0,
    millis: () => io.time,
    serialWrite: (text) => {
      io.serial += text;
    },
  };
  return io;
}

/**
 * Run a sketch with a fake clock, fast-forwarding through delay()s,
 * until simulated `maxMs` or `maxSteps` generator resumptions.
 */
function runSketch(source: string, { maxMs = 5000, maxSteps = 2000, io = fakeIO() } = {}): FakeIO {
  const runner = new SketchRunner(parseSketch(source), io);
  const gen = runner.run();
  for (let steps = 0; steps < maxSteps; steps++) {
    const r = gen.next();
    if (r.done) break;
    if (r.value.type === 'delay') io.time = r.value.untilMs;
    if (io.time >= maxMs) break;
  }
  return io;
}

const wrap = (body: string, setup = ''): string => `void setup() { ${setup} } void loop() { ${body} }`;

describe('blink timing', () => {
  it('toggles D13 every 500 simulated ms', () => {
    const io = runSketch(`
      void setup() { pinMode(13, OUTPUT); }
      void loop() {
        digitalWrite(13, HIGH);
        delay(500);
        digitalWrite(13, LOW);
        delay(500);
      }
    `, { maxMs: 2600 });
    const writes = io.events.filter((e) => e.op === 'digitalWrite');
    expect(writes.slice(0, 5)).toEqual([
      { t: 0, op: 'digitalWrite', pin: 13, value: 1 },
      { t: 500, op: 'digitalWrite', pin: 13, value: 0 },
      { t: 1000, op: 'digitalWrite', pin: 13, value: 1 },
      { t: 1500, op: 'digitalWrite', pin: 13, value: 0 },
      { t: 2000, op: 'digitalWrite', pin: 13, value: 1 },
    ]);
  });

  it('millis() tracks the clock', () => {
    const io = runSketch(wrap('', 'delay(123); Serial.println(millis());'), { maxMs: 1000 });
    expect(io.serial.startsWith('123\n')).toBe(true);
  });
});

describe('control flow and expressions', () => {
  it('for loop, +=, integer division, modulo', () => {
    const io = runSketch(wrap('', `
      int sum = 0;
      for (int i = 1; i <= 10; i++) { sum += i; }
      Serial.println(sum);
      Serial.println(7 / 2);
      Serial.println(7 % 3);
      Serial.println(7.0 / 2);
    `), { maxMs: 100 });
    expect(io.serial).toContain('55\n');
    expect(io.serial).toContain('3\n');
    expect(io.serial).toContain('1\n');
    expect(io.serial).toContain('3.50\n');
  });

  it('while / break / continue', () => {
    const io = runSketch(wrap('', `
      int i = 0;
      int hits = 0;
      while (true) {
        i++;
        if (i > 20) break;
        if (i % 2 == 0) continue;
        hits++;
      }
      Serial.println(hits);
    `), { maxMs: 100 });
    expect(io.serial).toContain('10\n');
  });

  it('ternary, logical ops, comparisons', () => {
    const io = runSketch(wrap('', `
      int a = 5;
      Serial.println(a > 3 && a < 10 ? 1 : 0);
      Serial.println(a == 5 || false);
      Serial.println(!true);
    `), { maxMs: 100 });
    expect(io.serial.slice(0, 6)).toBe('1\n1\n0\n');
  });

  it('do-while runs at least once', () => {
    const io = runSketch(wrap('', 'int i = 100; do { Serial.println(i); i++; } while (i < 3);'), { maxMs: 100 });
    expect(io.serial).toContain('100\n');
  });
});

describe('functions', () => {
  it('user functions with params and return values', () => {
    const io = runSketch(`
      int add(int a, int b) { return a + b; }
      float half(float x) { return x / 2; }
      void setup() {
        Serial.println(add(2, 3));
        Serial.println(half(7));
      }
      void loop() {}
    `, { maxMs: 100 });
    expect(io.serial).toContain('5\n');
    expect(io.serial).toContain('3.50\n');
  });

  it('recursion works (factorial)', () => {
    const io = runSketch(`
      int fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
      void setup() { Serial.println(fact(6)); }
      void loop() {}
    `, { maxMs: 100 });
    expect(io.serial).toContain('720\n');
  });

  it('infinite recursion stops with a friendly error', () => {
    const io = fakeIO();
    const runner = new SketchRunner(parseSketch(`
      void boom() { boom(); }
      void setup() { boom(); }
      void loop() {}
    `), io);
    const gen = runner.run();
    expect(() => {
      for (let i = 0; i < 100000; i++) {
        if (gen.next().done) break;
      }
    }).toThrowError(/calling itself forever/);
  });

  it('globals initialize in order and are visible in loop', () => {
    const io = runSketch(`
      int counter = 40;
      int doubled = counter + 2;
      void setup() {}
      void loop() { Serial.println(doubled); delay(1000); }
    `, { maxMs: 500 });
    expect(io.serial).toContain('42\n');
  });
});

describe('#define and #include', () => {
  it('expands simple defines and strips includes', () => {
    const io = runSketch(`
      #include <Arduino.h>
      #define LED_PIN 9
      #define DELAY_MS 250
      void setup() { pinMode(LED_PIN, OUTPUT); }
      void loop() { digitalWrite(LED_PIN, HIGH); delay(DELAY_MS); }
    `, { maxMs: 300 });
    expect(io.events[0]).toMatchObject({ op: 'pinMode', pin: 9 });
    expect(io.events[1]).toMatchObject({ op: 'digitalWrite', pin: 9, value: 1 });
  });

  it('rejects function-like macros with a clear message', () => {
    expect(() => parseSketch('#define SQ(x) ((x)*(x))\nvoid setup(){} void loop(){}'))
      .toThrowError(/Function-like #define/);
  });
});

describe('Serial formatting', () => {
  it('formats ints, floats, chars, strings and bases', () => {
    const io = runSketch(wrap('', `
      Serial.print("v=");
      Serial.println(42);
      Serial.println(3.14159);
      Serial.println('A');
      Serial.println(255, 16);
      Serial.println(true);
    `), { maxMs: 100 });
    expect(io.serial).toBe('v=42\n3.14\nA\nFF\n1\n');
  });
});

describe('parse errors carry positions', () => {
  it('missing semicolon', () => {
    try {
      parseSketch('void setup() {\n  int x = 1\n  int y = 2;\n}\nvoid loop() {}');
      expect.unreachable();
    } catch (e) {
      const err = e as SketchParseError;
      expect(err).toBeInstanceOf(SketchParseError);
      expect(err.line).toBe(3); // error surfaces at the token after the missing ;
      expect(err.message).toContain(';');
    }
  });

  it('unclosed brace points at the opening line', () => {
    try {
      parseSketch('void setup() {\n  int x = 1;\n');
      expect.unreachable();
    } catch (e) {
      const err = e as SketchParseError;
      expect(err.message).toMatch(/never closed/);
      expect(err.line).toBe(1); // points at the { that was never closed
    }
  });

  it('a function started inside another function is called out', () => {
    expect(() => parseSketch('void setup() {\nvoid loop() {}'))
      .toThrowError(/inside another function/);
  });

  it('arrays, String and switch produce friendly not-supported errors', () => {
    expect(() => parseSketch('void setup() { int a[3]; } void loop() {}')).toThrowError(/Arrays are not supported/);
    expect(() => parseSketch('String s; void setup() {} void loop() {}')).toThrowError(/String class is not supported/);
    expect(() => parseSketch('void setup() { switch (1) {} } void loop() {}')).toThrowError(/switch is not supported/);
  });

  it('requires setup and loop', () => {
    expect(() => new SketchRunner(parseSketch('void loop() {}'), fakeIO())).toThrowError(/setup/);
    expect(() => new SketchRunner(parseSketch('void setup() {}'), fakeIO())).toThrowError(/loop/);
  });
});

describe('runtime errors carry lines', () => {
  function runExpectError(source: string): SketchRuntimeError {
    const runner = new SketchRunner(parseSketch(source), fakeIO());
    const gen = runner.run();
    try {
      for (let i = 0; i < 100000; i++) {
        if (gen.next().done) break;
      }
    } catch (e) {
      return e as SketchRuntimeError;
    }
    throw new Error('expected a runtime error');
  }

  it('undefined variable', () => {
    const err = runExpectError('void setup() {\n  x = 5;\n}\nvoid loop() {}');
    expect(err).toBeInstanceOf(SketchRuntimeError);
    expect(err.line).toBe(2);
    expect(err.message).toContain('"x" is not defined');
  });

  it('division by zero', () => {
    const err = runExpectError('void setup() {\n  int z = 0;\n  int y = 5 / z;\n}\nvoid loop() {}');
    expect(err.line).toBe(3);
    expect(err.message).toMatch(/zero/);
  });

  it('bad pin number from hardware surfaces with the call line', () => {
    const io = fakeIO();
    io.pinMode = () => {
      throw new Error('Pin 99 does not exist on the Uno (use 0-13 or A0-A5).');
    };
    const runner = new SketchRunner(parseSketch('void setup() {\n  pinMode(99, OUTPUT);\n}\nvoid loop() {}'), io);
    const gen = runner.run();
    try {
      for (let i = 0; i < 1000; i++) gen.next();
      expect.unreachable();
    } catch (e) {
      const err = e as SketchRuntimeError;
      expect(err).toBeInstanceOf(SketchRuntimeError);
      expect(err.line).toBe(2);
      expect(err.message).toContain('Pin 99');
    }
  });

  it('const cannot be reassigned', () => {
    const err = runExpectError('const int K = 1;\nvoid setup() {\n  K = 2;\n}\nvoid loop() {}');
    expect(err.message).toMatch(/constant/);
  });
});

describe('infinite loops yield instead of hanging', () => {
  it('while(true) {} in setup keeps yielding ticks', () => {
    const runner = new SketchRunner(parseSketch('void setup() { while (true) {} } void loop() {}'), fakeIO());
    const gen = runner.run();
    let ticks = 0;
    for (let i = 0; i < 200; i++) {
      const r = gen.next();
      expect(r.done).toBe(false);
      if (!r.done && r.value.type === 'tick') ticks++;
    }
    expect(ticks).toBe(200);
  });

  it('empty loop() also yields', () => {
    const runner = new SketchRunner(parseSketch('void setup() {} void loop() {}'), fakeIO());
    const gen = runner.run();
    for (let i = 0; i < 50; i++) {
      expect(gen.next().done).toBe(false);
    }
  });
});

describe('DHT sensor library', () => {
  const sketch = `
    #include <DHT.h>
    #define DHTPIN 2
    DHT dht(DHTPIN, DHT11);
    void setup() {
      Serial.begin(9600);
      dht.begin();
      float t = dht.readTemperature();
      float h = dht.readHumidity();
      if (isnan(t)) Serial.println("no sensor");
      else { Serial.print(t); Serial.print(" "); Serial.println(h); }
    }
    void loop() {}
  `;

  it('reads temperature and humidity from the machine', () => {
    const io = fakeIO();
    io.dht[2] = { temperature: 31.5, humidity: 72 };
    runSketch(sketch, { maxMs: 50, io });
    expect(io.serial).toContain('31.50 72.00');
  });

  it('returns nan when nothing is wired, and isnan catches it', () => {
    const io = runSketch(sketch, { maxMs: 50 });
    expect(io.serial).toContain('no sensor');
  });

  it('prints nan like real Arduino', () => {
    const io = runSketch(`
      DHT dht(2, DHT11);
      void setup() { Serial.println(dht.readTemperature()); }
      void loop() {}
    `, { maxMs: 50 });
    expect(io.serial).toContain('nan');
  });

  it('unknown DHT methods get a friendly error', () => {
    const io = fakeIO();
    const runner = new SketchRunner(parseSketch('DHT dht(2, DHT11);\nvoid setup() { dht.readPressure(); }\nvoid loop() {}'), io);
    const gen = runner.run();
    expect(() => {
      for (let i = 0; i < 1000; i++) gen.next();
    }).toThrowError(/readTemperature/);
  });
});

describe('hardware-facing builtins', () => {
  it('digitalRead and analogRead pull from the machine', () => {
    const io = fakeIO();
    io.digitalIn[2] = 1;
    io.analogIn[0] = 700;
    runSketch(wrap('', `
      pinMode(2, INPUT_PULLUP);
      Serial.println(digitalRead(2));
      Serial.println(analogRead(A0));
      Serial.println(map(analogRead(A0), 0, 1023, 0, 100));
    `), { maxMs: 50, io });
    expect(io.serial).toContain('1\n');
    expect(io.serial).toContain('700\n');
    expect(io.serial).toContain('68\n'); // 700*100/1023 truncated
  });

  it('random is deterministic after randomSeed', () => {
    const a = runSketch(wrap('', 'randomSeed(7); Serial.println(random(100)); Serial.println(random(10, 20));'), { maxMs: 50 });
    const b = runSketch(wrap('', 'randomSeed(7); Serial.println(random(100)); Serial.println(random(10, 20));'), { maxMs: 50 });
    expect(a.serial).toBe(b.serial);
    const [first, second] = a.serial.trim().split('\n').map(Number);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);
    expect(second).toBeGreaterThanOrEqual(10);
    expect(second).toBeLessThan(20);
  });
});
