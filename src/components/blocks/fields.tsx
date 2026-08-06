// Small inline input controls used inside block cards. Constrained choices
// (pins, HIGH/LOW, pin modes) get a real <select> so they can never hold an
// invalid value; open-ended values (conditions, math, text) get a free-text
// slot that's validated against the real expression parser as you type.

import { useMemo } from 'react';
import { parseExprFragment } from '../../blocks/fragments';
import type { VarType } from '../../interpreter/ast';

export const PIN_OPTIONS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
];

const CUSTOM = '__custom__';

function useIsValidExpr(value: string): boolean {
  return useMemo(() => {
    if (!value.trim()) return false;
    try {
      parseExprFragment(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);
}

/** Free-text expression slot: a number, variable, comparison, function call, anything. */
export function ExprField(props: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  const valid = useIsValidExpr(props.value);
  return (
    <input
      className="blk-slot"
      data-invalid={!valid}
      type="text"
      spellCheck={false}
      value={props.value}
      placeholder={props.placeholder}
      style={props.width ? { width: props.width } : undefined}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

/** A pin number/name: dropdown of common pins, or a custom expression. */
export function PinField(props: { value: string; onChange: (v: string) => void }) {
  const known = PIN_OPTIONS.includes(props.value);
  return (
    <span className="blk-combo">
      <select
        className="blk-select"
        value={known ? props.value : CUSTOM}
        onChange={(e) => {
          if (e.target.value !== CUSTOM) props.onChange(e.target.value);
          else if (known) props.onChange('');
        }}
      >
        {PIN_OPTIONS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
        <option value={CUSTOM}>custom…</option>
      </select>
      {!known && (
        <ExprField value={props.value} onChange={props.onChange} placeholder="pin" width={100} />
      )}
    </span>
  );
}

/** A HIGH/LOW-shaped value, or a custom expression (a variable, a comparison, ...). */
export function HighLowField(props: { value: string; onChange: (v: string) => void }) {
  const known = props.value === 'HIGH' || props.value === 'LOW';
  return (
    <span className="blk-combo">
      <select
        className="blk-select"
        value={known ? props.value : CUSTOM}
        onChange={(e) => {
          if (e.target.value !== CUSTOM) props.onChange(e.target.value);
          else if (known) props.onChange('');
        }}
      >
        <option value="HIGH">HIGH</option>
        <option value="LOW">LOW</option>
        <option value={CUSTOM}>custom…</option>
      </select>
      {!known && <ExprField value={props.value} onChange={props.onChange} placeholder="value" width={90} />}
    </span>
  );
}

export function PinModeField(props: { value: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP'; onChange: (v: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP') => void }) {
  return (
    <select className="blk-select" value={props.value} onChange={(e) => props.onChange(e.target.value as never)}>
      <option value="OUTPUT">OUTPUT</option>
      <option value="INPUT">INPUT</option>
      <option value="INPUT_PULLUP">INPUT_PULLUP</option>
    </select>
  );
}

export function VarTypeField(props: { value: VarType; onChange: (v: 'int' | 'float' | 'bool' | 'char') => void }) {
  return (
    <select className="blk-select" value={props.value} onChange={(e) => props.onChange(e.target.value as never)}>
      <option value="int">int</option>
      <option value="float">float</option>
      <option value="bool">bool</option>
      <option value="char">char</option>
    </select>
  );
}

export function AssignOpField(props: { value: string; onChange: (v: '=' | '+=' | '-=' | '*=' | '/=') => void }) {
  return (
    <select className="blk-select" value={props.value} onChange={(e) => props.onChange(e.target.value as never)}>
      <option value="=">=</option>
      <option value="+=">+=</option>
      <option value="-=">-=</option>
      <option value="*=">*=</option>
      <option value="/=">/=</option>
    </select>
  );
}

export function NameField(props: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="blk-slot blk-slot-name"
      type="text"
      spellCheck={false}
      value={props.value}
      placeholder="name"
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}
