// Every tutorial step's check must pass against the finished demo project in a
// "everything working" state (sketch running, button held, soil dry, knob up),
// and must not pass on an empty board with the starter code.

import { describe, expect, it } from 'vitest';
import { analyzeDynamic } from '../circuit/analysis';
import { DEMOS } from '../circuit/model';
import type { Circuit, PinOutputs } from '../circuit/types';
import { parseSketch } from '../interpreter/parser';
import { TUTORIALS, type TutorialCheckContext } from './tutorials';

/** Pin outputs a correctly running sketch would produce, per demo. */
const RUNNING_OUTPUTS: Record<string, PinOutputs> = {
  blink: { modes: { D13: 'OUTPUT', D2: 'INPUT_PULLUP' }, digital: { D13: 1 }, pwm: {} },
  plant: { modes: { D13: 'OUTPUT', D7: 'INPUT' }, digital: { D13: 1 }, pwm: {} },
  weather: { modes: {}, digital: {}, pwm: {} },
  motor: { modes: { D9: 'OUTPUT', D8: 'OUTPUT', D7: 'OUTPUT' }, digital: { D8: 1, D7: 0 }, pwm: { D9: 200 } },
  speedtrap: { modes: { D12: 'OUTPUT', D13: 'OUTPUT' }, digital: { D12: 1, D13: 0 }, pwm: {} },
};

/** Put user-interactive parts in the state the final tutorial steps ask for. */
function withInteractions(circuit: Circuit): Circuit {
  return {
    ...circuit,
    components: circuit.components.map((c) => {
      if (c.kind === 'button') return { ...c, props: { ...c.props, pressed: true } };
      if (c.kind === 'lm393') return { ...c, props: { ...c.props, moisture: 0.2 } };
      if (c.kind === 'dht11') return { ...c, props: { ...c.props, temperatureC: 35 } };
      if (c.kind === 'radar') return { ...c, props: { ...c.props, speedMph: 80 } };
      return c;
    }),
  };
}

describe('tutorials', () => {
  for (const [id, tutorial] of Object.entries(TUTORIALS)) {
    const demo = DEMOS.find((d) => d.id === id)!;

    it(`${id}: matches a demo and has valid starter code`, () => {
      expect(demo).toBeDefined();
      expect(() => parseSketch(tutorial.starterCode)).not.toThrow();
    });

    it(`${id}: every step check passes on the finished, running demo`, () => {
      const circuit = withInteractions(demo.build());
      const ctx: TutorialCheckContext = {
        circuit,
        code: demo.sketch,
        status: 'running',
        serial: 'Temp: 24.0 C   Humidity: 60.0 %\nDry soil! Water the plant.\nButton pressed!\nSpeed: 200\n',
        dynamic: analyzeDynamic(circuit, RUNNING_OUTPUTS[id]),
      };
      for (const [i, step] of tutorial.steps.entries()) {
        if (!step.check) continue;
        expect(step.check(ctx), `step ${i + 1} "${step.title}"`).toBe(true);
      }
    });

    it(`${id}: no step check passes on an empty board with starter code`, () => {
      const circuit: Circuit = { components: [], wires: [] };
      const ctx: TutorialCheckContext = {
        circuit,
        code: tutorial.starterCode,
        status: 'idle',
        serial: '',
        dynamic: analyzeDynamic(circuit, { modes: {}, digital: {}, pwm: {} }),
      };
      for (const [i, step] of tutorial.steps.entries()) {
        if (!step.check) continue;
        expect(step.check(ctx), `step ${i + 1} "${step.title}"`).toBe(false);
      }
    });

    it(`${id}: checked steps all have a checkLabel`, () => {
      for (const step of tutorial.steps) {
        if (step.check) expect(step.checkLabel, step.title).toBeTruthy();
      }
    });
  }
});
