import { describe, expect, it } from 'vitest';
import { analyzeDynamic, analyzeStatic } from './analysis';
import { DEMOS, makeModule, makeWire } from './model';
import type { Circuit, PinOutputs, PlacedComponent } from './types';

function outputs(partial: Partial<PinOutputs> = {}): PinOutputs {
  return { modes: {}, digital: {}, pwm: {}, ...partial };
}

function led(id: string, anode: string, cathode: string): PlacedComponent {
  return { id, kind: 'led', pins: { anode, cathode }, props: {} };
}

describe('LM393 soil moisture sensor', () => {
  function circuitWith(moisture: number, extraWires: (s: PlacedComponent) => ReturnType<typeof makeWire>[]): Circuit {
    const sensor = makeModule({ components: [], wires: [] }, 'lm393', { x: 400, y: 470 });
    sensor.props.moisture = moisture;
    return {
      components: [sensor],
      wires: [
        makeWire('uno.5V', sensor.pins.vcc),
        makeWire(sensor.pins.gnd, 'uno.GND1'),
        ...extraWires(sensor),
      ],
    };
  }

  it('DO reads HIGH when the soil is dry and LOW when wet', () => {
    const dry = circuitWith(0.1, (s) => [makeWire(s.pins.do, 'uno.D7')]);
    expect(analyzeDynamic(dry, outputs({ modes: { D7: 'INPUT' } })).digitalReads.D7).toBe(1);

    const wet = circuitWith(0.9, (s) => [makeWire(s.pins.do, 'uno.D7')]);
    expect(analyzeDynamic(wet, outputs({ modes: { D7: 'INPUT' } })).digitalReads.D7).toBe(0);
  });

  it('AO feeds analogRead, rising as the soil dries', () => {
    const half = circuitWith(0.5, (s) => [makeWire(s.pins.ao, 'uno.A0')]);
    expect(analyzeDynamic(half, outputs()).analogReads.A0).toBe(512);
    const dry = circuitWith(0, (s) => [makeWire(s.pins.ao, 'uno.A0')]);
    expect(analyzeDynamic(dry, outputs()).analogReads.A0).toBe(1023);
    const soaked = circuitWith(1, (s) => [makeWire(s.pins.ao, 'uno.A0')]);
    expect(analyzeDynamic(soaked, outputs()).analogReads.A0).toBe(0);
  });

  it('does nothing when unpowered, and static lint says so', () => {
    const sensor = makeModule({ components: [], wires: [] }, 'lm393', { x: 400, y: 470 });
    sensor.props.moisture = 0.1;
    const circuit: Circuit = {
      components: [sensor],
      wires: [makeWire(sensor.pins.do, 'uno.D7')], // no VCC/GND
    };
    const dyn = analyzeDynamic(circuit, outputs({ modes: { D7: 'INPUT' } }));
    expect(dyn.modulesPowered[sensor.id]).toBe(false);
    expect(dyn.digitalReads.D7).toBe(0);
    expect(analyzeStatic(circuit).diagnostics.some((d) => d.message.includes('not powered'))).toBe(true);
  });

  it('can drive an LED from DO (dry soil turns it on)', () => {
    const sensor = makeModule({ components: [], wires: [] }, 'lm393', { x: 400, y: 470 });
    sensor.props.moisture = 0.1;
    const resistor: PlacedComponent = { id: 'r1', kind: 'resistor', pins: { p1: 'bb.d6', p2: 'bb.d9' }, props: {} };
    const circuit: Circuit = {
      components: [sensor, led('led1', 'bb.b5', 'bb.b6'), resistor],
      wires: [
        makeWire('uno.5V', sensor.pins.vcc),
        makeWire(sensor.pins.gnd, 'uno.GND1'),
        makeWire(sensor.pins.do, 'bb.a5'),
        makeWire('bb.a9', 'uno.GND2'),
      ],
    };
    expect(analyzeDynamic(circuit, outputs()).leds.led1.lit).toBe(true);
    expect(analyzeStatic(circuit).diagnostics).toEqual([]); // powered + complete circuit
    sensor.props.moisture = 0.9;
    expect(analyzeDynamic(circuit, outputs()).leds.led1.lit).toBe(false);
  });
});

describe('DHT11', () => {
  it('exposes readings on the pin its DATA line reaches, only when powered', () => {
    const dht = makeModule({ components: [], wires: [] }, 'dht11', { x: 400, y: 470 });
    dht.props.temperatureC = 31;
    dht.props.humidityPct = 72;
    const circuit: Circuit = {
      components: [dht],
      wires: [
        makeWire('uno.5V', dht.pins.vcc),
        makeWire(dht.pins.data, 'uno.D2'),
        makeWire(dht.pins.gnd, 'uno.GND1'),
      ],
    };
    const dyn = analyzeDynamic(circuit, outputs());
    expect(dyn.dhtByPin.D2).toEqual({ temperatureC: 31, humidityPct: 72 });
    expect(dyn.dhtByPin.D3).toBeUndefined();

    // Unplug VCC: no readings.
    const unpowered: Circuit = { ...circuit, wires: circuit.wires.slice(1) };
    expect(analyzeDynamic(unpowered, outputs()).dhtByPin.D2).toBeUndefined();
  });
});

describe('L298N + motor + battery', () => {
  function rig(): { circuit: Circuit; motorId: string; driver: PlacedComponent } {
    let base: Circuit = { components: [], wires: [] };
    const battery = makeModule(base, 'battery', { x: 40, y: 480 });
    base = { components: [battery], wires: [] };
    const driver = makeModule(base, 'l298n', { x: 260, y: 470 });
    base = { components: [battery, driver], wires: [] };
    const motor = makeModule(base, 'motor', { x: 640, y: 474 });
    const circuit: Circuit = {
      components: [battery, driver, motor],
      wires: [
        makeWire(battery.pins.plus, driver.pins.vcc),
        makeWire(battery.pins.minus, driver.pins.gnd),
        makeWire('uno.D9', driver.pins.ena),
        makeWire('uno.D8', driver.pins.in1),
        makeWire('uno.D7', driver.pins.in2),
        makeWire(driver.pins.out1, motor.pins.m1),
        makeWire(driver.pins.out2, motor.pins.m2),
      ],
    };
    return { circuit, motorId: motor.id, driver };
  }

  it('spins forward at PWM speed', () => {
    const { circuit, motorId } = rig();
    const r = analyzeDynamic(circuit, outputs({
      modes: { D9: 'OUTPUT', D8: 'OUTPUT', D7: 'OUTPUT' },
      digital: { D8: 1, D7: 0 },
      pwm: { D9: 128 },
    }));
    expect(r.motors[motorId]).toBeCloseTo(128 / 255, 2);
  });

  it('reverses when IN1/IN2 swap', () => {
    const { circuit, motorId } = rig();
    const r = analyzeDynamic(circuit, outputs({
      modes: { D9: 'OUTPUT', D8: 'OUTPUT', D7: 'OUTPUT' },
      digital: { D8: 0, D7: 1, D9: 1 },
    }));
    expect(r.motors[motorId]).toBe(-1);
  });

  it('stops when both inputs match, and when unpowered', () => {
    const { circuit, motorId } = rig();
    const stopped = analyzeDynamic(circuit, outputs({
      modes: { D8: 'OUTPUT', D7: 'OUTPUT' },
      digital: { D8: 1, D7: 1 },
    }));
    expect(stopped.motors[motorId]).toBe(0);

    const unpowered: Circuit = { ...circuit, wires: circuit.wires.slice(2) }; // no battery
    const r = analyzeDynamic(unpowered, outputs({ modes: { D8: 'OUTPUT' }, digital: { D8: 1 } }));
    expect(r.motors[motorId]).toBe(0);
  });

  it('unwired ENA acts like the jumper (full speed)', () => {
    const { circuit, motorId } = rig();
    const noEna: Circuit = { ...circuit, wires: circuit.wires.filter((w) => !w.a.includes('.ena') && !w.b.includes('.ena')) };
    const r = analyzeDynamic(noEna, outputs({ modes: { D8: 'OUTPUT', D7: 'OUTPUT' }, digital: { D8: 1, D7: 0 } }));
    expect(r.motors[motorId]).toBe(1);
  });

  it('motor wired straight across the battery runs full speed, no short reported', () => {
    let base: Circuit = { components: [], wires: [] };
    const battery = makeModule(base, 'battery', { x: 40, y: 480 });
    base = { components: [battery], wires: [] };
    const motor = makeModule(base, 'motor', { x: 300, y: 480 });
    const circuit: Circuit = {
      components: [battery, motor],
      wires: [makeWire(battery.pins.plus, motor.pins.m1), makeWire(battery.pins.minus, motor.pins.m2)],
    };
    const r = analyzeDynamic(circuit, outputs());
    expect(r.motors[motor.id]).toBe(1);
    expect(r.diagnostics).toEqual([]);
  });

  it('battery + wired straight to battery − is a short', () => {
    const battery = makeModule({ components: [], wires: [] }, 'battery', { x: 40, y: 480 });
    const circuit: Circuit = {
      components: [battery],
      wires: [makeWire(battery.pins.plus, battery.pins.minus)],
    };
    expect(analyzeStatic(circuit).diagnostics.some((d) => d.level === 'error')).toBe(true);
  });
});

describe('demo library', () => {
  it('every demo builds a statically clean circuit', () => {
    for (const demo of DEMOS) {
      const circuit = demo.build();
      const diags = analyzeStatic(circuit).diagnostics;
      expect(diags, `${demo.name} should have no wiring complaints, got: ${diags.map((d) => d.message).join(' | ')}`).toEqual([]);
    }
  });

  it('thirsty plant demo: LED follows dry soil while running', () => {
    const demo = DEMOS.find((d) => d.id === 'plant')!;
    const circuit = demo.build();
    const sensor = circuit.components.find((c) => c.kind === 'lm393')!;
    const ledId = circuit.components.find((c) => c.kind === 'led')!.id;
    const pins = outputs({ modes: { D7: 'INPUT', D13: 'OUTPUT' }, digital: { D13: 1 } });

    sensor.props.moisture = 0.1; // dry: DO reads HIGH, sketch would set D13 HIGH
    expect(analyzeDynamic(circuit, pins).digitalReads.D7).toBe(1);
    expect(analyzeDynamic(circuit, pins).leds[ledId].lit).toBe(true); // D13 HIGH
    sensor.props.moisture = 0.9; // wet: DO reads LOW
    expect(analyzeDynamic(circuit, pins).digitalReads.D7).toBe(0);
  });
});
