// Recursive-descent parser for the beginner Arduino C++ subset.
// Unsupported constructs get clear "not supported yet" errors with positions.

import type {
  Assign, Block, Expr, ForStmt, FuncDecl, Ident, Program, Stmt, VarDecl, VarType,
} from './ast';
import { SketchParseError } from './errors';
import { preprocess } from './preprocess';
import { tokenize, type Token } from './tokenizer';

const TYPE_KEYWORDS = new Set([
  'int', 'long', 'short', 'byte', 'float', 'double', 'bool', 'boolean', 'char', 'void',
  'unsigned', 'signed', 'const', 'static', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'word', 'size_t',
]);

const BASE_TYPE: Record<string, VarType> = {
  int: 'int', long: 'int', short: 'int', byte: 'int', word: 'int', size_t: 'int',
  uint8_t: 'int', int8_t: 'int', uint16_t: 'int', int16_t: 'int', uint32_t: 'int', int32_t: 'int',
  float: 'float', double: 'float',
  bool: 'bool', boolean: 'bool',
  char: 'char',
  void: 'void',
};

export function parseSketch(source: string): Program {
  const pre = preprocess(source);
  const tokens = tokenize(pre.source, pre.defines);
  return new Parser(tokens).parseProgram();
}

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  // --- token helpers ---------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private isPunct(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === 'punct' && t.text === text;
  }

  private isIdent(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === 'ident' && t.text === text;
  }

  private eatPunct(text: string): boolean {
    if (this.isPunct(text)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectPunct(text: string, what?: string): Token {
    if (!this.isPunct(text)) {
      const t = this.peek();
      const found = t.kind === 'eof' ? 'the end of the sketch' : `"${t.text}"`;
      this.fail(`Expected "${text}"${what ? ` ${what}` : ''} but found ${found}.`, t);
    }
    return this.next();
  }

  private fail(message: string, at?: Token): never {
    const t = at ?? this.peek();
    throw new SketchParseError(message, t.line, t.col);
  }

  // --- types -------------------------------------------------------------------

  private looksLikeType(offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === 'ident' && (TYPE_KEYWORDS.has(t.text) || t.text === 'String');
  }

  /** Parse a type prefix: [const] [unsigned|signed] base. Returns mapped type. */
  private parseType(): { type: VarType; isConst: boolean } {
    let isConst = false;
    for (;;) {
      if (this.isIdent('const') || this.isIdent('static')) {
        if (this.isIdent('const')) isConst = true;
        this.next();
        continue;
      }
      break;
    }
    let unsigned = false;
    if (this.isIdent('unsigned') || this.isIdent('signed')) {
      unsigned = true;
      this.next();
    }
    const t = this.peek();
    if (t.kind === 'ident' && t.text === 'String') {
      this.fail('The String class is not supported yet — use Serial.print with quoted text instead.', t);
    }
    if (t.kind !== 'ident' || !(t.text in BASE_TYPE)) {
      if (unsigned) return { type: 'int', isConst }; // bare `unsigned x`
      this.fail(`Expected a type here (like int, float or void) but found "${t.text}".`, t);
    }
    this.next();
    // `unsigned int`, `long long` etc — swallow extra int-ish words.
    while (this.isIdent('int') || this.isIdent('long')) this.next();
    return { type: BASE_TYPE[t.text], isConst };
  }

  private rejectPointerOrArray(context: string): void {
    const t = this.peek();
    if (this.isPunct('*') || this.isPunct('&')) {
      this.fail(`Pointers and references are not supported yet (${context}).`, t);
    }
  }

  // --- program -------------------------------------------------------------------

  parseProgram(): Program {
    const items: Program['items'] = [];
    while (this.peek().kind !== 'eof') {
      if (this.eatPunct(';')) continue;
      const t = this.peek();
      // `DHT dht(2, DHT11);` — DHT sensor object declaration.
      if (this.isIdent('DHT') && this.peek(1).kind === 'ident' && this.isPunct('(', 2)) {
        this.next();
        const nameTok = this.next();
        this.expectPunct('(');
        const args = this.parseArgs();
        if (args.length !== 2) {
          this.fail('DHT needs two arguments: the pin and the sensor type, e.g. DHT dht(2, DHT11);', nameTok);
        }
        this.expectPunct(';', 'after the DHT declaration');
        items.push({ kind: 'dhtdecl', name: nameTok.text, pin: args[0], line: nameTok.line });
        continue;
      }
      if (!this.looksLikeType()) {
        if (t.kind === 'ident' && (t.text === 'if' || t.text === 'for' || t.text === 'while')) {
          this.fail(`"${t.text}" can't be used outside a function — put it inside setup() or loop().`, t);
        }
        this.fail(
          `Expected a declaration like "int x = 0;" or "void setup() { ... }" but found "${t.text || 'the end of the sketch'}".`,
          t,
        );
      }
      const { type, isConst } = this.parseType();
      this.rejectPointerOrArray('top level');
      const nameTok = this.peek();
      if (nameTok.kind !== 'ident') this.fail('Expected a name here.', nameTok);
      this.next();

      if (this.isPunct('(')) {
        items.push(this.parseFunctionRest(type, nameTok));
      } else {
        items.push(this.parseVarDeclRest(type, isConst, nameTok));
      }
    }
    return { items };
  }

  private parseFunctionRest(retType: VarType, nameTok: Token): FuncDecl {
    this.expectPunct('(');
    const params: FuncDecl['params'] = [];
    if (!this.isPunct(')')) {
      do {
        if (this.isIdent('void') && this.isPunct(')', 1)) {
          this.next(); // void parameter list: f(void)
          break;
        }
        const { type } = this.parseType();
        this.rejectPointerOrArray('in parameters');
        const p = this.peek();
        if (p.kind !== 'ident') this.fail('Expected a parameter name.', p);
        this.next();
        if (this.isPunct('[')) this.fail('Arrays are not supported yet.', this.peek());
        params.push({ type, name: p.text });
      } while (this.eatPunct(','));
    }
    this.expectPunct(')', 'to close the parameter list');
    if (this.isPunct(';')) {
      this.fail('Function declarations without a body are not needed — just define the function once, with { }.', this.peek());
    }
    const body = this.parseBlock();
    return { kind: 'func', retType, name: nameTok.text, params, body, line: nameTok.line };
  }

  private parseVarDeclRest(type: VarType, isConst: boolean, firstName: Token): VarDecl {
    if (type === 'void') this.fail('Variables can\'t have type void.', firstName);
    const declarations: VarDecl['declarations'] = [];
    let nameTok = firstName;
    for (;;) {
      if (this.isPunct('[')) this.fail('Arrays are not supported yet.', this.peek());
      let init: Expr | null = null;
      if (this.eatPunct('=')) init = this.parseAssignExpr();
      declarations.push({ name: nameTok.text, init, line: nameTok.line });
      if (!this.eatPunct(',')) break;
      const t = this.peek();
      if (t.kind !== 'ident') this.fail('Expected another variable name after ",".', t);
      this.next();
      nameTok = t;
    }
    this.expectPunct(';', 'at the end of this declaration');
    return { kind: 'vardecl', type, isConst, declarations, line: firstName.line };
  }

  // --- statements -------------------------------------------------------------------

  private parseBlock(): Block {
    const open = this.expectPunct('{');
    const body: Stmt[] = [];
    while (!this.isPunct('}')) {
      if (this.peek().kind === 'eof') {
        this.fail('This { block is never closed — add a matching }.', open);
      }
      body.push(this.parseStmt());
    }
    this.expectPunct('}');
    return { kind: 'block', body, line: open.line };
  }

  private parseStmt(): Stmt {
    const t = this.peek();

    if (this.isPunct('{')) return this.parseBlock();
    if (this.eatPunct(';')) return { kind: 'empty', line: t.line };

    if (t.kind === 'ident') {
      switch (t.text) {
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'do': return this.parseDoWhile();
        case 'for': return this.parseFor();
        case 'return': {
          this.next();
          let value: Expr | null = null;
          if (!this.isPunct(';')) value = this.parseExpr();
          this.expectPunct(';', 'after return');
          return { kind: 'return', value, line: t.line };
        }
        case 'break':
          this.next();
          this.expectPunct(';', 'after break');
          return { kind: 'break', line: t.line };
        case 'continue':
          this.next();
          this.expectPunct(';', 'after continue');
          return { kind: 'continue', line: t.line };
        case 'switch':
          this.fail('switch is not supported yet — use if / else if instead.', t);
      }
      if (this.looksLikeType() && this.peek(1).kind === 'ident' && !this.isPunct('(', 2)) {
        const { type, isConst } = this.parseType();
        this.rejectPointerOrArray('in this declaration');
        const nameTok = this.next();
        return this.parseVarDeclRest(type, isConst, nameTok);
      }
      if (this.looksLikeType() && (this.peek(1).kind !== 'ident' || this.isPunct('(', 2))) {
        // `int foo() {...}` nested, or stray type keyword
        if (this.peek(1).kind === 'ident' && this.isPunct('(', 2)) {
          this.fail('Functions can\'t be defined inside another function — move it to the top level.', t);
        }
        if (t.text === 'String') this.fail('The String class is not supported yet.', t);
      }
    }

    const expr = this.parseExpr();
    this.expectPunct(';', 'at the end of this statement');
    return { kind: 'exprstmt', expr, line: t.line };
  }

  private parseIf(): Stmt {
    const t = this.next(); // if
    this.expectPunct('(', 'after if');
    const test = this.parseExpr();
    this.expectPunct(')', 'to close the if condition');
    const consequent = this.parseStmt();
    let alternate: Stmt | null = null;
    if (this.isIdent('else')) {
      this.next();
      alternate = this.parseStmt();
    }
    return { kind: 'if', test, consequent, alternate, line: t.line };
  }

  private parseWhile(): Stmt {
    const t = this.next(); // while
    this.expectPunct('(', 'after while');
    const test = this.parseExpr();
    this.expectPunct(')', 'to close the while condition');
    const body = this.parseStmt();
    return { kind: 'while', test, body, line: t.line };
  }

  private parseDoWhile(): Stmt {
    const t = this.next(); // do
    const body = this.parseStmt();
    if (!this.isIdent('while')) this.fail('Expected "while (condition);" after the do { } body.', this.peek());
    this.next();
    this.expectPunct('(', 'after while');
    const test = this.parseExpr();
    this.expectPunct(')');
    this.expectPunct(';', 'after do/while');
    return { kind: 'dowhile', body, test, line: t.line };
  }

  private parseFor(): ForStmt {
    const t = this.next(); // for
    this.expectPunct('(', 'after for');

    let init: Stmt | null = null;
    if (!this.isPunct(';')) {
      if (this.looksLikeType()) {
        const { type, isConst } = this.parseType();
        this.rejectPointerOrArray('in the for loop');
        const nameTok = this.peek();
        if (nameTok.kind !== 'ident') this.fail('Expected a variable name.', nameTok);
        this.next();
        init = this.parseVarDeclRest(type, isConst, nameTok); // consumes ';'
      } else {
        const expr = this.parseExpr();
        this.expectPunct(';', 'after the for-loop start');
        init = { kind: 'exprstmt', expr, line: t.line };
      }
    } else {
      this.next();
    }

    let test: Expr | null = null;
    if (!this.isPunct(';')) test = this.parseExpr();
    this.expectPunct(';', 'after the for-loop condition');

    let update: Expr | null = null;
    if (!this.isPunct(')')) update = this.parseExpr();
    this.expectPunct(')', 'to close the for loop header');

    const body = this.parseStmt();
    return { kind: 'for', init, test, update, body, line: t.line };
  }

  // --- expressions -------------------------------------------------------------------
  // Precedence: assign > ternary > || > && > | > ^ > & > equality > relational
  //             > shift > additive > multiplicative > unary > postfix > primary

  private parseExpr(): Expr {
    return this.parseAssignExpr();
  }

  parseAssignExpr(): Expr {
    const left = this.parseTernary();
    const t = this.peek();
    if (t.kind === 'punct' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].includes(t.text)) {
      if (left.kind !== 'ident') {
        this.fail('You can only assign to a variable.', t);
      }
      this.next();
      const value = this.parseAssignExpr();
      const assign: Assign = { kind: 'assign', op: t.text as Assign['op'], target: left as Ident, value, line: t.line };
      return assign;
    }
    return left;
  }

  private parseTernary(): Expr {
    const test = this.parseBinary(0);
    if (this.isPunct('?')) {
      const t = this.next();
      const consequent = this.parseAssignExpr();
      this.expectPunct(':', 'in the ?: expression');
      const alternate = this.parseAssignExpr();
      return { kind: 'cond', test, consequent, alternate, line: t.line };
    }
    return test;
  }

  private static BIN_LEVELS: string[][] = [
    ['||'],
    ['&&'],
    ['|'],
    ['^'],
    ['&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['<<', '>>'],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  private parseBinary(level: number): Expr {
    if (level >= Parser.BIN_LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.kind === 'punct' && Parser.BIN_LEVELS[level].includes(t.text)) {
        this.next();
        const right = this.parseBinary(level + 1);
        if (t.text === '&&' || t.text === '||') {
          left = { kind: 'logical', op: t.text, left, right, line: t.line };
        } else {
          left = { kind: 'binary', op: t.text as never, left, right, line: t.line };
        }
      } else {
        return left;
      }
    }
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'punct') {
      if (['-', '+', '!', '~'].includes(t.text)) {
        this.next();
        const operand = this.parseUnary();
        return { kind: 'unary', op: t.text as never, operand, line: t.line };
      }
      if (t.text === '++' || t.text === '--') {
        this.next();
        const operand = this.parseUnary();
        if (operand.kind !== 'ident') this.fail(`${t.text} needs a variable.`, t);
        return { kind: 'update', op: t.text, target: operand, prefix: true, line: t.line };
      }
      if (t.text === '*' || t.text === '&') {
        this.fail('Pointers are not supported yet.', t);
      }
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (this.isPunct('++') || this.isPunct('--')) {
        if (expr.kind !== 'ident') this.fail(`${t.text} needs a variable.`, t);
        this.next();
        expr = { kind: 'update', op: t.text as '++' | '--', target: expr, prefix: false, line: t.line };
        continue;
      }
      if (this.isPunct('.')) {
        if (expr.kind !== 'ident') this.fail('Unexpected "." here.', t);
        this.next();
        const method = this.peek();
        if (method.kind !== 'ident') this.fail('Expected a method name after ".".', method);
        this.next();
        this.expectPunct('(', `to call ${expr.name}.${method.text}`);
        const args = this.parseArgs();
        expr = { kind: 'call', callee: `${expr.name}.${method.text}`, args, line: t.line };
        continue;
      }
      if (this.isPunct('(')) {
        if (expr.kind !== 'ident') this.fail('Only named functions can be called.', t);
        this.next();
        const args = this.parseArgs();
        expr = { kind: 'call', callee: expr.name, args, line: expr.line };
        continue;
      }
      if (this.isPunct('[')) {
        this.fail('Arrays are not supported yet.', t);
      }
      return expr;
    }
  }

  private parseArgs(): Expr[] {
    const args: Expr[] = [];
    if (!this.isPunct(')')) {
      do {
        args.push(this.parseAssignExpr());
      } while (this.eatPunct(','));
    }
    this.expectPunct(')', 'to close the function call');
    return args;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === 'num') {
      this.next();
      return { kind: 'num', value: t.value!, isFloat: t.isFloat === true, line: t.line };
    }
    if (t.kind === 'char') {
      this.next();
      return { kind: 'char', code: t.value!, line: t.line };
    }
    if (t.kind === 'str') {
      this.next();
      return { kind: 'str', value: t.text, line: t.line };
    }
    if (t.kind === 'ident') {
      if (t.text === 'true' || t.text === 'false') {
        this.next();
        return { kind: 'bool', value: t.text === 'true', line: t.line };
      }
      if (TYPE_KEYWORDS.has(t.text)) {
        this.fail(`Unexpected "${t.text}" in the middle of an expression.`, t);
      }
      this.next();
      return { kind: 'ident', name: t.text, line: t.line };
    }
    if (this.isPunct('(')) {
      this.next();
      // Reject C-style casts with a friendly message: (int)x
      if (this.looksLikeType() && this.isPunct(')', 1)) {
        this.fail('Type casts like (int)x are not supported yet.', this.peek());
      }
      const expr = this.parseExpr();
      this.expectPunct(')', 'to close this parenthesis');
      return expr;
    }
    const found = t.kind === 'eof' ? 'the end of the sketch' : `"${t.text}"`;
    this.fail(`Expected a value or variable here but found ${found}.`, t);
  }
}
