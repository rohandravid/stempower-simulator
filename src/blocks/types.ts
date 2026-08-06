// Data model for Block Mode: a small, Scratch-like visual representation of
// the same Arduino sketches the text editor produces. Every expression "hole"
// is kept as raw source text (validated on demand via fragments.ts) rather
// than its own nested block tree — this covers the full expression grammar
// without having to build a second drag-and-drop system for values.

import type { VarType } from '../interpreter/ast';

export type BlockId = string;

let counter = 0;
export function newBlockId(): BlockId {
  counter += 1;
  return `b${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export type PinModeValue = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP';
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=';

export type BlockStmt =
  | { id: BlockId; kind: 'pinMode'; pin: string; mode: PinModeValue }
  | { id: BlockId; kind: 'digitalWrite'; pin: string; value: string }
  | { id: BlockId; kind: 'analogWrite'; pin: string; value: string }
  | { id: BlockId; kind: 'delay'; ms: string }
  | { id: BlockId; kind: 'serialBegin'; baud: string }
  | { id: BlockId; kind: 'serialPrint'; value: string; newline: boolean }
  | { id: BlockId; kind: 'dhtBegin'; name: string }
  | { id: BlockId; kind: 'varDecl'; type: VarType; isConst: boolean; name: string; value: string }
  | { id: BlockId; kind: 'varSet'; name: string; op: AssignOp; value: string }
  | { id: BlockId; kind: 'if'; cond: string; then: BlockStmt[]; else: BlockStmt[] | null }
  | { id: BlockId; kind: 'while'; cond: string; body: BlockStmt[] }
  | { id: BlockId; kind: 'repeat'; count: string; varName: string; body: BlockStmt[] }
  | { id: BlockId; kind: 'raw'; code: string };

export type BlockGlobal =
  | { id: BlockId; kind: 'globalVar'; type: VarType; isConst: boolean; name: string; value: string }
  | { id: BlockId; kind: 'globalDht'; name: string; pin: string }
  | { id: BlockId; kind: 'globalRaw'; code: string };

export interface BlockProgram {
  globals: BlockGlobal[];
  setup: BlockStmt[];
  loop: BlockStmt[];
}

export function emptyProgram(): BlockProgram {
  return { globals: [], setup: [], loop: [] };
}

/** Every stack of statements in a program, addressed by a stable string id. */
export type ListId = 'setup' | 'loop' | string; // `${blockId}:then` | `${blockId}:else` | `${blockId}:body`

function childListIds(b: BlockStmt): ListId[] {
  if (b.kind === 'if') return b.else ? [`${b.id}:then`, `${b.id}:else`] : [`${b.id}:then`];
  if (b.kind === 'while' || b.kind === 'repeat') return [`${b.id}:body`];
  return [];
}

function getList(program: BlockProgram, listId: ListId): BlockStmt[] | undefined {
  if (listId === 'setup') return program.setup;
  if (listId === 'loop') return program.loop;
  const found = findBlockAndList(program, (b) => childListIds(b).includes(listId));
  if (!found) return undefined;
  const [, key] = listId.split(':') as [string, 'then' | 'else' | 'body'];
  const block = found.block;
  if (block.kind === 'if' && key === 'then') return block.then;
  if (block.kind === 'if' && key === 'else') return block.else ?? undefined;
  if ((block.kind === 'while' || block.kind === 'repeat') && key === 'body') return block.body;
  return undefined;
}

/** Depth-first search for the first block matching `pred`, returned with its parent list. */
function findBlockAndList(
  program: BlockProgram,
  pred: (b: BlockStmt) => boolean,
): { block: BlockStmt; list: BlockStmt[] } | undefined {
  function scan(list: BlockStmt[]): { block: BlockStmt; list: BlockStmt[] } | undefined {
    for (const b of list) {
      if (pred(b)) return { block: b, list };
      if (b.kind === 'if') {
        const inThen = scan(b.then);
        if (inThen) return inThen;
        if (b.else) {
          const inElse = scan(b.else);
          if (inElse) return inElse;
        }
      } else if (b.kind === 'while' || b.kind === 'repeat') {
        const inBody = scan(b.body);
        if (inBody) return inBody;
      }
    }
    return undefined;
  }
  return scan(program.setup) ?? scan(program.loop);
}

export function findBlockById(program: BlockProgram, id: BlockId): BlockStmt | undefined {
  if (id === 'setup' || id === 'loop') return undefined;
  return findBlockAndList(program, (b) => b.id === id)?.block;
}

/** Bottom-up rewrite of every statement list in the program (setup, loop, and every nested body). */
export function mapAllLists(
  program: BlockProgram,
  fn: (list: BlockStmt[], listId: ListId) => BlockStmt[],
): BlockProgram {
  function mapBlock(b: BlockStmt): BlockStmt {
    if (b.kind === 'if') {
      return {
        ...b,
        then: mapList(b.then, `${b.id}:then`),
        else: b.else ? mapList(b.else, `${b.id}:else`) : null,
      };
    }
    if (b.kind === 'while' || b.kind === 'repeat') {
      return { ...b, body: mapList(b.body, `${b.id}:body`) };
    }
    return b;
  }
  function mapList(list: BlockStmt[], listId: ListId): BlockStmt[] {
    return fn(list.map(mapBlock), listId);
  }
  return { ...program, setup: mapList(program.setup, 'setup'), loop: mapList(program.loop, 'loop') };
}

export function updateList(program: BlockProgram, listId: ListId, updater: (list: BlockStmt[]) => BlockStmt[]): BlockProgram {
  return mapAllLists(program, (list, id) => (id === listId ? updater(list) : list));
}

export function updateBlock(program: BlockProgram, id: BlockId, patch: (b: BlockStmt) => BlockStmt): BlockProgram {
  return mapAllLists(program, (list) => list.map((b) => (b.id === id ? patch(b) : b)));
}

export function insertAt(program: BlockProgram, listId: ListId, index: number, block: BlockStmt): BlockProgram {
  return updateList(program, listId, (list) => [...list.slice(0, index), block, ...list.slice(index)]);
}

export function removeById(program: BlockProgram, id: BlockId): { program: BlockProgram; removed: BlockStmt | null } {
  let removed: BlockStmt | null = null;
  const next = mapAllLists(program, (list) => {
    const hit = list.find((b) => b.id === id);
    if (!hit) return list;
    removed = hit;
    return list.filter((b) => b.id !== id);
  });
  return { program: next, removed };
}

/** All list ids nested inside `block` (used to forbid dropping a block into its own subtree). */
export function descendantListIds(block: BlockStmt): ListId[] {
  const out: ListId[] = [];
  function visit(b: BlockStmt) {
    if (b.kind === 'if') {
      out.push(`${b.id}:then`);
      b.then.forEach(visit);
      if (b.else) {
        out.push(`${b.id}:else`);
        b.else.forEach(visit);
      }
    } else if (b.kind === 'while' || b.kind === 'repeat') {
      out.push(`${b.id}:body`);
      b.body.forEach(visit);
    }
  }
  visit(block);
  return out;
}

export function moveBlock(program: BlockProgram, id: BlockId, targetListId: ListId, index: number): BlockProgram {
  const block = findBlockById(program, id);
  if (!block) return program;
  if (targetListId === id || descendantListIds(block).includes(targetListId)) return program; // no-op: can't nest inside itself
  const { program: without, removed } = removeById(program, id);
  if (!removed) return program;
  // If the removed block sat earlier in the *same* list as the target, later
  // indices shift left by one — recompute the index against the post-removal list.
  const list = getList(without, targetListId) ?? [];
  const clampedIndex = Math.min(index, list.length);
  return insertAt(without, targetListId, clampedIndex, removed);
}

export { getList };
