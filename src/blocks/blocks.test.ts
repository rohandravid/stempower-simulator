import { describe, expect, it } from 'vitest';
import { DEMO_SKETCH } from '../circuit/model';
import { parseSketch } from '../interpreter/parser';
import { TUTORIALS } from '../tutorials/tutorials';
import { blockProgramToCode } from './codegen';
import { astToBlocks } from './fromAst';
import { parseExprFragment, parseStmtFragment } from './fragments';

function roundTrip(source: string) {
  const ast = parseSketch(source);
  const blocks = astToBlocks(ast);
  const regenerated = blockProgramToCode(blocks);
  // Must re-parse cleanly — the real test of "nothing was lost".
  expect(() => parseSketch(regenerated)).not.toThrow();
  return { blocks, regenerated };
}

describe('block mode round-trip', () => {
  it('handles the demo sketch', () => {
    roundTrip(DEMO_SKETCH);
  });

  for (const tut of Object.values(TUTORIALS)) {
    it(`handles the "${tut.name}" tutorial's starter and full code`, () => {
      roundTrip(tut.starterCode);
      for (const step of tut.steps) {
        if (step.code) roundTrip(step.code);
      }
    });
  }

  it('recognizes pinMode/digitalWrite/delay as first-class blocks, not raw', () => {
    const { blocks } = roundTrip(`
      const int LED_PIN = 13;
      void setup() { pinMode(LED_PIN, OUTPUT); }
      void loop() { digitalWrite(LED_PIN, HIGH); delay(500); digitalWrite(LED_PIN, LOW); delay(500); }
    `);
    expect(blocks.globals.map((g) => g.kind)).toEqual(['globalVar']);
    expect(blocks.setup.map((b) => b.kind)).toEqual(['pinMode']);
    expect(blocks.loop.map((b) => b.kind)).toEqual(['digitalWrite', 'delay', 'digitalWrite', 'delay']);
  });

  it('recognizes if/else and while nesting', () => {
    const { blocks } = roundTrip(`
      void setup() {}
      void loop() {
        int dry = digitalRead(7);
        if (dry == HIGH) {
          digitalWrite(13, HIGH);
        } else {
          digitalWrite(13, LOW);
        }
        while (false) {
          delay(1);
        }
      }
    `);
    expect(blocks.loop[0].kind).toBe('varDecl');
    expect(blocks.loop[1].kind).toBe('if');
    if (blocks.loop[1].kind === 'if') {
      expect(blocks.loop[1].then[0].kind).toBe('digitalWrite');
      expect(blocks.loop[1].else?.[0].kind).toBe('digitalWrite');
    }
    expect(blocks.loop[2].kind).toBe('while');
  });

  it('recognizes canonical for-loops as repeat blocks', () => {
    const { blocks } = roundTrip(`
      void setup() {}
      void loop() {
        for (int i = 0; i < 10; i++) {
          delay(1);
        }
      }
    `);
    expect(blocks.loop[0].kind).toBe('repeat');
    if (blocks.loop[0].kind === 'repeat') {
      expect(blocks.loop[0].varName).toBe('i');
      expect(blocks.loop[0].count).toBe('10');
    }
  });

  it('falls back to a raw block for unrecognized statements without losing them', () => {
    const source = `
      void setup() {}
      void loop() {
        switch (1) { }
      }
    `;
    // switch isn't supported by the interpreter at all, so this can't round-trip —
    // instead check that ordinary-but-unmodeled statements (a bare call) survive.
    const { blocks, regenerated } = roundTrip(`
      void setup() {}
      void loop() {
        someHelper(1, 2);
      }
    `);
    expect(blocks.loop[0].kind).toBe('raw');
    expect(regenerated).toContain('someHelper(1, 2);');
    void source;
  });

  it('parses expression and statement fragments', () => {
    expect(parseExprFragment('mph > SPEED_LIMIT').kind).toBe('binary');
    expect(parseStmtFragment('digitalWrite(13, HIGH);\ndelay(10);')).toHaveLength(2);
    expect(() => parseExprFragment('a b c')).toThrow();
  });
});
