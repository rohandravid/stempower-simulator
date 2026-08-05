// Simulated Uno hardware: pin state driven by the sketch, reads answered from
// the latest circuit analysis, and a bounded serial buffer.

import { PWM_PINS } from '../circuit/model';
import type { PinMode, PinName, PinOutputs } from '../circuit/types';

/** What the interpreter needs from the machine it runs on. */
export interface MachineIO {
  pinMode(pin: number, mode: number): void;
  digitalWrite(pin: number, value: number): void;
  digitalRead(pin: number): number;
  analogWrite(pin: number, value: number): void;
  analogRead(pin: number): number;
  /** DHT11 reading on the given pin; NaN when no powered sensor is wired there. */
  dhtRead(pin: number, what: 'temperature' | 'humidity'): number;
  millis(): number;
  serialWrite(text: string): void;
}

const MODE_NAMES: Record<number, PinMode> = { 0: 'INPUT', 1: 'OUTPUT', 2: 'INPUT_PULLUP' };

/** Arduino pin number -> our pin name. 0-13 = D pins, 14-19 = A0-A5. */
export function pinName(pin: number): PinName {
  const p = Math.trunc(pin);
  if (p >= 0 && p <= 13) return `D${p}`;
  if (p >= 14 && p <= 19) return `A${p - 14}`;
  throw new Error(`Pin ${pin} does not exist on the Uno (use 0-13 or A0-A5).`);
}

const MAX_SERIAL_CHARS = 20000;

export class Hardware implements MachineIO {
  private modes = new Map<PinName, PinMode>();
  private digital = new Map<PinName, 0 | 1>();
  private pwm = new Map<PinName, number>();

  /** Bumped whenever outputs change, so the controller knows to re-analyze. */
  outputsVersion = 0;
  /** Bumped whenever serial output changes, for cheap React subscriptions. */
  serialVersion = 0;

  serialText = '';

  /** Supplied by the controller from the latest circuit analysis. */
  readDigital: (pin: PinName) => 0 | 1 = () => 0;
  readAnalog: (pin: PinName) => number = () => 0;
  readDht: (pin: PinName) => { temperatureC: number; humidityPct: number } | undefined = () => undefined;
  clock: () => number = () => 0;

  /** Clear pin state (keeps serial output so students can read it after Stop). */
  reset(): void {
    this.modes.clear();
    this.digital.clear();
    this.pwm.clear();
    this.outputsVersion += 1;
  }

  clearSerial(): void {
    this.serialText = '';
    this.serialVersion += 1;
  }

  snapshotOutputs(): PinOutputs {
    return {
      modes: Object.fromEntries(this.modes),
      digital: Object.fromEntries(this.digital),
      pwm: Object.fromEntries(this.pwm),
    };
  }

  // --- MachineIO -----------------------------------------------------------

  pinMode(pin: number, mode: number): void {
    const name = pinName(pin);
    const m = MODE_NAMES[mode];
    if (!m) throw new Error(`Unknown pin mode ${mode} — use INPUT, OUTPUT or INPUT_PULLUP.`);
    this.modes.set(name, m);
    this.outputsVersion += 1;
  }

  digitalWrite(pin: number, value: number): void {
    const name = pinName(pin);
    this.digital.set(name, value ? 1 : 0);
    this.pwm.delete(name); // digitalWrite cancels PWM on the pin
    if (!this.modes.has(name)) this.modes.set(name, 'OUTPUT'); // forgiving default
    this.outputsVersion += 1;
  }

  digitalRead(pin: number): number {
    const name = pinName(pin);
    if (this.modes.get(name) === 'OUTPUT') return this.digital.get(name) ?? 0;
    return this.readDigital(name);
  }

  analogWrite(pin: number, value: number): void {
    const name = pinName(pin);
    const v = Math.max(0, Math.min(255, Math.trunc(value)));
    if (!this.modes.has(name)) this.modes.set(name, 'OUTPUT');
    if (PWM_PINS.has(name)) {
      this.pwm.set(name, v);
      this.digital.delete(name);
    } else {
      // Real Unos fall back to plain HIGH/LOW on non-PWM pins.
      this.digital.set(name, v >= 128 ? 1 : 0);
      this.pwm.delete(name);
    }
    this.outputsVersion += 1;
  }

  analogRead(pin: number): number {
    // Accept both analogRead(0) and analogRead(A0) i.e. 14.
    const p = Math.trunc(pin);
    const name = p >= 0 && p <= 5 ? `A${p}` : pinName(p);
    if (!name.startsWith('A')) {
      throw new Error(`analogRead needs an analog pin (A0-A5), got pin ${pin}.`);
    }
    return this.readAnalog(name);
  }

  dhtRead(pin: number, what: 'temperature' | 'humidity'): number {
    const reading = this.readDht(pinName(pin));
    if (!reading) return NaN;
    return what === 'temperature' ? reading.temperatureC : reading.humidityPct;
  }

  millis(): number {
    return this.clock();
  }

  serialWrite(text: string): void {
    this.serialText += text;
    if (this.serialText.length > MAX_SERIAL_CHARS) {
      // Trim to the last newline within budget so lines stay whole.
      const excess = this.serialText.length - MAX_SERIAL_CHARS;
      const cut = this.serialText.indexOf('\n', excess);
      this.serialText = cut >= 0 ? this.serialText.slice(cut + 1) : this.serialText.slice(excess);
    }
    this.serialVersion += 1;
  }
}
