// AST for the supported Arduino C++ subset. Every node carries `line` (1-based)
// so the runtime can report friendly, located errors.

export type VarType = 'int' | 'float' | 'bool' | 'char' | 'void';

// --- Expressions -----------------------------------------------------------

export type Expr =
  | NumLit
  | CharLit
  | StrLit
  | BoolLit
  | Ident
  | Assign
  | Binary
  | Logical
  | Unary
  | Update
  | Conditional
  | Call;

export interface NumLit { kind: 'num'; value: number; isFloat: boolean; line: number }
export interface CharLit { kind: 'char'; code: number; line: number }
export interface StrLit { kind: 'str'; value: string; line: number }
export interface BoolLit { kind: 'bool'; value: boolean; line: number }
export interface Ident { kind: 'ident'; name: string; line: number }

export interface Assign {
  kind: 'assign';
  op: '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '&=' | '|=' | '^=';
  target: Ident;
  value: Expr;
  line: number;
}

export interface Binary {
  kind: 'binary';
  op: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&' | '|' | '^' | '<<' | '>>';
  left: Expr;
  right: Expr;
  line: number;
}

export interface Logical { kind: 'logical'; op: '&&' | '||'; left: Expr; right: Expr; line: number }
export interface Unary { kind: 'unary'; op: '-' | '+' | '!' | '~'; operand: Expr; line: number }
export interface Update { kind: 'update'; op: '++' | '--'; target: Ident; prefix: boolean; line: number }
export interface Conditional { kind: 'cond'; test: Expr; consequent: Expr; alternate: Expr; line: number }

export interface Call {
  kind: 'call';
  /** Plain function name, or "Serial.print" style for method calls. */
  callee: string;
  args: Expr[];
  line: number;
}

// --- Statements --------------------------------------------------------------

export type Stmt =
  | Block
  | VarDecl
  | ExprStmt
  | IfStmt
  | WhileStmt
  | DoWhileStmt
  | ForStmt
  | ReturnStmt
  | BreakStmt
  | ContinueStmt
  | EmptyStmt;

export interface Block { kind: 'block'; body: Stmt[]; line: number }

export interface VarDecl {
  kind: 'vardecl';
  type: VarType;
  isConst: boolean;
  declarations: Array<{ name: string; init: Expr | null; line: number }>;
  line: number;
}

export interface ExprStmt { kind: 'exprstmt'; expr: Expr; line: number }
export interface IfStmt { kind: 'if'; test: Expr; consequent: Stmt; alternate: Stmt | null; line: number }
export interface WhileStmt { kind: 'while'; test: Expr; body: Stmt; line: number }
export interface DoWhileStmt { kind: 'dowhile'; body: Stmt; test: Expr; line: number }
export interface ForStmt {
  kind: 'for';
  init: Stmt | null; // VarDecl or ExprStmt
  test: Expr | null;
  update: Expr | null;
  body: Stmt;
  line: number;
}
export interface ReturnStmt { kind: 'return'; value: Expr | null; line: number }
export interface BreakStmt { kind: 'break'; line: number }
export interface ContinueStmt { kind: 'continue'; line: number }
export interface EmptyStmt { kind: 'empty'; line: number }

// --- Top level ---------------------------------------------------------------

export interface FuncDecl {
  kind: 'func';
  retType: VarType;
  name: string;
  params: Array<{ type: VarType; name: string }>;
  body: Block;
  line: number;
}

/** `DHT dht(2, DHT11);` — the one library object we support. */
export interface DhtDecl {
  kind: 'dhtdecl';
  name: string;
  pin: Expr;
  line: number;
}

export interface Program {
  /** Globals, functions and library objects in source order. */
  items: Array<VarDecl | FuncDecl | DhtDecl>;
}
