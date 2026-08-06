// Converts a parsed sketch AST into a BlockProgram. Recognized statement
// shapes (pinMode, digitalWrite, if/while, simple for-loops, ...) become
// first-class draggable blocks; anything else — an unusual call, a switch
// statement, a helper function — becomes a "raw code" block that preserves
// the original meaning exactly, just without dedicated fields. Nothing is
// ever lost on the way into block mode.

import type { Expr, ForStmt, Program, Stmt } from '../interpreter/ast';
import { exprToCode, itemToCode, stmtToCode } from './codegen';
import { type BlockProgram, type BlockStmt, newBlockId } from './types';

function raw(s: Stmt): BlockStmt {
  return { id: newBlockId(), kind: 'raw', code: stmtToCode(s) };
}

function isIdent(e: Expr, name?: string): boolean {
  return e.kind === 'ident' && (name === undefined || e.name === name);
}

interface RepeatInfo {
  varName: string;
  count: string;
}

function canonicalRepeatInfo(s: ForStmt): RepeatInfo | null {
  const { init, test, update } = s;
  if (!init || init.kind !== 'vardecl' || init.declarations.length !== 1) return null;
  if (init.type !== 'int') return null;
  const decl = init.declarations[0];
  if (!decl.init || decl.init.kind !== 'num' || decl.init.value !== 0) return null;
  const varName = decl.name;
  if (!test || test.kind !== 'binary' || test.op !== '<' || !isIdent(test.left, varName)) return null;
  if (!update || update.kind !== 'update' || update.op !== '++' || !isIdent(update.target, varName)) return null;
  return { varName, count: exprToCode(test.right) };
}

function blockBody(s: Stmt): BlockStmt[] {
  if (s.kind === 'block') return s.body.map(stmtToBlock);
  return [stmtToBlock(s)];
}

function stmtToBlock(s: Stmt): BlockStmt {
  if (s.kind === 'vardecl') {
    if (s.declarations.length === 1) {
      const d = s.declarations[0];
      return {
        id: newBlockId(),
        kind: 'varDecl',
        type: s.type,
        isConst: s.isConst,
        name: d.name,
        value: d.init ? exprToCode(d.init) : '',
      };
    }
    return raw(s);
  }

  if (s.kind === 'if') {
    return {
      id: newBlockId(),
      kind: 'if',
      cond: exprToCode(s.test),
      then: blockBody(s.consequent),
      else: s.alternate ? blockBody(s.alternate) : null,
    };
  }

  if (s.kind === 'while') {
    return { id: newBlockId(), kind: 'while', cond: exprToCode(s.test), body: blockBody(s.body) };
  }

  if (s.kind === 'for') {
    const info = canonicalRepeatInfo(s);
    if (info) {
      return { id: newBlockId(), kind: 'repeat', count: info.count, varName: info.varName, body: blockBody(s.body) };
    }
    return raw(s);
  }

  if (s.kind === 'exprstmt') {
    const e = s.expr;
    if (e.kind === 'call') {
      if (e.callee === 'pinMode' && e.args.length === 2 && isIdent(e.args[1]) && e.args[1].kind === 'ident') {
        const mode = e.args[1].name;
        if (mode === 'INPUT' || mode === 'OUTPUT' || mode === 'INPUT_PULLUP') {
          return { id: newBlockId(), kind: 'pinMode', pin: exprToCode(e.args[0]), mode };
        }
      }
      if (e.callee === 'digitalWrite' && e.args.length === 2) {
        return { id: newBlockId(), kind: 'digitalWrite', pin: exprToCode(e.args[0]), value: exprToCode(e.args[1]) };
      }
      if (e.callee === 'analogWrite' && e.args.length === 2) {
        return { id: newBlockId(), kind: 'analogWrite', pin: exprToCode(e.args[0]), value: exprToCode(e.args[1]) };
      }
      if (e.callee === 'delay' && e.args.length === 1) {
        return { id: newBlockId(), kind: 'delay', ms: exprToCode(e.args[0]) };
      }
      if (e.callee === 'Serial.begin' && e.args.length === 1) {
        return { id: newBlockId(), kind: 'serialBegin', baud: exprToCode(e.args[0]) };
      }
      if ((e.callee === 'Serial.print' || e.callee === 'Serial.println') && e.args.length === 1) {
        return {
          id: newBlockId(),
          kind: 'serialPrint',
          value: exprToCode(e.args[0]),
          newline: e.callee === 'Serial.println',
        };
      }
      if (e.callee.endsWith('.begin') && e.args.length === 0) {
        return { id: newBlockId(), kind: 'dhtBegin', name: e.callee.slice(0, -'.begin'.length) };
      }
    }
    if (e.kind === 'assign' && (e.op === '=' || e.op === '+=' || e.op === '-=' || e.op === '*=' || e.op === '/=')) {
      return { id: newBlockId(), kind: 'varSet', name: e.target.name, op: e.op, value: exprToCode(e.value) };
    }
  }

  return raw(s);
}

export function astToBlocks(program: Program): BlockProgram {
  const globals: BlockProgram['globals'] = [];
  let setup: BlockStmt[] = [];
  let loop: BlockStmt[] = [];

  for (const item of program.items) {
    if (item.kind === 'func' && item.params.length === 0 && item.name === 'setup') {
      setup = item.body.body.map(stmtToBlock);
      continue;
    }
    if (item.kind === 'func' && item.params.length === 0 && item.name === 'loop') {
      loop = item.body.body.map(stmtToBlock);
      continue;
    }
    if (item.kind === 'dhtdecl') {
      globals.push({ id: newBlockId(), kind: 'globalDht', name: item.name, pin: exprToCode(item.pin) });
      continue;
    }
    if (item.kind === 'vardecl' && item.declarations.length === 1) {
      const d = item.declarations[0];
      globals.push({
        id: newBlockId(),
        kind: 'globalVar',
        type: item.type,
        isConst: item.isConst,
        name: d.name,
        value: d.init ? exprToCode(d.init) : '',
      });
      continue;
    }
    globals.push({ id: newBlockId(), kind: 'globalRaw', code: itemToCode(item) });
  }

  return { globals, setup, loop };
}

/** True if `program` has the setup()/loop() shape block mode expects. */
export function hasSetupAndLoop(program: Program): boolean {
  return (
    program.items.some((i) => i.kind === 'func' && i.name === 'setup') &&
    program.items.some((i) => i.kind === 'func' && i.name === 'loop')
  );
}
