// The interactive Block Mode editor: owns the BlockProgram derived from the
// sketch's source text, and keeps that text in sync as blocks are edited.
// Mirrors the Editor component's contract exactly (value/onChange), so
// App.tsx can swap between the two without either one knowing the other exists.

import { useEffect, useRef, useState } from 'react';
import { blockProgramToCode } from '../../blocks/codegen';
import { astToBlocks } from '../../blocks/fromAst';
import {
  type BlockGlobal,
  type BlockId,
  type BlockProgram,
  type BlockStmt,
  type ListId,
  emptyProgram,
  insertAt,
  moveBlock,
  removeById,
  updateBlock,
  updateList,
} from '../../blocks/types';
import { parseSketch } from '../../interpreter/parser';
import { type GlobalActions, GlobalsStack, type StackActions, BlockStack } from './BlockStack';

function convert(code: string): { program: BlockProgram; error: string | null } {
  try {
    return { program: astToBlocks(parseSketch(code)), error: null };
  } catch (err) {
    return { program: emptyProgram(), error: err instanceof Error ? err.message : String(err) };
  }
}

function swap<T extends { id: BlockId }>(list: T[], id: BlockId, dir: -1 | 1): T[] {
  const i = list.findIndex((b) => b.id === id);
  if (i < 0) return list;
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function insertArr<T>(list: T[], index: number, item: T): T[] {
  return [...list.slice(0, index), item, ...list.slice(index)];
}

export function BlockEditor(props: { value: string; onChange: (v: string) => void }) {
  const [program, setProgram] = useState<BlockProgram>(() => convert(props.value).program);
  const [convertError, setConvertError] = useState<string | null>(() => convert(props.value).error);
  const [openGap, setOpenGap] = useState<string | null>(null);
  const [clipboardStmt, setClipboardStmt] = useState<BlockStmt | null>(null);
  const [clipboardGlobal, setClipboardGlobal] = useState<BlockGlobal | null>(null);
  const lastEmitted = useRef(props.value);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  // The code changed from outside block mode (a tutorial inserted a snippet,
  // an example loaded, Spark rewrote the sketch) — re-derive blocks from it.
  useEffect(() => {
    if (props.value === lastEmitted.current) return;
    const { program: next, error } = convert(props.value);
    if (!error) setProgram(next);
    setConvertError(error);
    lastEmitted.current = props.value;
  }, [props.value]);

  function updateProgram(next: BlockProgram) {
    setProgram(next);
    const code = blockProgramToCode(next);
    lastEmitted.current = code;
    onChangeRef.current(code);
  }

  const stmtActions: StackActions = {
    openGap,
    setOpenGap,
    clipboard: clipboardStmt,
    insert: (listId: ListId, index, block) => updateProgram(insertAt(program, listId, index, block)),
    paste: (listId: ListId, index) => {
      if (!clipboardStmt) return;
      updateProgram(insertAt(program, listId, index, clipboardStmt));
      setClipboardStmt(null);
    },
    dropMove: (id, listId, index) => updateProgram(moveBlock(program, id, listId, index)),
    cut: (id) => {
      const { program: next, removed } = removeById(program, id);
      if (removed) {
        updateProgram(next);
        setClipboardStmt(removed);
      }
    },
    remove: (id) => updateProgram(removeById(program, id).program),
    moveUpDown: (listId: ListId, id, dir) => updateProgram(updateList(program, listId, (list) => swap(list, id, dir))),
    patch: (id, next) => updateProgram(updateBlock(program, id, () => next)),
    addElse: (id) => updateProgram(updateBlock(program, id, (b) => (b.kind === 'if' ? { ...b, else: [] } : b))),
    removeElse: (id) => updateProgram(updateBlock(program, id, (b) => (b.kind === 'if' ? { ...b, else: null } : b))),
  };

  const globalActions: GlobalActions = {
    openGap,
    setOpenGap,
    clipboard: clipboardGlobal,
    insert: (index, g) => updateProgram({ ...program, globals: insertArr(program.globals, index, g) }),
    paste: (index) => {
      if (!clipboardGlobal) return;
      updateProgram({ ...program, globals: insertArr(program.globals, index, clipboardGlobal) });
      setClipboardGlobal(null);
    },
    dropMove: (id, index) => {
      const from = program.globals.findIndex((g) => g.id === id);
      if (from < 0) return;
      const item = program.globals[from];
      const without = program.globals.filter((g) => g.id !== id);
      updateProgram({ ...program, globals: insertArr(without, Math.min(index, without.length), item) });
    },
    cut: (id) => {
      const item = program.globals.find((g) => g.id === id);
      if (!item) return;
      updateProgram({ ...program, globals: program.globals.filter((g) => g.id !== id) });
      setClipboardGlobal(item);
    },
    remove: (id) => updateProgram({ ...program, globals: program.globals.filter((g) => g.id !== id) }),
    moveUpDown: (id, dir) => updateProgram({ ...program, globals: swap(program.globals, id, dir) }),
    patch: (id, next) => updateProgram({ ...program, globals: program.globals.map((g) => (g.id === id ? next : g)) }),
  };

  return (
    <div className="block-editor">
      {convertError && (
        <div className="block-editor-banner">
          Couldn't turn the current code into blocks ({convertError}). Keep building here, or switch to Text mode to
          fix it directly.
        </div>
      )}
      <div className="block-editor-scroll">
        <section className="blk-section">
          <h3 className="blk-section-title">🧮 Variables</h3>
          <GlobalsStack list={program.globals} actions={globalActions} />
        </section>
        <section className="blk-section">
          <h3 className="blk-section-title">
            🔧 setup() <span className="blk-section-hint">runs once, when the sketch starts</span>
          </h3>
          <BlockStack list={program.setup} listId="setup" depth={0} actions={stmtActions} />
        </section>
        <section className="blk-section">
          <h3 className="blk-section-title">
            🔁 loop() <span className="blk-section-hint">runs over and over, forever</span>
          </h3>
          <BlockStack list={program.loop} listId="loop" depth={0} actions={stmtActions} />
        </section>
      </div>
    </div>
  );
}
