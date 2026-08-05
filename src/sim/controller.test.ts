import { describe, expect, it } from 'vitest';
import { demoCircuit, DEMO_SKETCH, DEMOS } from '../circuit/model';
import { SimController } from './controller';

/**
 * Fake clock: every query nudges time forward a hair (so tick()'s frame
 * budget always terminates), and tests jump it forward to pass delay()s.
 */
function makeController() {
  const clock = { now: 0 };
  const ctl = new SimController(() => {
    clock.now += 0.01;
    return clock.now;
  });
  return { ctl, clock };
}

describe('SimController + demo circuit', () => {
  it('runs the demo sketch: LED blinks, button forces it on, serial streams', () => {
    const { ctl, clock } = makeController();
    ctl.setCircuit(demoCircuit());
    const ledId = ctl.getCircuit().components.find((c) => c.kind === 'led')!.id;

    expect(ctl.start(DEMO_SKETCH)).toBeNull();
    expect(ctl.status).toBe('running');

    // First tick: setup() + first loop() pass. Button is up, so blink: HIGH then delay(500).
    ctl.tick();
    expect(ctl.dynamic().leds[ledId].lit).toBe(true);

    // After the 500ms delay the sketch writes LOW.
    clock.now += 600;
    ctl.tick();
    expect(ctl.dynamic().leds[ledId].lit).toBe(false);

    // Hold the button: sketch should switch to solid-on + serial message.
    const pressed = {
      ...ctl.getCircuit(),
      components: ctl.getCircuit().components.map((c) =>
        c.kind === 'button' ? { ...c, props: { ...c.props, pressed: true } } : c,
      ),
    };
    ctl.setCircuit(pressed);
    clock.now += 600;
    ctl.tick();
    expect(ctl.dynamic().leds[ledId].lit).toBe(true);
    expect(ctl.hardware.serialText).toContain('Button pressed!');

    // Stop: LED dark, serial preserved.
    ctl.stop();
    expect(ctl.status).toBe('idle');
    expect(ctl.dynamic().leds[ledId].lit).toBe(false);
    expect(ctl.hardware.serialText).toContain('Button pressed!');
  });

  it('reports parse errors with a line and stays stopped', () => {
    const { ctl } = makeController();
    const err = ctl.start('void setup( {\n}\nvoid loop() {}');
    expect(err).not.toBeNull();
    expect(err!.kind).toBe('parse');
    expect(err!.line).toBeGreaterThanOrEqual(1);
    expect(ctl.status).toBe('error');
  });

  it('runtime errors stop the sim with message + line', () => {
    const { ctl } = makeController();
    expect(ctl.start('void setup() {\n  pinMode(99, OUTPUT);\n}\nvoid loop() {}')).toBeNull();
    ctl.tick();
    expect(ctl.status).toBe('error');
    expect(ctl.error!.message).toContain('Pin 99');
    expect(ctl.error!.line).toBe(2);
  });

  it('a sketch with an infinite loop cannot freeze a tick', () => {
    const { ctl } = makeController();
    expect(ctl.start('void setup() {} void loop() { while (true) { } }')).toBeNull();
    // Each tick must return promptly (budget-bounded) and keep status running.
    for (let i = 0; i < 5; i++) ctl.tick();
    expect(ctl.status).toBe('running');
  });

  it('weather demo streams DHT readings end to end', () => {
    const { ctl, clock } = makeController();
    const demo = DEMOS.find((d) => d.id === 'weather')!;
    ctl.setCircuit(demo.build());
    expect(ctl.start(demo.sketch)).toBeNull();
    ctl.tick();
    expect(ctl.hardware.serialText).toContain('Temp: 24.00 C   Humidity: 60.00 %');

    // Turn the virtual knobs and let the next loop() read them.
    const next = {
      ...ctl.getCircuit(),
      components: ctl.getCircuit().components.map((c) =>
        c.kind === 'dht11' ? { ...c, props: { ...c.props, temperatureC: 35, humidityPct: 80 } } : c,
      ),
    };
    ctl.setCircuit(next);
    clock.now += 1100;
    ctl.tick();
    expect(ctl.hardware.serialText).toContain('Temp: 35.00 C   Humidity: 80.00 %');
    ctl.stop();
  });

  it('motor demo spins the motor according to the pot', () => {
    const { ctl, clock } = makeController();
    const demo = DEMOS.find((d) => d.id === 'motor')!;
    ctl.setCircuit(demo.build());
    const motorId = ctl.getCircuit().components.find((c) => c.kind === 'motor')!.id;
    expect(ctl.start(demo.sketch)).toBeNull();
    ctl.tick();
    // Pot at 0.5 -> ~50% duty forward.
    expect(ctl.dynamic().motors[motorId]).toBeGreaterThan(0.4);
    expect(ctl.dynamic().motors[motorId]).toBeLessThan(0.6);
    expect(ctl.hardware.serialText).toMatch(/Speed: \d+/);

    // Pot to zero -> motor stops on the next loop pass.
    ctl.setCircuit({
      ...ctl.getCircuit(),
      components: ctl.getCircuit().components.map((c) =>
        c.kind === 'potentiometer' ? { ...c, props: { ...c.props, position: 1 } } : c,
      ),
    });
    clock.now += 300;
    ctl.tick();
    expect(Math.abs(ctl.dynamic().motors[motorId])).toBeLessThan(0.05);
    ctl.stop();
  });

  it('static diagnostics update when the circuit changes', () => {
    const { ctl } = makeController();
    ctl.setCircuit(demoCircuit());
    expect(ctl.staticDiagnostics()).toEqual([]);
    // Remove the resistor: LED should be flagged.
    const broken = {
      ...ctl.getCircuit(),
      components: ctl.getCircuit().components.filter((c) => c.kind !== 'resistor'),
    };
    ctl.setCircuit(broken);
    expect(ctl.staticDiagnostics().length).toBeGreaterThan(0);
  });
});
