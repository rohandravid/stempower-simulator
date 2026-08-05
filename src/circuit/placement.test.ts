// Placement rules: auto-place keeps new parts on untouched columns, but a
// dragged part may share a column with another part (that's how parts connect
// without wires) — only landing in the exact same hole is forbidden.

import { describe, expect, it } from 'vitest';
import { placementHolesFree, placementIsFree } from './model';
import type { Circuit, PlacedComponent } from './types';

const led: PlacedComponent = {
  id: 'led1',
  kind: 'led',
  pins: { anode: 'bb.b5', cathode: 'bb.b6' },
  props: {},
};
const circuit: Circuit = { components: [led], wires: [] };

describe('placementHolesFree (drag rule)', () => {
  it('allows a resistor leg in the same column as an LED leg', () => {
    // d6 shares column 6 with the LED cathode at b6 — the natural connection.
    expect(placementHolesFree(circuit, { p1: 'bb.d6', p2: 'bb.d9' })).toBe(true);
    // Strict auto-place rule rejects the same drop.
    expect(placementIsFree(circuit, { p1: 'bb.d6', p2: 'bb.d9' })).toBe(false);
  });

  it('rejects landing in the exact hole another leg occupies', () => {
    expect(placementHolesFree(circuit, { p1: 'bb.b6', p2: 'bb.b9' })).toBe(false);
  });

  it('ignores the moved part itself and rejects invalid nodes', () => {
    expect(placementHolesFree(circuit, { anode: 'bb.b5', cathode: 'bb.b6' }, 'led1')).toBe(true);
    expect(placementHolesFree(circuit, { p1: 'bb.z99', p2: 'bb.d9' })).toBe(false);
  });
});
