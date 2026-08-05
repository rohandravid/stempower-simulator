// Hand-rolled tokenizer with line/col tracking and #define expansion.

import { SketchParseError } from './errors';

export type TokenKind = 'ident' | 'num' | 'char' | 'str' | 'punct' | 'eof';

export interface Token {
  kind: TokenKind;
  text: string;
  line: number; // 1-based
  col: number; // 0-based
  /** For 'num' tokens. */
  value?: number;
  isFloat?: boolean;
}

const PUNCT3 = ['<<=', '>>='];
const PUNCT2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', '&=', '|=', '^='];
const PUNCT1 = '+-*/%=<>!&|^~?:;,.(){}[]';

export function tokenize(source: string, defines?: Map<string, string>): Token[] {
  const raw = tokenizeRaw(source);
  if (!defines || defines.size === 0) return raw;

  // Expand object-like #defines at their use sites. Replacement tokens keep
  // the use site's position so errors point at real code.
  const out: Token[] = [];
  for (const tok of raw) {
    if (tok.kind === 'ident' && defines.has(tok.text)) {
      const replacement = expandDefine(tok.text, defines, tok.line, tok.col);
      out.push(...replacement.map((t) => ({ ...t, line: tok.line, col: tok.col })));
    } else {
      out.push(tok);
    }
  }
  return out;
}

function expandDefine(
  name: string,
  defines: Map<string, string>,
  line: number,
  col: number,
  depth = 0,
): Token[] {
  if (depth > 16) {
    throw new SketchParseError(`#define ${name} expands forever (defines refer to each other in a loop).`, line, col);
  }
  const text = defines.get(name)!;
  const tokens = tokenizeRaw(text).filter((t) => t.kind !== 'eof');
  const out: Token[] = [];
  for (const t of tokens) {
    if (t.kind === 'ident' && t.text !== name && defines.has(t.text)) {
      out.push(...expandDefine(t.text, defines, line, col, depth + 1));
    } else {
      out.push(t);
    }
  }
  return out;
}

function tokenizeRaw(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = source.length;

  const col = () => i - lineStart;
  const err = (message: string): never => {
    throw new SketchParseError(message, line, col());
  };

  while (i < n) {
    const c = source[i];

    if (c === '\n') {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    // Comments
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const startLine = line;
      const startCol = col();
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      if (i >= n) throw new SketchParseError('This /* comment is never closed — add */.', startLine, startCol);
      i += 2;
      continue;
    }

    const startCol = col();
    const startLine = line;

    // Numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let text = '';
      let isFloat = false;
      if (c === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
        i += 2;
        let hex = '';
        while (i < n && /[0-9a-fA-F]/.test(source[i])) hex += source[i++];
        if (hex === '') err('Expected hex digits after 0x.');
        skipNumSuffix();
        tokens.push({ kind: 'num', text: `0x${hex}`, line: startLine, col: startCol, value: parseInt(hex, 16), isFloat: false });
        continue;
      }
      if (c === '0' && (source[i + 1] === 'b' || source[i + 1] === 'B')) {
        i += 2;
        let bin = '';
        while (i < n && /[01]/.test(source[i])) bin += source[i++];
        if (bin === '') err('Expected 0s and 1s after 0b.');
        skipNumSuffix();
        tokens.push({ kind: 'num', text: `0b${bin}`, line: startLine, col: startCol, value: parseInt(bin, 2), isFloat: false });
        continue;
      }
      while (i < n && /[0-9]/.test(source[i])) text += source[i++];
      if (source[i] === '.') {
        isFloat = true;
        text += source[i++];
        while (i < n && /[0-9]/.test(source[i])) text += source[i++];
      }
      if (source[i] === 'e' || source[i] === 'E') {
        const save = i;
        let exp = source[i++];
        if (source[i] === '+' || source[i] === '-') exp += source[i++];
        if (/[0-9]/.test(source[i] ?? '')) {
          isFloat = true;
          while (i < n && /[0-9]/.test(source[i])) exp += source[i++];
          text += exp;
        } else {
          i = save; // not an exponent (e.g. `1e` then identifier)
        }
      }
      if (source[i] === 'f' || source[i] === 'F') {
        isFloat = true;
      }
      skipNumSuffix();
      tokens.push({ kind: 'num', text, line: startLine, col: startCol, value: parseFloat(text), isFloat });
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_]/.test(c)) {
      let text = '';
      while (i < n && /[A-Za-z0-9_]/.test(source[i])) text += source[i++];
      tokens.push({ kind: 'ident', text, line: startLine, col: startCol });
      continue;
    }

    // Char literal
    if (c === "'") {
      i++;
      const { code } = readEscapedChar("'");
      if (source[i] !== "'") err("This character literal is never closed — expected '.");
      i++;
      tokens.push({ kind: 'char', text: String.fromCharCode(code), line: startLine, col: startCol, value: code });
      continue;
    }

    // String literal
    if (c === '"') {
      i++;
      let value = '';
      while (i < n && source[i] !== '"') {
        if (source[i] === '\n') throw new SketchParseError('This "string" is never closed — add the ending quote.', startLine, startCol);
        const { code } = readEscapedChar('"');
        value += String.fromCharCode(code);
      }
      if (i >= n) throw new SketchParseError('This "string" is never closed — add the ending quote.', startLine, startCol);
      i++;
      tokens.push({ kind: 'str', text: value, line: startLine, col: startCol });
      continue;
    }

    // Punctuation, longest match first
    const three = source.slice(i, i + 3);
    if (PUNCT3.includes(three)) {
      i += 3;
      tokens.push({ kind: 'punct', text: three, line: startLine, col: startCol });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (PUNCT2.includes(two)) {
      i += 2;
      tokens.push({ kind: 'punct', text: two, line: startLine, col: startCol });
      continue;
    }
    if (PUNCT1.includes(c)) {
      i++;
      tokens.push({ kind: 'punct', text: c, line: startLine, col: startCol });
      continue;
    }

    err(`Unexpected character "${c}".`);
  }

  tokens.push({ kind: 'eof', text: '', line, col: col() });
  return tokens;

  function skipNumSuffix(): void {
    while (i < n && /[uUlLfF]/.test(source[i])) i++;
  }

  function readEscapedChar(_quote: string): { code: number } {
    let ch = source[i];
    if (ch === '\\') {
      i++;
      const esc = source[i];
      i++;
      switch (esc) {
        case 'n': return { code: 10 };
        case 't': return { code: 9 };
        case 'r': return { code: 13 };
        case '0': return { code: 0 };
        case '\\': return { code: 92 };
        case "'": return { code: 39 };
        case '"': return { code: 34 };
        default: err(`Unknown escape \\${esc ?? ''}.`);
      }
    }
    i++;
    return { code: ch.charCodeAt(0) };
  }
}
