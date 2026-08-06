// Recursive renderer for a sequence of blocks ("a stack", Scratch's term).
// Two modes: interactive (an `actions` object is supplied — used by the live
// BlockEditor) and read-only (no `actions` — used by the tutorial preview).
// Both share every bit of rendering code so the preview always looks exactly
// like what you'd get by actually building it.

import { useState } from 'react';
import type { BlockGlobal, BlockId, BlockStmt, ListId } from '../../blocks/types';
import { newBlockId } from '../../blocks/types';
import {
  AssignOpField,
  ExprField,
  HighLowField,
  NameField,
  PinField,
  PinModeField,
  VarTypeField,
} from './fields';

// --- shared action bundles ----------------------------------------------------

export interface StackActions {
  openGap: string | null;
  setOpenGap: (key: string | null) => void;
  clipboard: BlockStmt | null;
  insert: (listId: ListId, index: number, block: BlockStmt) => void;
  paste: (listId: ListId, index: number) => void;
  dropMove: (id: BlockId, listId: ListId, index: number) => void;
  cut: (id: BlockId) => void;
  remove: (id: BlockId) => void;
  moveUpDown: (listId: ListId, id: BlockId, dir: -1 | 1) => void;
  patch: (id: BlockId, next: BlockStmt) => void;
  addElse: (id: BlockId) => void;
  removeElse: (id: BlockId) => void;
}

export interface GlobalActions {
  openGap: string | null;
  setOpenGap: (key: string | null) => void;
  clipboard: BlockGlobal | null;
  insert: (index: number, g: BlockGlobal) => void;
  paste: (index: number) => void;
  dropMove: (id: BlockId, index: number) => void;
  cut: (id: BlockId) => void;
  remove: (id: BlockId) => void;
  moveUpDown: (id: BlockId, dir: -1 | 1) => void;
  patch: (id: BlockId, next: BlockGlobal) => void;
}

// --- templates offered by the "add a block" panel -------------------------------

interface Template {
  key: string;
  label: string;
  icon: string;
  category: 'pins' | 'control' | 'variables' | 'serial' | 'sensors' | 'custom';
  make: () => BlockStmt;
}

const STMT_TEMPLATES: Template[] = [
  { key: 'pinMode', label: 'Set pin mode', icon: '🔌', category: 'pins', make: () => ({ id: newBlockId(), kind: 'pinMode', pin: '13', mode: 'OUTPUT' }) },
  { key: 'digitalWrite', label: 'Set pin HIGH/LOW', icon: '🔌', category: 'pins', make: () => ({ id: newBlockId(), kind: 'digitalWrite', pin: '13', value: 'HIGH' }) },
  { key: 'analogWrite', label: 'Write PWM to pin', icon: '🔌', category: 'pins', make: () => ({ id: newBlockId(), kind: 'analogWrite', pin: '9', value: '128' }) },
  { key: 'delay', label: 'Wait (ms)', icon: '⏱', category: 'control', make: () => ({ id: newBlockId(), kind: 'delay', ms: '500' }) },
  { key: 'if', label: 'If', icon: '❓', category: 'control', make: () => ({ id: newBlockId(), kind: 'if', cond: '', then: [], else: null }) },
  { key: 'ifElse', label: 'If / else', icon: '❓', category: 'control', make: () => ({ id: newBlockId(), kind: 'if', cond: '', then: [], else: [] }) },
  { key: 'while', label: 'While', icon: '🔁', category: 'control', make: () => ({ id: newBlockId(), kind: 'while', cond: '', body: [] }) },
  { key: 'repeat', label: 'Repeat N times', icon: '🔁', category: 'control', make: () => ({ id: newBlockId(), kind: 'repeat', count: '10', varName: 'i', body: [] }) },
  { key: 'varDecl', label: 'Make a variable', icon: '🧮', category: 'variables', make: () => ({ id: newBlockId(), kind: 'varDecl', type: 'int', isConst: false, name: 'value', value: '0' }) },
  { key: 'varSet', label: 'Set variable', icon: '🧮', category: 'variables', make: () => ({ id: newBlockId(), kind: 'varSet', name: 'value', op: '=', value: '0' }) },
  { key: 'serialBegin', label: 'Start Serial Monitor', icon: '🖥', category: 'serial', make: () => ({ id: newBlockId(), kind: 'serialBegin', baud: '9600' }) },
  { key: 'serialPrint', label: 'Print', icon: '🖥', category: 'serial', make: () => ({ id: newBlockId(), kind: 'serialPrint', value: '""', newline: false }) },
  { key: 'serialPrintln', label: 'Print line', icon: '🖥', category: 'serial', make: () => ({ id: newBlockId(), kind: 'serialPrint', value: '""', newline: true }) },
  { key: 'dhtBegin', label: 'Start temp/humidity sensor', icon: '🌡', category: 'sensors', make: () => ({ id: newBlockId(), kind: 'dhtBegin', name: 'dht' }) },
  { key: 'raw', label: 'Custom code…', icon: '🧩', category: 'custom', make: () => ({ id: newBlockId(), kind: 'raw', code: '// your code here' }) },
];

interface GlobalTemplate {
  key: string;
  label: string;
  icon: string;
  make: () => BlockGlobal;
}

const GLOBAL_TEMPLATES: GlobalTemplate[] = [
  { key: 'globalVar', label: 'New variable', icon: '🧮', make: () => ({ id: newBlockId(), kind: 'globalVar', type: 'int', isConst: false, name: 'value', value: '0' }) },
  { key: 'globalDht', label: 'Temp/humidity sensor', icon: '🌡', make: () => ({ id: newBlockId(), kind: 'globalDht', name: 'dht', pin: '2' }) },
  { key: 'globalRaw', label: 'Custom code…', icon: '🧩', make: () => ({ id: newBlockId(), kind: 'globalRaw', code: '' }) },
];

const CATEGORY_LABEL: Record<Template['category'], string> = {
  pins: 'Pins',
  control: 'Control',
  variables: 'Variables',
  serial: 'Serial output',
  sensors: 'Sensors',
  custom: 'Custom',
};

// --- the "add a block here" inline panel ------------------------------------------

function AddPanel(props: { templates: Template[]; onPick: (b: BlockStmt) => void; onPaste?: () => void; onClose: () => void }) {
  const groups = new Map<Template['category'], Template[]>();
  for (const t of props.templates) {
    if (!groups.has(t.category)) groups.set(t.category, []);
    groups.get(t.category)!.push(t);
  }
  return (
    <div className="blk-addpanel" role="menu">
      <div className="blk-addpanel-header">
        <span>Add a block</span>
        <button type="button" className="blk-addpanel-close" onClick={props.onClose} aria-label="Close">×</button>
      </div>
      {props.onPaste && (
        <button type="button" className="blk-addpanel-paste" onClick={props.onPaste}>
          📋 Paste cut block here
        </button>
      )}
      {[...groups.entries()].map(([cat, items]) => (
        <div className="blk-addpanel-group" key={cat}>
          <div className="blk-addpanel-group-title" data-category={cat}>{CATEGORY_LABEL[cat]}</div>
          <div className="blk-addpanel-items">
            {items.map((t) => (
              <button key={t.key} type="button" className="blk-addpanel-item" data-category={cat} onClick={() => props.onPick(t.make())}>
                <span aria-hidden="true">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GlobalAddPanel(props: { onPick: (g: BlockGlobal) => void; onPaste?: () => void; onClose: () => void }) {
  return (
    <div className="blk-addpanel" role="menu">
      <div className="blk-addpanel-header">
        <span>Add a variable</span>
        <button type="button" className="blk-addpanel-close" onClick={props.onClose} aria-label="Close">×</button>
      </div>
      {props.onPaste && (
        <button type="button" className="blk-addpanel-paste" onClick={props.onPaste}>
          📋 Paste cut block here
        </button>
      )}
      <div className="blk-addpanel-items">
        {GLOBAL_TEMPLATES.map((t) => (
          <button key={t.key} type="button" className="blk-addpanel-item" data-category="variables" onClick={() => props.onPick(t.make())}>
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- gaps: the thin drop targets between (and around) blocks in a stack ---------

function Gap(props: { gapKey: string; onOpen: () => void; open: boolean; onDrop: (id: BlockId) => void; children?: React.ReactNode }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`blk-gap${dragOver ? ' blk-gap-dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const raw = e.dataTransfer.getData('application/json');
        if (!raw) return;
        try {
          const payload = JSON.parse(raw) as { type?: string; id?: string };
          if (payload.type === 'move' && payload.id) props.onDrop(payload.id);
        } catch {
          // Ignore malformed drag payloads (e.g. a drop from outside the app).
        }
      }}
    >
      <button type="button" className="blk-gap-btn" onClick={props.onOpen} aria-label="Add a block here">
        {props.open ? '×' : '+'}
      </button>
      {props.children}
    </div>
  );
}

// --- statement blocks --------------------------------------------------------------

function BlockControls(props: { listId: ListId; id: BlockId; isFirst: boolean; isLast: boolean; actions: StackActions }) {
  const { listId, id, isFirst, isLast, actions } = props;
  return (
    <span className="blk-controls">
      <button type="button" className="blk-ctrl" disabled={isFirst} onClick={() => actions.moveUpDown(listId, id, -1)} aria-label="Move up">▲</button>
      <button type="button" className="blk-ctrl" disabled={isLast} onClick={() => actions.moveUpDown(listId, id, 1)} aria-label="Move down">▼</button>
      <button type="button" className="blk-ctrl" onClick={() => actions.cut(id)} aria-label="Cut block">✂</button>
      <button type="button" className="blk-ctrl blk-ctrl-danger" onClick={() => actions.remove(id)} aria-label="Delete block">🗑</button>
    </span>
  );
}

function BlockCard(props: { block: BlockStmt; listId: ListId; depth: number; isFirst: boolean; isLast: boolean; actions?: StackActions }) {
  const { block, listId, depth, isFirst, isLast, actions } = props;
  const readOnly = !actions;
  const patch = (next: BlockStmt) => actions?.patch(block.id, next);
  const category = categoryOf(block);

  return (
    <div
      className="blk-card"
      data-category={category}
      draggable={!readOnly}
      onDragStart={(e) => {
        if (readOnly) return;
        e.dataTransfer.setData('application/json', JSON.stringify({ type: 'move', id: block.id }));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="blk-card-row">
        <fieldset className="blk-fieldset" disabled={readOnly}>
          {renderFields(block, patch)}
        </fieldset>
        {actions && <BlockControls listId={listId} id={block.id} isFirst={isFirst} isLast={isLast} actions={actions} />}
      </div>
      {block.kind === 'if' && (
        <div className="blk-nested">
          <div className="blk-nested-label">then</div>
          <BlockStack list={block.then} listId={`${block.id}:then`} depth={depth + 1} actions={actions} />
          {block.else ? (
            <>
              <div className="blk-nested-label">
                else
                {actions && (
                  <button type="button" className="blk-else-toggle" onClick={() => actions.removeElse(block.id)}>
                    remove else
                  </button>
                )}
              </div>
              <BlockStack list={block.else} listId={`${block.id}:else`} depth={depth + 1} actions={actions} />
            </>
          ) : (
            actions && (
              <button type="button" className="blk-else-toggle" onClick={() => actions.addElse(block.id)}>
                + else
              </button>
            )
          )}
        </div>
      )}
      {(block.kind === 'while' || block.kind === 'repeat') && (
        <div className="blk-nested">
          <BlockStack list={block.body} listId={`${block.id}:body`} depth={depth + 1} actions={actions} />
        </div>
      )}
    </div>
  );
}

function categoryOf(block: BlockStmt): Template['category'] {
  switch (block.kind) {
    case 'pinMode':
    case 'digitalWrite':
    case 'analogWrite':
      return 'pins';
    case 'delay':
    case 'if':
    case 'while':
    case 'repeat':
      return 'control';
    case 'varDecl':
    case 'varSet':
      return 'variables';
    case 'serialBegin':
    case 'serialPrint':
      return 'serial';
    case 'dhtBegin':
      return 'sensors';
    case 'raw':
      return 'custom';
  }
}

function renderFields(block: BlockStmt, patch: (next: BlockStmt) => void): React.ReactNode {
  switch (block.kind) {
    case 'pinMode':
      return (
        <>
          <span className="blk-label">Set pin</span>
          <PinField value={block.pin} onChange={(pin) => patch({ ...block, pin })} />
          <span className="blk-label">to</span>
          <PinModeField value={block.mode} onChange={(mode) => patch({ ...block, mode })} />
        </>
      );
    case 'digitalWrite':
      return (
        <>
          <span className="blk-label">Set pin</span>
          <PinField value={block.pin} onChange={(pin) => patch({ ...block, pin })} />
          <HighLowField value={block.value} onChange={(value) => patch({ ...block, value })} />
        </>
      );
    case 'analogWrite':
      return (
        <>
          <span className="blk-label">Write</span>
          <ExprField value={block.value} onChange={(value) => patch({ ...block, value })} placeholder="0–255" width={64} />
          <span className="blk-label">to pin</span>
          <PinField value={block.pin} onChange={(pin) => patch({ ...block, pin })} />
        </>
      );
    case 'delay':
      return (
        <>
          <span className="blk-label">Wait</span>
          <ExprField value={block.ms} onChange={(ms) => patch({ ...block, ms })} placeholder="ms" width={64} />
          <span className="blk-label">ms</span>
        </>
      );
    case 'serialBegin':
      return (
        <>
          <span className="blk-label">Start Serial Monitor at</span>
          <ExprField value={block.baud} onChange={(baud) => patch({ ...block, baud })} placeholder="9600" width={70} />
          <span className="blk-label">baud</span>
        </>
      );
    case 'serialPrint':
      return (
        <>
          <span className="blk-label">{block.newline ? 'Print line' : 'Print'}</span>
          <ExprField value={block.value} onChange={(value) => patch({ ...block, value })} placeholder='"text" or a variable' width={160} />
        </>
      );
    case 'dhtBegin':
      return (
        <>
          <span className="blk-label">Start sensor</span>
          <NameField value={block.name} onChange={(name) => patch({ ...block, name })} />
        </>
      );
    case 'varDecl':
      return (
        <>
          <label className="blk-label blk-checkbox">
            <input type="checkbox" checked={block.isConst} onChange={(e) => patch({ ...block, isConst: e.target.checked })} /> const
          </label>
          <VarTypeField value={block.type} onChange={(type) => patch({ ...block, type })} />
          <NameField value={block.name} onChange={(name) => patch({ ...block, name })} />
          <span className="blk-label">=</span>
          <ExprField value={block.value} onChange={(value) => patch({ ...block, value })} placeholder="value" width={90} />
        </>
      );
    case 'varSet':
      return (
        <>
          <span className="blk-label">Set</span>
          <NameField value={block.name} onChange={(name) => patch({ ...block, name })} />
          <AssignOpField value={block.op} onChange={(op) => patch({ ...block, op })} />
          <ExprField value={block.value} onChange={(value) => patch({ ...block, value })} placeholder="value" width={90} />
        </>
      );
    case 'if':
      return (
        <>
          <span className="blk-label">If</span>
          <ExprField value={block.cond} onChange={(cond) => patch({ ...block, cond })} placeholder="condition" width={220} />
        </>
      );
    case 'while':
      return (
        <>
          <span className="blk-label">While</span>
          <ExprField value={block.cond} onChange={(cond) => patch({ ...block, cond })} placeholder="condition" width={220} />
        </>
      );
    case 'repeat':
      return (
        <>
          <span className="blk-label">Repeat</span>
          <ExprField value={block.count} onChange={(count) => patch({ ...block, count })} placeholder="times" width={64} />
          <span className="blk-label">times, counting</span>
          <NameField value={block.varName} onChange={(varName) => patch({ ...block, varName })} />
        </>
      );
    case 'raw':
      return (
        <>
          <span className="blk-label">Custom code</span>
          <textarea
            className="blk-raw"
            spellCheck={false}
            rows={Math.min(6, Math.max(1, block.code.split('\n').length))}
            value={block.code}
            onChange={(e) => patch({ ...block, code: e.target.value })}
          />
        </>
      );
  }
}

// --- the stack itself -------------------------------------------------------------

export function BlockStack(props: { list: BlockStmt[]; listId: ListId; depth: number; actions?: StackActions }) {
  const { list, listId, depth, actions } = props;

  const gap = (index: number) => {
    if (!actions) return null;
    const key = `${listId}::${index}`;
    const open = actions.openGap === key;
    return (
      <Gap
        key={`gap-${index}`}
        gapKey={key}
        open={open}
        onOpen={() => actions.setOpenGap(open ? null : key)}
        onDrop={(id) => actions.dropMove(id, listId, index)}
      >
        {open && (
          <AddPanel
            templates={STMT_TEMPLATES}
            onPick={(b) => {
              actions.insert(listId, index, b);
              actions.setOpenGap(null);
            }}
            onPaste={actions.clipboard ? () => { actions.paste(listId, index); actions.setOpenGap(null); } : undefined}
            onClose={() => actions.setOpenGap(null)}
          />
        )}
      </Gap>
    );
  };

  return (
    <div className="blk-stack" data-depth={depth}>
      {gap(0)}
      {list.length === 0 && !actions && <div className="blk-empty">(empty)</div>}
      {list.map((b, i) => (
        <div className="blk-stack-item" key={b.id}>
          <BlockCard block={b} listId={listId} depth={depth} isFirst={i === 0} isLast={i === list.length - 1} actions={actions} />
          {gap(i + 1)}
        </div>
      ))}
    </div>
  );
}

// --- globals (a flat stack, no nesting) --------------------------------------------

function GlobalControls(props: { id: BlockId; isFirst: boolean; isLast: boolean; actions: GlobalActions }) {
  const { id, isFirst, isLast, actions } = props;
  return (
    <span className="blk-controls">
      <button type="button" className="blk-ctrl" disabled={isFirst} onClick={() => actions.moveUpDown(id, -1)} aria-label="Move up">▲</button>
      <button type="button" className="blk-ctrl" disabled={isLast} onClick={() => actions.moveUpDown(id, 1)} aria-label="Move down">▼</button>
      <button type="button" className="blk-ctrl" onClick={() => actions.cut(id)} aria-label="Cut block">✂</button>
      <button type="button" className="blk-ctrl blk-ctrl-danger" onClick={() => actions.remove(id)} aria-label="Delete block">🗑</button>
    </span>
  );
}

function renderGlobalFields(g: BlockGlobal, patch: (next: BlockGlobal) => void): React.ReactNode {
  switch (g.kind) {
    case 'globalVar':
      return (
        <>
          <label className="blk-label blk-checkbox">
            <input type="checkbox" checked={g.isConst} onChange={(e) => patch({ ...g, isConst: e.target.checked })} /> const
          </label>
          <VarTypeField value={g.type} onChange={(type) => patch({ ...g, type })} />
          <NameField value={g.name} onChange={(name) => patch({ ...g, name })} />
          <span className="blk-label">=</span>
          <ExprField value={g.value} onChange={(value) => patch({ ...g, value })} placeholder="value" width={90} />
        </>
      );
    case 'globalDht':
      return (
        <>
          <span className="blk-label">Temp/humidity sensor</span>
          <NameField value={g.name} onChange={(name) => patch({ ...g, name })} />
          <span className="blk-label">on pin</span>
          <PinField value={g.pin} onChange={(pin) => patch({ ...g, pin })} />
        </>
      );
    case 'globalRaw':
      return (
        <>
          <span className="blk-label">Custom code</span>
          <textarea
            className="blk-raw"
            spellCheck={false}
            rows={Math.min(6, Math.max(1, g.code.split('\n').length || 1))}
            value={g.code}
            onChange={(e) => patch({ ...g, code: e.target.value })}
          />
        </>
      );
  }
}

export function GlobalsStack(props: { list: BlockGlobal[]; actions?: GlobalActions }) {
  const { list, actions } = props;

  const gap = (index: number) => {
    if (!actions) return null;
    const key = `globals::${index}`;
    const open = actions.openGap === key;
    return (
      <Gap
        key={`gap-${index}`}
        gapKey={key}
        open={open}
        onOpen={() => actions.setOpenGap(open ? null : key)}
        onDrop={(id) => actions.dropMove(id, index)}
      >
        {open && (
          <GlobalAddPanel
            onPick={(g) => {
              actions.insert(index, g);
              actions.setOpenGap(null);
            }}
            onPaste={actions.clipboard ? () => { actions.paste(index); actions.setOpenGap(null); } : undefined}
            onClose={() => actions.setOpenGap(null)}
          />
        )}
      </Gap>
    );
  };

  return (
    <div className="blk-stack blk-stack-globals">
      {gap(0)}
      {list.length === 0 && !actions && <div className="blk-empty">(no variables)</div>}
      {list.map((g, i) => {
        const readOnly = !actions;
        const patch = (next: BlockGlobal) => actions?.patch(g.id, next);
        return (
          <div className="blk-stack-item" key={g.id}>
            <div
              className="blk-card"
              data-category="variables"
              draggable={!readOnly}
              onDragStart={(e) => {
                if (readOnly) return;
                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'move', id: g.id }));
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="blk-card-row">
                <fieldset className="blk-fieldset" disabled={readOnly}>
                  {renderGlobalFields(g, patch)}
                </fieldset>
                {actions && <GlobalControls id={g.id} isFirst={i === 0} isLast={i === list.length - 1} actions={actions} />}
              </div>
            </div>
            {gap(i + 1)}
          </div>
        );
      })}
    </div>
  );
}
