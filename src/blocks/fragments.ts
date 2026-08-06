// Parses small text fragments (a single expression, a run of statements, or a
// top-level item) by wrapping them in a throwaway function/program and running
// them through the real tokenizer/parser. This keeps block mode's validation
// perfectly in sync with what the interpreter actually accepts — no second
// grammar to maintain.

import type { Expr, FuncDecl, Program, Stmt } from '../interpreter/ast';
import { parseSketch } from '../interpreter/parser';

/** Parse a single expression fragment, e.g. "A0" or "mph > SPEED_LIMIT". */
export function parseExprFragment(text: string): Expr {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('This can\'t be empty.');
  const program = parseSketch(`void __frag__() {\n${trimmed};\n}`);
  const fn = program.items.find((i): i is FuncDecl => i.kind === 'func' && i.name === '__frag__')!;
  const stmt = fn.body.body[0];
  if (!stmt || stmt.kind !== 'exprstmt') {
    throw new Error('Expected a value or expression here.');
  }
  return stmt.expr;
}

/** Parse zero or more statements, e.g. the body a block's slot should hold. */
export function parseStmtFragment(text: string): Stmt[] {
  const program = parseSketch(`void __frag__() {\n${text}\n}`);
  const fn = program.items.find((i): i is FuncDecl => i.kind === 'func' && i.name === '__frag__')!;
  return fn.body.body;
}

/** Parse zero or more top-level items (globals, DHT decls, functions). */
export function parseGlobalFragment(text: string): Program['items'] {
  return parseSketch(text).items;
}
