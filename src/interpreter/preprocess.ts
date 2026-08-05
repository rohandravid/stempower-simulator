// Tiny preprocessor: strips #include lines and collects simple object-like
// #define macros. Directive lines are blanked (not removed) so every token
// keeps its original line/column for error reporting.

import { SketchParseError } from './errors';

export interface PreprocessResult {
  source: string;
  /** NAME -> replacement text (tokenized later, at the use site). */
  defines: Map<string, string>;
}

export function preprocess(source: string): PreprocessResult {
  const defines = new Map<string, string>();
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('#')) continue;
    const lineNo = i + 1;
    const col = line.length - trimmed.length;

    const m = trimmed.match(/^#\s*(\w+)/);
    const directive = m?.[1] ?? '';

    if (directive === 'include') {
      lines[i] = '';
      continue;
    }
    if (directive === 'define') {
      const body = trimmed.replace(/^#\s*define\s*/, '');
      const dm = body.match(/^([A-Za-z_]\w*)(\(?)\s*(.*)$/);
      if (!dm) {
        throw new SketchParseError('Could not read this #define — expected "#define NAME value".', lineNo, col);
      }
      if (dm[2] === '(') {
        throw new SketchParseError(
          'Function-like #define macros are not supported yet — use a normal function instead.',
          lineNo,
          col,
        );
      }
      defines.set(dm[1], stripLineComment(dm[3]).trim());
      lines[i] = '';
      continue;
    }
    throw new SketchParseError(
      `#${directive || '?'} is not supported here — only #include and simple #define work in the simulator.`,
      lineNo,
      col,
    );
  }

  return { source: lines.join('\n'), defines };
}

function stripLineComment(text: string): string {
  const idx = text.indexOf('//');
  return idx >= 0 ? text.slice(0, idx) : text;
}
