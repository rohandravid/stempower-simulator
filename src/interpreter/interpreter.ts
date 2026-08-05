// Generator-based tree-walking VM for the parsed sketch. Yields control for
// delay() and periodically in tight loops so the UI never freezes.

import type { DhtDecl, Expr, FuncDecl, Program, Stmt, VarDecl, VarType } from './ast';
import { SketchRuntimeError } from './errors';
import type { MachineIO } from '../sim/hardware';

// --- values ------------------------------------------------------------------

export type VType = 'int' | 'float' | 'bool' | 'char' | 'string' | 'void';

export interface Value {
  t: VType;
  v: number | boolean | string;
}

const VOID: Value = { t: 'void', v: 0 };
const int = (v: number): Value => ({ t: 'int', v: Math.trunc(v) });
const float = (v: number): Value => ({ t: 'float', v });
const bool = (v: boolean): Value => ({ t: 'bool', v });

function num(val: Value, line: number): number {
  if (val.t === 'string') {
    throw new SketchRuntimeError('Text in quotes can only be used with Serial.print.', line);
  }
  if (val.t === 'void') {
    throw new SketchRuntimeError('This function does not return a value, so it can\'t be used in a calculation.', line);
  }
  return typeof val.v === 'boolean' ? (val.v ? 1 : 0) : (val.v as number);
}

function truthy(val: Value, line: number): boolean {
  return num(val, line) !== 0;
}

/** C-style conversion on assignment / parameter passing / return. */
function coerce(val: Value, to: VarType, line: number): Value {
  if (to === 'void') return VOID;
  const n = num(val, line);
  switch (to) {
    case 'int': return int(n);
    case 'char': return { t: 'char', v: Math.trunc(n) & 0xff };
    case 'bool': return bool(n !== 0);
    case 'float': return float(n);
  }
}

export function formatValue(val: Value, digitsOrBase?: number): string {
  switch (val.t) {
    case 'string': return val.v as string;
    case 'bool': return (val.v as boolean) ? '1' : '0';
    case 'char': return String.fromCharCode((val.v as number) & 0xff);
    case 'float': {
      if (Number.isNaN(val.v as number)) return 'nan'; // matches real Arduino
      const digits = digitsOrBase ?? 2;
      return (val.v as number).toFixed(digits);
    }
    case 'int': {
      const base = digitsOrBase ?? 10;
      const n = Math.trunc(val.v as number);
      return base === 10 ? String(n) : (n >>> 0).toString(base).toUpperCase();
    }
    default: return '';
  }
}

// --- control-flow signals ------------------------------------------------------

class BreakSignal { }
class ContinueSignal { }
class ReturnSignal {
  constructor(public value: Value) { }
}

// --- environment ----------------------------------------------------------------

interface Slot {
  value: Value;
  type: VarType;
  isConst: boolean;
}

class Env {
  private vars = new Map<string, Slot>();

  constructor(private parent: Env | null) { }

  declare(name: string, slot: Slot, line: number): void {
    if (this.vars.has(name)) {
      throw new SketchRuntimeError(`The variable "${name}" is already declared in this scope.`, line);
    }
    this.vars.set(name, slot);
  }

  lookup(name: string): Slot | null {
    return this.vars.get(name) ?? this.parent?.lookup(name) ?? null;
  }
}

// --- yields ----------------------------------------------------------------------

export type VmYield = { type: 'delay'; untilMs: number } | { type: 'tick' };

const TICK: VmYield = { type: 'tick' };
const OPS_PER_TICK = 500;
const MAX_CALL_DEPTH = 100;

// --- runner ----------------------------------------------------------------------

export class SketchRunner {
  private globals = new Env(null);
  private functions = new Map<string, FuncDecl>();
  /** DHT objects by variable name -> the pin they were declared on. */
  private dhtObjects = new Map<string, number>();
  private ops = 0;
  private depth = 0;
  private randState = 0x2f6e2b1;

  /** Line currently executing — used to locate errors thrown by builtins. */
  currentLine = 1;

  constructor(
    private program: Program,
    private io: MachineIO,
  ) {
    for (const item of program.items) {
      if (item.kind === 'func') {
        if (this.functions.has(item.name)) {
          throw new SketchRuntimeError(`The function "${item.name}" is defined twice.`, item.line);
        }
        this.functions.set(item.name, item);
      }
    }
    if (!this.functions.has('setup')) {
      throw new SketchRuntimeError('Every sketch needs a "void setup() { ... }" function.', 1);
    }
    if (!this.functions.has('loop')) {
      throw new SketchRuntimeError('Every sketch needs a "void loop() { ... }" function.', 1);
    }
    this.installConstants();
  }

  private installConstants(): void {
    const consts: Array<[string, Value]> = [
      ['HIGH', int(1)], ['LOW', int(0)],
      ['INPUT', int(0)], ['OUTPUT', int(1)], ['INPUT_PULLUP', int(2)],
      ['LED_BUILTIN', int(13)],
      ['A0', int(14)], ['A1', int(15)], ['A2', int(16)], ['A3', int(17)], ['A4', int(18)], ['A5', int(19)],
      ['PI', float(Math.PI)], ['TWO_PI', float(Math.PI * 2)], ['HALF_PI', float(Math.PI / 2)],
      ['DHT11', int(11)], ['DHT22', int(22)], ['NAN', float(NaN)],
    ];
    for (const [name, value] of consts) {
      this.globals.declare(name, { value, type: value.t as VarType, isConst: true }, 0);
    }
  }

  /** Main generator: globals, setup(), then loop() forever. */
  *run(): Generator<VmYield, void, void> {
    for (const item of this.program.items) {
      if (item.kind === 'vardecl') yield* this.execVarDecl(item, this.globals);
      if (item.kind === 'dhtdecl') yield* this.execDhtDecl(item);
    }
    yield* this.callFunction('setup', [], 1);
    for (;;) {
      yield* this.callFunction('loop', [], 1);
      this.ops += 1;
      if (this.ops >= OPS_PER_TICK) {
        this.ops = 0;
        yield TICK;
      }
    }
  }

  // --- statements ------------------------------------------------------------

  private *execStmt(stmt: Stmt, env: Env): Generator<VmYield, void, void> {
    this.currentLine = stmt.line;
    this.ops += 1;
    if (this.ops >= OPS_PER_TICK) {
      this.ops = 0;
      yield TICK;
    }

    switch (stmt.kind) {
      case 'block': {
        const inner = new Env(env);
        for (const s of stmt.body) yield* this.execStmt(s, inner);
        return;
      }
      case 'vardecl':
        yield* this.execVarDecl(stmt, env);
        return;
      case 'exprstmt':
        yield* this.evalExpr(stmt.expr, env);
        return;
      case 'if': {
        const test = yield* this.evalExpr(stmt.test, env);
        if (truthy(test, stmt.line)) {
          yield* this.execStmt(stmt.consequent, new Env(env));
        } else if (stmt.alternate) {
          yield* this.execStmt(stmt.alternate, new Env(env));
        }
        return;
      }
      case 'while': {
        while (truthy(yield* this.evalExpr(stmt.test, env), stmt.line)) {
          try {
            yield* this.execStmt(stmt.body, new Env(env));
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'dowhile': {
        do {
          try {
            yield* this.execStmt(stmt.body, new Env(env));
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        } while (truthy(yield* this.evalExpr(stmt.test, env), stmt.line));
        return;
      }
      case 'for': {
        const scope = new Env(env);
        if (stmt.init) yield* this.execStmt(stmt.init, scope);
        for (;;) {
          if (stmt.test) {
            const t = yield* this.evalExpr(stmt.test, scope);
            if (!truthy(t, stmt.line)) break;
          }
          try {
            yield* this.execStmt(stmt.body, new Env(scope));
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) throw e;
          }
          if (stmt.update) yield* this.evalExpr(stmt.update, scope);
        }
        return;
      }
      case 'return': {
        const value = stmt.value ? yield* this.evalExpr(stmt.value, env) : VOID;
        throw new ReturnSignal(value);
      }
      case 'break': throw new BreakSignal();
      case 'continue': throw new ContinueSignal();
      case 'empty': return;
    }
  }

  private *execDhtDecl(decl: DhtDecl): Generator<VmYield, void, void> {
    const pin = yield* this.evalExpr(decl.pin, this.globals);
    this.dhtObjects.set(decl.name, Math.trunc(num(pin, decl.line)));
  }

  private *execVarDecl(decl: VarDecl, env: Env): Generator<VmYield, void, void> {
    for (const d of decl.declarations) {
      let value: Value = coerce(int(0), decl.type, d.line);
      if (d.init) {
        const init = yield* this.evalExpr(d.init, env);
        value = coerce(init, decl.type, d.line);
      }
      env.declare(d.name, { value, type: decl.type, isConst: decl.isConst }, d.line);
    }
  }

  // --- expressions -------------------------------------------------------------

  private *evalExpr(expr: Expr, env: Env): Generator<VmYield, Value, void> {
    switch (expr.kind) {
      case 'num': return expr.isFloat ? float(expr.value) : int(expr.value);
      case 'char': return { t: 'char', v: expr.code };
      case 'str': return { t: 'string', v: expr.value };
      case 'bool': return bool(expr.value);
      case 'ident': {
        const slot = env.lookup(expr.name);
        if (!slot) {
          throw new SketchRuntimeError(
            `"${expr.name}" is not defined. Did you forget to declare it, e.g. "int ${expr.name} = 0;"?`,
            expr.line,
          );
        }
        return slot.value;
      }
      case 'assign': {
        const slot = env.lookup(expr.target.name);
        if (!slot) {
          throw new SketchRuntimeError(
            `"${expr.target.name}" is not defined. Declare it first, e.g. "int ${expr.target.name} = 0;".`,
            expr.line,
          );
        }
        if (slot.isConst) {
          throw new SketchRuntimeError(`"${expr.target.name}" is a constant — its value can't be changed.`, expr.line);
        }
        const rhs = yield* this.evalExpr(expr.value, env);
        let next: Value;
        if (expr.op === '=') {
          next = rhs;
        } else {
          const op = expr.op.slice(0, -1) as '+' | '-' | '*' | '/' | '%' | '&' | '|' | '^';
          next = this.binaryOp(op, slot.value, rhs, expr.line);
        }
        slot.value = coerce(next, slot.type, expr.line);
        return slot.value;
      }
      case 'update': {
        const slot = env.lookup(expr.target.name);
        if (!slot) {
          throw new SketchRuntimeError(`"${expr.target.name}" is not defined.`, expr.line);
        }
        if (slot.isConst) {
          throw new SketchRuntimeError(`"${expr.target.name}" is a constant — its value can't be changed.`, expr.line);
        }
        const before = slot.value;
        const delta = expr.op === '++' ? 1 : -1;
        const after = coerce(
          before.t === 'float' ? float(num(before, expr.line) + delta) : int(num(before, expr.line) + delta),
          slot.type,
          expr.line,
        );
        slot.value = after;
        return expr.prefix ? after : before;
      }
      case 'unary': {
        const v = yield* this.evalExpr(expr.operand, env);
        switch (expr.op) {
          case '-': return v.t === 'float' ? float(-num(v, expr.line)) : int(-num(v, expr.line));
          case '+': return v;
          case '!': return bool(!truthy(v, expr.line));
          case '~': return int(~(num(v, expr.line) | 0));
        }
        break;
      }
      case 'logical': {
        const l = yield* this.evalExpr(expr.left, env);
        if (expr.op === '&&') {
          if (!truthy(l, expr.line)) return bool(false);
          return bool(truthy(yield* this.evalExpr(expr.right, env), expr.line));
        }
        if (truthy(l, expr.line)) return bool(true);
        return bool(truthy(yield* this.evalExpr(expr.right, env), expr.line));
      }
      case 'binary': {
        const l = yield* this.evalExpr(expr.left, env);
        const r = yield* this.evalExpr(expr.right, env);
        return this.binaryOp(expr.op, l, r, expr.line);
      }
      case 'cond': {
        const t = yield* this.evalExpr(expr.test, env);
        return truthy(t, expr.line)
          ? yield* this.evalExpr(expr.consequent, env)
          : yield* this.evalExpr(expr.alternate, env);
      }
      case 'call':
        return yield* this.evalCall(expr.callee, expr.args, expr.line, env);
    }
    throw new SketchRuntimeError('Unsupported expression.', (expr as { line: number }).line);
  }

  private binaryOp(op: string, l: Value, r: Value, line: number): Value {
    // String equality is allowed; anything else with strings is not.
    if (l.t === 'string' || r.t === 'string') {
      if ((op === '==' || op === '!=') && l.t === 'string' && r.t === 'string') {
        return bool(op === '==' ? l.v === r.v : l.v !== r.v);
      }
      throw new SketchRuntimeError('Text in quotes can only be used with Serial.print.', line);
    }
    const a = num(l, line);
    const b = num(r, line);
    const isFloat = l.t === 'float' || r.t === 'float';

    switch (op) {
      case '+': return isFloat ? float(a + b) : int(a + b);
      case '-': return isFloat ? float(a - b) : int(a - b);
      case '*': return isFloat ? float(a * b) : int(a * b);
      case '/':
        if (b === 0) throw new SketchRuntimeError('Division by zero.', line);
        return isFloat ? float(a / b) : int(a / b);
      case '%':
        if (isFloat) throw new SketchRuntimeError('% only works with whole numbers (int).', line);
        if (b === 0) throw new SketchRuntimeError('Division by zero (in %).', line);
        return int(a % b);
      case '==': return bool(a === b);
      case '!=': return bool(a !== b);
      case '<': return bool(a < b);
      case '<=': return bool(a <= b);
      case '>': return bool(a > b);
      case '>=': return bool(a >= b);
      case '&': return int((a | 0) & (b | 0));
      case '|': return int((a | 0) | (b | 0));
      case '^': return int((a | 0) ^ (b | 0));
      case '<<': return int((a | 0) << (b | 0));
      case '>>': return int((a | 0) >> (b | 0));
    }
    throw new SketchRuntimeError(`Unsupported operator "${op}".`, line);
  }

  // --- calls ----------------------------------------------------------------------

  private *evalCall(callee: string, argExprs: Expr[], line: number, env: Env): Generator<VmYield, Value, void> {
    const args: Value[] = [];
    for (const a of argExprs) args.push(yield* this.evalExpr(a, env));

    const userFn = this.functions.get(callee);
    if (userFn) return yield* this.callUser(userFn, args, line);

    // DHT object methods: dht.begin() / dht.readTemperature() / dht.readHumidity()
    const dot = callee.indexOf('.');
    if (dot > 0 && this.dhtObjects.has(callee.slice(0, dot))) {
      const pin = this.dhtObjects.get(callee.slice(0, dot))!;
      const method = callee.slice(dot + 1);
      switch (method) {
        case 'begin': return VOID;
        case 'readTemperature': return float(this.io.dhtRead(pin, 'temperature'));
        case 'readHumidity': return float(this.io.dhtRead(pin, 'humidity'));
        default:
          throw new SketchRuntimeError(
            `The DHT sensor only supports begin(), readTemperature() and readHumidity() — not ${method}().`,
            line,
          );
      }
    }

    try {
      return yield* this.callBuiltin(callee, args, line);
    } catch (e) {
      // Builtins (and hardware) may throw plain Errors — locate them.
      if (e instanceof SketchRuntimeError || e instanceof BreakSignal || e instanceof ContinueSignal || e instanceof ReturnSignal) {
        throw e;
      }
      throw new SketchRuntimeError((e as Error).message, line);
    }
  }

  private *callUser(fn: FuncDecl, args: Value[], line: number): Generator<VmYield, Value, void> {
    if (args.length !== fn.params.length) {
      throw new SketchRuntimeError(
        `${fn.name}() expects ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'} but got ${args.length}.`,
        line,
      );
    }
    if (this.depth >= MAX_CALL_DEPTH) {
      throw new SketchRuntimeError(`Too many nested function calls — is ${fn.name}() calling itself forever?`, line);
    }
    this.depth += 1;
    const scope = new Env(this.globals);
    fn.params.forEach((p, i) => {
      scope.declare(p.name, { value: coerce(args[i], p.type, line), type: p.type, isConst: false }, fn.line);
    });
    try {
      yield* this.execStmt(fn.body, scope);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        return fn.retType === 'void' ? VOID : coerce(e.value, fn.retType, this.currentLine);
      }
      throw e;
    } finally {
      this.depth -= 1;
    }
    return fn.retType === 'void' ? VOID : coerce(int(0), fn.retType, fn.line);
  }

  private nextRandom(): number {
    // Deterministic 31-bit LCG, same idea as avr-libc's random().
    this.randState = (this.randState * 1103515245 + 12345) & 0x7fffffff;
    return this.randState;
  }

  private *callBuiltin(name: string, args: Value[], line: number): Generator<VmYield, Value, void> {
    const io = this.io;
    const arity = (min: number, max = min): void => {
      if (args.length < min || args.length > max) {
        const want = min === max ? `${min}` : `${min}-${max}`;
        throw new SketchRuntimeError(`${name}() expects ${want} argument${max === 1 ? '' : 's'} but got ${args.length}.`, line);
      }
    };
    const n = (i: number): number => num(args[i], line);

    switch (name) {
      case 'pinMode': arity(2); io.pinMode(n(0), n(1)); return VOID;
      case 'digitalWrite': arity(2); io.digitalWrite(n(0), n(1)); return VOID;
      case 'digitalRead': arity(1); return int(io.digitalRead(n(0)));
      case 'analogWrite': arity(2); io.analogWrite(n(0), n(1)); return VOID;
      case 'analogRead': arity(1); return int(io.analogRead(n(0)));

      case 'delay': {
        arity(1);
        const ms = Math.max(0, n(0));
        yield { type: 'delay', untilMs: io.millis() + ms };
        return VOID;
      }
      case 'delayMicroseconds': {
        arity(1);
        const us = Math.max(0, n(0));
        if (us >= 1000) yield { type: 'delay', untilMs: io.millis() + Math.round(us / 1000) };
        return VOID;
      }
      case 'millis': arity(0); return int(io.millis());
      case 'micros': arity(0); return int(io.millis() * 1000);

      case 'map': {
        arity(5);
        const [x, inMin, inMax, outMin, outMax] = [n(0), n(1), n(2), n(3), n(4)];
        if (inMax === inMin) throw new SketchRuntimeError('map() needs different "from" bounds.', line);
        return int(((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin);
      }
      case 'constrain': {
        arity(3);
        const v = Math.min(Math.max(n(0), n(1)), n(2));
        return args.some((a) => a.t === 'float') ? float(v) : int(v);
      }
      case 'min': arity(2); return args.some((a) => a.t === 'float') ? float(Math.min(n(0), n(1))) : int(Math.min(n(0), n(1)));
      case 'max': arity(2); return args.some((a) => a.t === 'float') ? float(Math.max(n(0), n(1))) : int(Math.max(n(0), n(1)));
      case 'isnan': arity(1); return bool(Number.isNaN(n(0)));
      case 'abs': arity(1); return args[0].t === 'float' ? float(Math.abs(n(0))) : int(Math.abs(n(0)));
      case 'sq': arity(1); return args[0].t === 'float' ? float(n(0) * n(0)) : int(n(0) * n(0));
      case 'pow': arity(2); return float(Math.pow(n(0), n(1)));
      case 'sqrt': {
        arity(1);
        if (n(0) < 0) throw new SketchRuntimeError('sqrt() of a negative number.', line);
        return float(Math.sqrt(n(0)));
      }

      case 'random': {
        arity(1, 2);
        const lo = args.length === 2 ? n(0) : 0;
        const hi = args.length === 2 ? n(1) : n(0);
        if (hi <= lo) return int(lo);
        return int(lo + (this.nextRandom() % (hi - lo)));
      }
      case 'randomSeed': arity(1); this.randState = (n(0) | 0) || 1; return VOID;

      case 'Serial.begin': arity(1, 2); return VOID;
      case 'Serial.end': case 'Serial.flush': arity(0); return VOID;
      case 'Serial.available': arity(0); return int(0);
      case 'Serial.read': arity(0); return int(-1);
      case 'Serial.print': {
        arity(1, 2);
        io.serialWrite(formatValue(args[0], args.length === 2 ? n(1) : undefined));
        return VOID;
      }
      case 'Serial.println': {
        arity(0, 2);
        const text = args.length === 0 ? '' : formatValue(args[0], args.length === 2 ? n(1) : undefined);
        io.serialWrite(text + '\n');
        return VOID;
      }
      case 'Serial.write': {
        arity(1);
        io.serialWrite(String.fromCharCode(Math.trunc(n(0)) & 0xff));
        return VOID;
      }

      case 'tone': case 'noTone':
        throw new SketchRuntimeError(`${name}() isn't supported yet — the simulator has no buzzer component.`, line);
    }

    if (name.includes('.')) {
      throw new SketchRuntimeError(`"${name}" isn't available in the simulator yet.`, line);
    }
    throw new SketchRuntimeError(
      `The function "${name}" doesn't exist. Check the spelling, or define it with "void ${name}() { ... }".`,
      line,
    );
  }

  callFunction(name: string, args: Value[], line: number): Generator<VmYield, Value, void> {
    const fn = this.functions.get(name)!;
    return this.callUser(fn, args, line);
  }
}
