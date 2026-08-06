// Turns AST nodes back into Arduino C++ source (used for the "raw" fallback
// block, which preserves anything block mode doesn't have a dedicated block
// for) and turns a BlockProgram into the full sketch text block mode edits.

import type { Expr, FuncDecl, Program, Stmt, VarDecl } from '../interpreter/ast';
import type { BlockGlobal, BlockProgram, BlockStmt } from './types';

// --- expressions -------------------------------------------------------------

function needsParen(e: Expr): boolean {
  return e.kind === 'binary' || e.kind === 'logical' || e.kind === 'cond' || e.kind === 'assign';
}

function wrap(e: Expr): string {
  const s = exprToCode(e);
  return needsParen(e) ? `(${s})` : s;
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

function escapeChar(code: number): string {
  if (code === 39) return "\\'";
  if (code === 92) return '\\\\';
  if (code === 10) return '\\n';
  if (code === 9) return '\\t';
  if (code === 13) return '\\r';
  if (code === 0) return '\\0';
  return String.fromCharCode(code);
}

export function exprToCode(e: Expr): string {
  switch (e.kind) {
    case 'num':
      return String(e.value);
    case 'char':
      return `'${escapeChar(e.code)}'`;
    case 'str':
      return `"${escapeStr(e.value)}"`;
    case 'bool':
      return e.value ? 'true' : 'false';
    case 'ident':
      return e.name;
    case 'assign':
      return `${e.target.name} ${e.op} ${wrap(e.value)}`;
    case 'binary':
      return `${wrap(e.left)} ${e.op} ${wrap(e.right)}`;
    case 'logical':
      return `${wrap(e.left)} ${e.op} ${wrap(e.right)}`;
    case 'unary':
      return `${e.op}${wrap(e.operand)}`;
    case 'update':
      return e.prefix ? `${e.op}${e.target.name}` : `${e.target.name}${e.op}`;
    case 'cond':
      return `${wrap(e.test)} ? ${wrap(e.consequent)} : ${wrap(e.alternate)}`;
    case 'call':
      return `${e.callee}(${e.args.map((a) => exprToCode(a)).join(', ')})`;
  }
}

// --- statements ----------------------------------------------------------------

function declToCode(d: VarDecl): string {
  const parts = d.declarations.map((decl) => (decl.init ? `${decl.name} = ${exprToCode(decl.init)}` : decl.name));
  return `${d.isConst ? 'const ' : ''}${d.type} ${parts.join(', ')};`;
}

function indentLines(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => (line.length ? indent + line : line))
    .join('\n');
}

export function stmtToCode(s: Stmt, indent = ''): string {
  switch (s.kind) {
    case 'block':
      return `${indent}{\n${s.body.map((st) => stmtToCode(st, indent + '  ')).join('\n')}\n${indent}}`;
    case 'vardecl':
      return indent + declToCode(s);
    case 'exprstmt':
      return `${indent}${exprToCode(s.expr)};`;
    case 'if': {
      let out = `${indent}if (${exprToCode(s.test)}) ${blockOrStmt(s.consequent, indent)}`;
      if (s.alternate) out += ` else ${blockOrStmt(s.alternate, indent)}`;
      return out;
    }
    case 'while':
      return `${indent}while (${exprToCode(s.test)}) ${blockOrStmt(s.body, indent)}`;
    case 'dowhile':
      return `${indent}do ${blockOrStmt(s.body, indent)} while (${exprToCode(s.test)});`;
    case 'for': {
      const init = s.init ? (s.init.kind === 'vardecl' ? declToCode(s.init) : s.init.kind === 'exprstmt' ? `${exprToCode(s.init.expr)};` : ';') : ';';
      const test = s.test ? exprToCode(s.test) : '';
      const update = s.update ? exprToCode(s.update) : '';
      return `${indent}for (${init} ${test}; ${update}) ${blockOrStmt(s.body, indent)}`;
    }
    case 'return':
      return `${indent}return${s.value ? ` ${exprToCode(s.value)}` : ''};`;
    case 'break':
      return `${indent}break;`;
    case 'continue':
      return `${indent}continue;`;
    case 'empty':
      return `${indent};`;
  }
}

function blockOrStmt(s: Stmt, indent: string): string {
  if (s.kind === 'block') return stmtToCode(s, indent);
  return `{\n${stmtToCode(s, indent + '  ')}\n${indent}}`;
}

function funcToCode(f: FuncDecl): string {
  const params = f.params.map((p) => `${p.type} ${p.name}`).join(', ');
  return `${f.retType} ${f.name}(${params}) ${stmtToCode(f.body, '')}`;
}

/** Unparse a single top-level program item (used for the globalRaw fallback). */
export function itemToCode(item: Program['items'][number]): string {
  if (item.kind === 'dhtdecl') return `DHT ${item.name}(${exprToCode(item.pin)}, DHT11);`;
  if (item.kind === 'vardecl') return declToCode(item);
  return funcToCode(item);
}

// --- BlockProgram -> source ------------------------------------------------------

function globalToCode(g: BlockGlobal): string {
  switch (g.kind) {
    case 'globalVar':
      return `${g.isConst ? 'const ' : ''}${g.type} ${g.name}${g.value.trim() ? ` = ${g.value}` : ''};`;
    case 'globalDht':
      return `DHT ${g.name}(${g.pin}, DHT11);`;
    case 'globalRaw':
      return g.code;
  }
}

function blockToCode(b: BlockStmt, indent: string): string {
  switch (b.kind) {
    case 'pinMode':
      return `${indent}pinMode(${b.pin}, ${b.mode});`;
    case 'digitalWrite':
      return `${indent}digitalWrite(${b.pin}, ${b.value});`;
    case 'analogWrite':
      return `${indent}analogWrite(${b.pin}, ${b.value});`;
    case 'delay':
      return `${indent}delay(${b.ms});`;
    case 'serialBegin':
      return `${indent}Serial.begin(${b.baud});`;
    case 'serialPrint':
      return `${indent}Serial.${b.newline ? 'println' : 'print'}(${b.value});`;
    case 'dhtBegin':
      return `${indent}${b.name}.begin();`;
    case 'varDecl':
      return `${indent}${b.isConst ? 'const ' : ''}${b.type} ${b.name}${b.value.trim() ? ` = ${b.value}` : ''};`;
    case 'varSet':
      return `${indent}${b.name} ${b.op} ${b.value};`;
    case 'if': {
      let out = `${indent}if (${b.cond}) {\n${listToCode(b.then, indent + '  ')}\n${indent}}`;
      if (b.else) out += ` else {\n${listToCode(b.else, indent + '  ')}\n${indent}}`;
      return out;
    }
    case 'while':
      return `${indent}while (${b.cond}) {\n${listToCode(b.body, indent + '  ')}\n${indent}}`;
    case 'repeat':
      return (
        `${indent}for (int ${b.varName} = 0; ${b.varName} < ${b.count}; ${b.varName}++) {\n` +
        `${listToCode(b.body, indent + '  ')}\n${indent}}`
      );
    case 'raw':
      return indentLines(b.code, indent);
  }
}

function listToCode(list: BlockStmt[], indent: string): string {
  return list.map((b) => blockToCode(b, indent)).join('\n');
}

export function blockProgramToCode(program: BlockProgram): string {
  const lines: string[] = [];
  const hasDht = program.globals.some((g) => g.kind === 'globalDht');
  if (hasDht) {
    lines.push('#include <DHT.h>', '');
  }
  for (const g of program.globals) lines.push(globalToCode(g));
  if (program.globals.length) lines.push('');
  lines.push('void setup() {');
  if (program.setup.length) lines.push(listToCode(program.setup, '  '));
  lines.push('}', '');
  lines.push('void loop() {');
  if (program.loop.length) lines.push(listToCode(program.loop, '  '));
  lines.push('}');
  return lines.join('\n') + '\n';
}
