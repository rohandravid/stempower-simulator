import { describe, expect, it } from 'vitest';
import { analyzeDynamic, analyzeStatic } from './analysis';
import { demoCircuit, makeWire } from './model';
import type { Circuit, PinOutputs, PlacedComponent } from './types';

function outputs(partial: Partial<PinOutputs> = {}): PinOutputs {
  return { modes: {}, digital: {}, pwm: {}, ...partial };
}

function led(id: string, anode: string, cathode: string): PlacedComponent {
  return { id, kind: 'led', pins: { anode, cathode }, props: { color: 'red' } };
}

function resistor(id: string, p1: string, p2: string): PlacedComponent {
  return { id, kind: 'resistor', pins: { p1, p2 }, props: { ohms: 220 } };
}

describe('demo circuit', () => {
  const demo = demoCircuit();
  const ledId = demo.components.find((c) => c.kind === 'led')!.id;

  it('lights the LED when D13 is OUTPUT HIGH', () => {
    const r = analyzeDynamic(demo, outputs({ modes: { D13: 'OUTPUT' }, digital: { D13: 1 } }));
    expect(r.leds[ledId]).toMatchObject({ lit: true, brightness: 1, burnout: false });
    expect(r.diagnostics).toEqual([]);
  });

  it('LED is off when D13 is LOW', () => {
    const r = analyzeDynamic(demo, outputs({ modes: { D13: 'OUTPUT' }, digital: { D13: 0 } }));
    expect(r.leds[ledId].lit).toBe(false);
  });

  it('LED is off when nothing is driven', () => {
    const r = analyzeDynamic(demo, outputs());
    expect(r.leds[ledId].lit).toBe(false);
  });

  it('has no static wiring complaints', () => {
    expect(analyzeStatic(demo).diagnostics).toEqual([]);
  });

  it('button with INPUT_PULLUP reads HIGH unpressed, LOW pressed', () => {
    const pins = outputs({ modes: { D2: 'INPUT_PULLUP' } });
    expect(analyzeDynamic(demo, pins).digitalReads.D2).toBe(1);

    const pressed: Circuit = {
      ...demo,
      components: demo.components.map((c) =>
        c.kind === 'button' ? { ...c, props: { ...c.props, pressed: true } } : c,
      ),
    };
    expect(analyzeDynamic(pressed, pins).digitalReads.D2).toBe(0);
  });
});

describe('LED faults', () => {
  it('flags a missing resistor (burnout)', () => {
    const circuit: Circuit = {
      components: [led('led1', 'bb.b5', 'bb.b6')],
      wires: [makeWire('uno.D13', 'bb.a5'), makeWire('bb.a6', 'uno.GND1')],
    };
    const stat = analyzeStatic(circuit);
    expect(stat.diagnostics.some((d) => d.message.includes('resistor') && d.componentId === 'led1')).toBe(true);

    const dyn = analyzeDynamic(circuit, outputs({ modes: { D13: 'OUTPUT' }, digital: { D13: 1 } }));
    expect(dyn.leds.led1.lit).toBe(true);
    expect(dyn.leds.led1.burnout).toBe(true);
  });

  it('flags a reversed LED and does not light it', () => {
    const circuit: Circuit = {
      components: [led('led1', 'bb.b6', 'bb.b5'), resistor('r1', 'bb.d6', 'bb.d9')],
      wires: [makeWire('uno.D13', 'bb.a5'), makeWire('bb.a9', 'uno.GND1')],
    };
    const stat = analyzeStatic(circuit);
    expect(stat.diagnostics.some((d) => d.message.includes('reversed'))).toBe(true);

    const dyn = analyzeDynamic(circuit, outputs({ modes: { D13: 'OUTPUT' }, digital: { D13: 1 } }));
    expect(dyn.leds.led1.lit).toBe(false);
  });

  it('flags an open circuit', () => {
    const circuit: Circuit = {
      components: [led('led1', 'bb.b5', 'bb.b6')],
      wires: [makeWire('uno.D13', 'bb.a5')], // cathode goes nowhere
    };
    const stat = analyzeStatic(circuit);
    expect(stat.diagnostics.some((d) => d.message.includes('complete circuit'))).toBe(true);
  });

  it('LED works in sink configuration (5V -> LED -> resistor -> LOW pin)', () => {
    const circuit: Circuit = {
      components: [led('led1', 'bb.b5', 'bb.b6'), resistor('r1', 'bb.d6', 'bb.d9')],
      wires: [makeWire('uno.5V', 'bb.a5'), makeWire('bb.a9', 'uno.D8')],
    };
    const on = analyzeDynamic(circuit, outputs({ modes: { D8: 'OUTPUT' }, digital: { D8: 0 } }));
    expect(on.leds.led1.lit).toBe(true);
    const off = analyzeDynamic(circuit, outputs({ modes: { D8: 'OUTPUT' }, digital: { D8: 1 } }));
    expect(off.leds.led1.lit).toBe(false);
  });

  it('PWM sets brightness', () => {
    const circuit: Circuit = {
      components: [led('led1', 'bb.b5', 'bb.b6'), resistor('r1', 'bb.d6', 'bb.d9')],
      wires: [makeWire('uno.D9', 'bb.a5'), makeWire('bb.a9', 'uno.GND1')],
    };
    const r = analyzeDynamic(circuit, outputs({ modes: { D9: 'OUTPUT' }, pwm: { D9: 128 } }));
    expect(r.leds.led1.lit).toBe(true);
    expect(r.leds.led1.brightness).toBeCloseTo(128 / 255, 3);
  });
});

describe('shorts', () => {
  it('detects 5V wired to GND', () => {
    const circuit: Circuit = { components: [], wires: [makeWire('uno.5V', 'bb.top+.1'), makeWire('bb.top+.5', 'uno.GND1')] };
    expect(analyzeStatic(circuit).diagnostics.some((d) => d.level === 'error')).toBe(true);
    expect(analyzeDynamic(circuit, outputs()).diagnostics.some((d) => d.message.includes('Short'))).toBe(true);
  });

  it('detects a short through a pressed button', () => {
    const button: PlacedComponent = {
      id: 'b1', kind: 'button', pins: { p1: 'bb.e5', p2: 'bb.f5' }, props: { pressed: true },
    };
    const circuit: Circuit = {
      components: [button],
      wires: [makeWire('uno.5V', 'bb.a5'), makeWire('bb.j5', 'uno.GND1')],
    };
    expect(analyzeDynamic(circuit, outputs()).diagnostics.some((d) => d.message.includes('Short'))).toBe(true);
    // Unpressed: no short.
    button.props.pressed = false;
    expect(analyzeDynamic(circuit, outputs()).diagnostics).toEqual([]);
  });

  it('a resistor from 5V to GND is not a short', () => {
    const circuit: Circuit = {
      components: [resistor('r1', 'bb.d5', 'bb.d8')],
      wires: [makeWire('uno.5V', 'bb.a5'), makeWire('bb.a8', 'uno.GND1')],
    };
    expect(analyzeDynamic(circuit, outputs()).diagnostics).toEqual([]);
  });
});

describe('potentiometer / analogRead', () => {
  function potCircuit(position: number): Circuit {
    const pot: PlacedComponent = {
      id: 'pot1',
      kind: 'potentiometer',
      pins: { end1: 'bb.g20', wiper: 'bb.g21', end2: 'bb.g22' },
      props: { position },
    };
    return {
      components: [pot],
      wires: [
        makeWire('uno.5V', 'bb.j20'),
        makeWire('bb.j21', 'uno.A0'),
        makeWire('bb.j22', 'uno.GND1'),
      ],
    };
  }

  it('interpolates the wiper between the ends', () => {
    // end1 = 5V, end2 = GND: position 0 -> 1023, 0.5 -> ~511, 1 -> 0
    expect(analyzeDynamic(potCircuit(0), outputs()).analogReads.A0).toBe(1023);
    expect(analyzeDynamic(potCircuit(0.5), outputs()).analogReads.A0).toBe(512);
    expect(analyzeDynamic(potCircuit(1), outputs()).analogReads.A0).toBe(0);
  });

  it('A0 wired straight to 5V reads 1023, to GND reads 0, floating reads 0', () => {
    const to5v: Circuit = { components: [], wires: [makeWire('uno.A0', 'bb.a1'), makeWire('bb.b1', 'uno.5V')] };
    expect(analyzeDynamic(to5v, outputs()).analogReads.A0).toBe(1023);
    const toGnd: Circuit = { components: [], wires: [makeWire('uno.A0', 'bb.a1'), makeWire('bb.b1', 'uno.GND1')] };
    expect(analyzeDynamic(toGnd, outputs()).analogReads.A0).toBe(0);
    const floating: Circuit = { components: [], wires: [] };
    expect(analyzeDynamic(floating, outputs()).analogReads.A0).toBe(0);
  });
});

describe('rails', () => {
  it('a whole rail is one net', () => {
    const circuit: Circuit = {
      components: [led('led1', 'bb.b5', 'bb.b6'), resistor('r1', 'bb.d6', 'bb.d9')],
      wires: [
        makeWire('uno.5V', 'bb.top+.1'),
        makeWire('bb.top+.30', 'bb.a5'), // far end of the same rail
        makeWire('bb.a9', 'uno.GND1'),
      ],
    };
    const r = analyzeDynamic(circuit, outputs());
    expect(r.leds.led1.lit).toBe(true);
  });
});
