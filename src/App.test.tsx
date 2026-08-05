// Smoke test: the whole app renders (server-side, no effects) without throwing,
// with the demo circuit on the board.

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from './App';

describe('App', () => {
  it('renders toolbar, palette, canvas and editor shell', () => {
    const html = renderToString(<App />);
    expect(html).toContain('toolbar');
    expect(html).toContain('palette');
    expect(html).toContain('circuit-canvas');
    expect(html).toContain('StemPower UNO');
    expect(html).toContain('editor-host');
    // Demo circuit parts are on the board.
    expect(html).toContain('Resistor');
    expect(html).toContain('LED');
  });
});
