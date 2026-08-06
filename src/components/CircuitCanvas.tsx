// Interactive SVG circuit board: Uno + breadboard + free-floating modules,
// draggable components, tap-to-wire, live buttons/knobs/sliders. Touch-first.

import { useRef, useState } from 'react';
import type React from 'react';
import {
  ALL_NODES, BB, BB_H, BB_ROWS, BB_W, MODULE_DEFS, RAILS, UNO, VIEW_H, VIEW_W,
  allWireTargets, isModule, makeWire, nearestNode, nearestTarget, placementHolesFree, resolveNodePosition,
} from '../circuit/model';
import type { ModuleDef } from '../circuit/model';
import type { Circuit, LedState, NodeId, PlacedComponent } from '../circuit/types';
import { STR } from '../i18n/strings';

export type Selection = { type: 'component' | 'wire'; id: string } | null;

interface Props {
  circuit: Circuit;
  onCircuitChange: (c: Circuit) => void;
  leds: Record<string, LedState>;
  motors: Record<string, number>;
  modulesPowered: Record<string, boolean>;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

interface DragState {
  compId: string;
  isModule: boolean;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
}

interface SliderDrag {
  compId: string;
  prop: 'position' | 'moisture' | 'temperatureC' | 'humidityPct' | 'speedMph';
  startX: number;
  startValue: number;
  /** Value change per horizontal view-unit dragged. */
  perUnit: number;
  min: number;
  max: number;
  moved: boolean;
}

const TAP_SLOP = 5; // view units before a press becomes a drag

export function CircuitCanvas({ circuit, onCircuitChange, leds, motors, modulesPowered, selection, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pendingFrom, setPendingFrom] = useState<NodeId | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [sliderDrag, setSliderDrag] = useState<SliderDrag | null>(null);
  const [pressedButton, setPressedButton] = useState<string | null>(null);

  const posOf = (id: NodeId) => resolveNodePosition(circuit, id);

  // --- coordinates ------------------------------------------------------------

  function toView(e: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = VIEW_W / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  }

  function capture(e: React.PointerEvent): void {
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  // --- circuit edits -----------------------------------------------------------

  function patchComponent(id: string, patch: (c: PlacedComponent) => PlacedComponent): void {
    onCircuitChange({
      ...circuit,
      components: circuit.components.map((c) => (c.id === id ? patch(c) : c)),
    });
  }

  function setPressed(id: string, pressed: boolean): void {
    patchComponent(id, (c) => ({ ...c, props: { ...c.props, pressed } }));
  }

  // --- wiring ---------------------------------------------------------------------

  function tapNode(node: NodeId, e: React.PointerEvent): void {
    e.stopPropagation();
    if (pendingFrom === null) {
      setPendingFrom(node);
      setCursor(toView(e));
      onSelect(null);
      return;
    }
    if (pendingFrom === node) {
      setPendingFrom(null); // tap the start again to cancel
      return;
    }
    onCircuitChange({ ...circuit, wires: [...circuit.wires, makeWire(pendingFrom, node, nextWireColor(circuit))] });
    setPendingFrom(null);
  }

  // --- dragging parts and modules ---------------------------------------------------

  function beginDrag(comp: PlacedComponent, e: React.PointerEvent): void {
    e.stopPropagation();
    capture(e);
    const p = toView(e);
    setDrag({ compId: comp.id, isModule: isModule(comp.kind), startX: p.x, startY: p.y, dx: 0, dy: 0, moved: false });
  }

  function finishDrag(): void {
    if (!drag) return;
    const comp = circuit.components.find((c) => c.id === drag.compId);
    setDrag(null);
    if (!comp) return;
    if (!drag.moved) {
      onSelect({ type: 'component', id: comp.id });
      setPendingFrom(null);
      return;
    }
    if (drag.isModule) {
      const def = MODULE_DEFS[comp.kind]!;
      const x = Math.min(Math.max(4, (comp.pos?.x ?? 0) + drag.dx), VIEW_W - def.w - 4);
      const y = Math.min(Math.max(4, (comp.pos?.y ?? 0) + drag.dy), VIEW_H - def.h - 4);
      patchComponent(comp.id, (c) => ({ ...c, pos: { x, y } }));
      return;
    }
    // Breadboard part: snap every leg to the nearest free hole.
    const newPins: Record<string, NodeId> = {};
    for (const [role, node] of Object.entries(comp.pins)) {
      const pos = posOf(node);
      const target = nearestNode(pos.x + drag.dx, pos.y + drag.dy, 14);
      if (!target || !target.id.startsWith('bb.')) return; // revert
      newPins[role] = target.id;
    }
    if (new Set(Object.values(newPins)).size !== Object.values(newPins).length) return; // legs collided
    if (!placementHolesFree(circuit, newPins, comp.id)) return; // revert
    patchComponent(comp.id, (c) => ({ ...c, pins: newPins }));
  }

  // --- root pointer handlers --------------------------------------------------------

  function onPointerMove(e: React.PointerEvent): void {
    const p = toView(e);
    if (pendingFrom) setCursor(p);
    if (drag) {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > TAP_SLOP });
    }
    if (sliderDrag) {
      const raw = sliderDrag.startValue + (p.x - sliderDrag.startX) * sliderDrag.perUnit;
      const value = Math.min(sliderDrag.max, Math.max(sliderDrag.min, raw));
      if (!sliderDrag.moved && Math.abs(p.x - sliderDrag.startX) > TAP_SLOP) {
        setSliderDrag({ ...sliderDrag, moved: true });
      }
      patchComponent(sliderDrag.compId, (c) => ({ ...c, props: { ...c.props, [sliderDrag.prop]: value } }));
    }
  }

  function onPointerUp(): void {
    if (drag) finishDrag();
    if (sliderDrag) {
      if (!sliderDrag.moved) onSelect({ type: 'component', id: sliderDrag.compId });
      setSliderDrag(null);
    }
    if (pressedButton) {
      setPressed(pressedButton, false);
      setPressedButton(null);
    }
  }

  function onBackgroundDown(): void {
    setPendingFrom(null);
    onSelect(null);
  }

  /**
   * While a wire is pending, the whole canvas snaps taps to the nearest hole —
   * runs in the capture phase so part graphics drawn over a hole (LED bulbs,
   * resistor bodies…) can't swallow the tap that finishes the wire.
   */
  function onRootDownCapture(e: React.PointerEvent): void {
    if (pendingFrom === null) return;
    const p = toView(e);
    const target = nearestTarget(circuit, p.x, p.y, 16);
    if (!target) return; // far from any hole: cancel/select/drag as usual
    e.stopPropagation();
    if (target.id !== pendingFrom) {
      onCircuitChange({ ...circuit, wires: [...circuit.wires, makeWire(pendingFrom, target.id, nextWireColor(circuit))] });
    }
    setPendingFrom(null); // tapping the start hole again just cancels
  }

  function beginSlider(
    comp: PlacedComponent,
    prop: SliderDrag['prop'],
    trackLen: number,
    min: number,
    max: number,
    e: React.PointerEvent,
  ): void {
    e.stopPropagation();
    capture(e);
    setSliderDrag({
      compId: comp.id,
      prop,
      startX: toView(e).x,
      startValue: (comp.props[prop] as number | undefined) ?? (min + max) / 2,
      perUnit: (max - min) / trackLen,
      min,
      max,
      moved: false,
    });
  }

  // --- render ---------------------------------------------------------------------

  const dragTransform = (id: string): string | undefined =>
    drag && drag.compId === id && drag.moved ? `translate(${drag.dx}, ${drag.dy})` : undefined;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Circuit board"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerDown={onBackgroundDown}
      onPointerDownCapture={onRootDownCapture}
    >
      <UnoBoard />
      <Breadboard />

      {/* Wires under components */}
      {circuit.wires.map((w) => (
        <WireView
          key={w.id}
          a={posOf(w.a)}
          b={posOf(w.b)}
          color={w.color}
          selected={selection?.type === 'wire' && selection.id === w.id}
          onTap={(e) => {
            e.stopPropagation();
            setPendingFrom(null);
            onSelect({ type: 'wire', id: w.id });
          }}
        />
      ))}

      {/* Modules */}
      {circuit.components.map((comp) => {
        if (!isModule(comp.kind)) return null;
        const def = MODULE_DEFS[comp.kind]!;
        return (
          <ModuleView
            key={comp.id}
            comp={comp}
            def={def}
            powered={modulesPowered[comp.id] === true}
            motorSpeed={motors[comp.id] ?? 0}
            selected={selection?.type === 'component' && selection.id === comp.id}
            transform={dragTransform(comp.id)}
            onBodyDown={(e) => beginDrag(comp, e)}
            onSliderDown={beginSlider}
          />
        );
      })}

      {/* Node hit targets (wiring) — includes module pins */}
      {allWireTargets(circuit).map((n) => (
        <circle
          key={n.id}
          className="node-hit"
          cx={n.x}
          cy={n.y}
          r={7}
          fill="transparent"
          onPointerDown={(e) => tapNode(n.id, e)}
        >
          <title>{n.id.replace('bb.', '').replace('uno.', 'Uno ').replace(/^mod\.[^.]+\./, '')}</title>
        </circle>
      ))}

      {/* Pending wire rubber band + hint */}
      {pendingFrom && cursor && (
        <g pointerEvents="none">
          <line
            x1={posOf(pendingFrom).x}
            y1={posOf(pendingFrom).y}
            x2={cursor.x}
            y2={cursor.y}
            stroke="#4f46e5"
            strokeWidth={3}
            strokeDasharray="6 5"
            strokeLinecap="round"
          />
          <circle cx={posOf(pendingFrom).x} cy={posOf(pendingFrom).y} r={6} fill="none" stroke="#4f46e5" strokeWidth={2.5} />
          <g transform={`translate(${Math.min(cursor.x + 14, VIEW_W - 190)}, ${Math.max(cursor.y - 14, 16)})`}>
            <rect x={0} y={-13} width={180} height={20} rx={10} fill="#4f46e5" opacity={0.92} />
            <text x={90} y={1} textAnchor="middle" fill="#ffffff" fontSize={11} fontFamily="system-ui">
              {STR.canvasWireHint}
            </text>
          </g>
        </g>
      )}

      {/* Breadboard parts */}
      {circuit.components.map((comp) => {
        if (isModule(comp.kind)) return null;
        const isSelected = selection?.type === 'component' && selection.id === comp.id;
        const common = {
          comp,
          posOf,
          selected: isSelected,
          transform: dragTransform(comp.id),
          onBodyDown: (e: React.PointerEvent) => beginDrag(comp, e),
        };
        switch (comp.kind) {
          case 'led':
            return <LedView key={comp.id} {...common} state={leds[comp.id]} />;
          case 'resistor':
            return <ResistorView key={comp.id} {...common} />;
          case 'button':
            return (
              <ButtonView
                key={comp.id}
                {...common}
                onCapDown={(e) => {
                  e.stopPropagation();
                  capture(e);
                  setPressed(comp.id, true);
                  setPressedButton(comp.id);
                }}
              />
            );
          case 'potentiometer':
            return (
              <PotView
                key={comp.id}
                {...common}
                onKnobDown={(e) => beginSlider(comp, 'position', 120, 0, 1, e)}
              />
            );
          default:
            return null;
        }
      })}
    </svg>
  );
}

const WIRE_COLORS = ['#2e7d32', '#e6a23b', '#3b8fe6', '#9c27b0', '#e63b3b', '#444444'];

function nextWireColor(circuit: Circuit): string {
  return WIRE_COLORS[circuit.wires.length % WIRE_COLORS.length];
}

// --- static board art ---------------------------------------------------------

function UnoBoard() {
  const digital = ALL_NODES.filter((n) => n.kind === 'uno' && n.y < UNO.y + UNO.h / 2);
  const bottom = ALL_NODES.filter((n) => n.kind === 'uno' && n.y > UNO.y + UNO.h / 2);
  return (
    <g>
      <rect x={UNO.x} y={UNO.y} width={UNO.w} height={UNO.h} rx={12} fill="#00878f" stroke="#00636a" strokeWidth={2} />
      <rect x={UNO.x + 10} y={UNO.y + 40} width={34} height={30} rx={3} fill="#b8bfc4" stroke="#8b9297" />
      <rect x={UNO.x + 10} y={UNO.y + UNO.h - 78} width={26} height={30} rx={3} fill="#3a3f42" />
      <rect x={UNO.x + 18} y={UNO.y + 4} width={UNO.w - 36} height={22} rx={4} fill="#0b3f44" />
      <rect x={UNO.x + 40} y={UNO.y + UNO.h - 26} width={UNO.w - 76} height={22} rx={4} fill="#0b3f44" />
      <text x={UNO.x + UNO.w / 2} y={UNO.y + UNO.h / 2 + 6} textAnchor="middle" fill="#e8f4f4" fontSize={17} fontWeight={700} fontFamily="system-ui">
        StemPower UNO
      </text>
      <circle cx={UNO.x + UNO.w - 30} cy={UNO.y + UNO.h / 2 - 40} r={9} fill="#0b3f44" stroke="#e8f4f4" strokeWidth={1} />
      <text x={UNO.x + UNO.w - 30} y={UNO.y + UNO.h / 2 - 18} textAnchor="middle" fill="#bfe3e5" fontSize={8} fontFamily="system-ui">RESET</text>
      {digital.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={3.5} fill="#101416" stroke="#4d666a" />
          <text x={n.x} y={n.y + 16} textAnchor="middle" fill="#d6ecec" fontSize={9} fontFamily="system-ui">{n.label}</text>
        </g>
      ))}
      {bottom.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={3.5} fill="#101416" stroke="#4d666a" />
          <text x={n.x} y={n.y - 10} textAnchor="middle" fill="#d6ecec" fontSize={9} fontFamily="system-ui">{n.label}</text>
        </g>
      ))}
      <text x={UNO.x + 24} y={UNO.y + 40} fill="#bfe3e5" fontSize={9} fontFamily="system-ui">DIGITAL</text>
      <text x={UNO.x + UNO.w - 90} y={UNO.y + UNO.h - 32} fill="#bfe3e5" fontSize={9} fontFamily="system-ui">ANALOG IN</text>
    </g>
  );
}

function Breadboard() {
  const railColor = (rail: string): string => (rail.includes('+') ? '#d23b3b' : '#3b6bd2');
  const railY = (rail: string) => resolveNodePosition({ components: [], wires: [] }, `bb.${rail}.1`).y;
  const rowY = (row: string) => resolveNodePosition({ components: [], wires: [] }, `bb.${row}1`).y;
  const colX = (c: number) => resolveNodePosition({ components: [], wires: [] }, `bb.a${c}`).x;
  return (
    <g>
      <rect x={BB.x} y={BB.y} width={BB_W} height={BB_H} rx={10} fill="#fbfbf8" stroke="#c9cec9" strokeWidth={2} />
      <rect x={BB.x + 4} y={BB.y + 8.1 * BB.pitch} width={BB_W - 8} height={0.9 * BB.pitch} fill="#eceee9" />
      {RAILS.map((rail) => (
        <g key={rail}>
          <line x1={BB.x + 8} y1={railY(rail) - 10} x2={BB.x + BB_W - 8} y2={railY(rail) - 10} stroke={railColor(rail)} strokeWidth={2} opacity={0.7} />
          <text x={BB.x + 8} y={railY(rail) + 4} fill={railColor(rail)} fontSize={11} fontWeight={700} fontFamily="system-ui">
            {rail.includes('+') ? '+' : '−'}
          </text>
        </g>
      ))}
      {BB_ROWS.map((row) => (
        <text key={row} x={BB.x + 10} y={rowY(row) + 3.5} fill="#9aa19a" fontSize={9} fontFamily="system-ui">
          {row}
        </text>
      ))}
      {[1, 5, 10, 15, 20, 25, 30].map((c) => (
        <text key={c} x={colX(c)} y={rowY('a') - 9} textAnchor="middle" fill="#9aa19a" fontSize={8} fontFamily="system-ui">
          {c}
        </text>
      ))}
      {ALL_NODES.filter((n) => n.kind !== 'uno').map((n) => (
        <rect key={n.id} x={n.x - 3} y={n.y - 3} width={6} height={6} rx={1.5} fill="#c6ccc6" stroke="#a8afa8" strokeWidth={0.8} />
      ))}
    </g>
  );
}

// --- wires -----------------------------------------------------------------------

function WireView({ a, b, color, selected, onTap }: {
  a: { x: number; y: number };
  b: { x: number; y: number };
  color: string;
  selected: boolean;
  onTap: (e: React.PointerEvent) => void;
}) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const k = Math.min(22, dist * 0.18);
  const cx = mx + (-(b.y - a.y) / dist) * k;
  const cy = my + ((b.x - a.x) / dist) * k;
  const d = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
  return (
    <g>
      {selected && <path d={d} fill="none" stroke="#ffd23b" strokeWidth={8} strokeLinecap="round" opacity={0.9} />}
      <path d={d} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} onPointerDown={onTap} />
    </g>
  );
}

// --- breadboard parts ---------------------------------------------------------------

interface PartProps {
  comp: PlacedComponent;
  posOf: (id: NodeId) => { x: number; y: number };
  selected: boolean;
  transform?: string;
  onBodyDown: (e: React.PointerEvent) => void;
}

function SelectionRing({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={8} fill="none" stroke="#ffd23b" strokeWidth={3} strokeDasharray="5 4" />;
}

function LedView({ comp, posOf, selected, transform, onBodyDown, state }: PartProps & { state?: LedState }) {
  const pa = posOf(comp.pins.anode);
  const pc = posOf(comp.pins.cathode);
  const mx = (pa.x + pc.x) / 2;
  const my = Math.min(pa.y, pc.y) - 20;
  const color = comp.props.color ?? '#e63b3b';
  const lit = state?.lit === true;
  const glow = lit ? Math.max(0.25, state?.brightness ?? 1) : 0;
  return (
    <g transform={transform} style={{ cursor: 'grab' }}>
      <line x1={pa.x} y1={pa.y} x2={mx - 4} y2={my + 8} stroke="#8a8f94" strokeWidth={2} />
      <line x1={pc.x} y1={pc.y} x2={mx + 4} y2={my + 8} stroke="#8a8f94" strokeWidth={2} />
      {glow > 0 && <circle cx={mx} cy={my} r={20} fill={color} opacity={glow * 0.45} pointerEvents="none" />}
      <g onPointerDown={onBodyDown}>
        <circle cx={mx} cy={my} r={10} fill={color} opacity={lit ? 1 : 0.55} stroke={state?.burnout ? '#b3261e' : '#5c6166'} strokeWidth={state?.burnout ? 2.5 : 1.5} />
        <circle cx={mx - 3} cy={my - 3} r={3} fill="#ffffff" opacity={lit ? 0.9 : 0.5} />
      </g>
      <text x={pa.x} y={pa.y + 12} textAnchor="middle" fontSize={9} fill="#6a6f74" fontFamily="system-ui">+</text>
      {selected && <SelectionRing x={mx - 15} y={my - 15} w={30} h={30} />}
      <title>LED</title>
    </g>
  );
}

function ResistorView({ comp, posOf, selected, transform, onBodyDown }: PartProps) {
  const p1 = posOf(comp.pins.p1);
  const p2 = posOf(comp.pins.p2);
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const bodyW = Math.min(36, Math.max(24, len - 16));
  return (
    <g transform={transform} style={{ cursor: 'grab' }}>
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#8a8f94" strokeWidth={2} />
      <g transform={`rotate(${angle}, ${mx}, ${my})`} onPointerDown={onBodyDown}>
        <rect x={mx - bodyW / 2} y={my - 7} width={bodyW} height={14} rx={6} fill="#e8d3a2" stroke="#b09a66" strokeWidth={1.5} />
        <rect x={mx - bodyW / 2 + 6} y={my - 7} width={4} height={14} fill="#c0392b" />
        <rect x={mx - 2} y={my - 7} width={4} height={14} fill="#8e44ad" />
        <rect x={mx + bodyW / 2 - 10} y={my - 7} width={4} height={14} fill="#7f6a3a" />
      </g>
      <text x={mx} y={my - 12} textAnchor="middle" fontSize={10} fill="#6a6f74" fontFamily="system-ui">
        {comp.props.ohms ?? 220}Ω
      </text>
      {selected && <SelectionRing x={mx - bodyW / 2 - 5} y={my - 14} w={bodyW + 10} h={28} />}
      <title>Resistor</title>
    </g>
  );
}

function ButtonView({ comp, posOf, selected, transform, onBodyDown, onCapDown }: PartProps & { onCapDown: (e: React.PointerEvent) => void }) {
  const p1 = posOf(comp.pins.p1);
  const p2 = posOf(comp.pins.p2);
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const pressed = comp.props.pressed === true;
  return (
    <g transform={transform}>
      <g onPointerDown={onBodyDown} style={{ cursor: 'grab' }}>
        <rect x={mx - 14} y={my - 15} width={28} height={30} rx={4} fill="#3a3f42" stroke="#26292b" strokeWidth={1.5} />
        <circle cx={mx - 10} cy={my - 11} r={1.8} fill="#c9cfd4" />
        <circle cx={mx + 10} cy={my - 11} r={1.8} fill="#c9cfd4" />
        <circle cx={mx - 10} cy={my + 11} r={1.8} fill="#c9cfd4" />
        <circle cx={mx + 10} cy={my + 11} r={1.8} fill="#c9cfd4" />
      </g>
      <circle
        cx={mx}
        cy={my}
        r={pressed ? 7 : 8.5}
        fill={pressed ? '#8f1f1f' : '#c62828'}
        stroke="#7c1616"
        strokeWidth={2}
        style={{ cursor: 'pointer' }}
        onPointerDown={onCapDown}
      />
      {selected && <SelectionRing x={mx - 18} y={my - 19} w={36} h={38} />}
      <title>Push button (hold to press)</title>
    </g>
  );
}

function PotView({ comp, posOf, selected, transform, onBodyDown, onKnobDown }: PartProps & { onKnobDown: (e: React.PointerEvent) => void }) {
  const e1 = posOf(comp.pins.end1);
  const e2 = posOf(comp.pins.end2);
  const mx = (e1.x + e2.x) / 2;
  const topY = Math.min(e1.y, e2.y) - 26;
  const position = comp.props.position ?? 0.5;
  const angle = -135 + position * 270;
  return (
    <g transform={transform}>
      <g onPointerDown={onBodyDown} style={{ cursor: 'grab' }}>
        <rect x={mx - 22} y={topY - 14} width={44} height={30} rx={5} fill="#3d6fb0" stroke="#2a4f80" strokeWidth={1.5} />
        <line x1={e1.x} y1={e1.y} x2={e1.x} y2={topY + 14} stroke="#8a8f94" strokeWidth={2} />
        <line x1={mx} y1={posOf(comp.pins.wiper).y} x2={mx} y2={topY + 14} stroke="#8a8f94" strokeWidth={2} />
        <line x1={e2.x} y1={e2.y} x2={e2.x} y2={topY + 14} stroke="#8a8f94" strokeWidth={2} />
      </g>
      <g onPointerDown={onKnobDown} style={{ cursor: 'ew-resize' }}>
        <circle cx={mx} cy={topY + 1} r={11} fill="#e8eaed" stroke="#9aa0a6" strokeWidth={2} />
        <line
          x1={mx}
          y1={topY + 1}
          x2={mx + 8 * Math.sin((angle * Math.PI) / 180)}
          y2={topY + 1 - 8 * Math.cos((angle * Math.PI) / 180)}
          stroke="#3a3f42"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </g>
      {selected && <SelectionRing x={mx - 26} y={topY - 18} w={52} h={40} />}
      <title>Potentiometer</title>
    </g>
  );
}

// --- modules -----------------------------------------------------------------------

interface ModuleViewProps {
  comp: PlacedComponent;
  def: ModuleDef;
  powered: boolean;
  motorSpeed: number;
  selected: boolean;
  transform?: string;
  onBodyDown: (e: React.PointerEvent) => void;
  onSliderDown: (
    comp: PlacedComponent,
    prop: SliderDrag['prop'],
    trackLen: number,
    min: number,
    max: number,
    e: React.PointerEvent,
  ) => void;
}

function ModuleView(props: ModuleViewProps) {
  const { comp, def, selected, transform } = props;
  const { x, y } = comp.pos ?? { x: 0, y: 0 };
  return (
    <g transform={transform}>
      <g transform={`translate(${x}, ${y})`}>
        <ModuleBody {...props} />
        {/* pin stubs + labels */}
        {def.pins.map((p) => {
          const labelAbove = p.dy >= def.h; // bottom-edge pin
          const onRight = p.dx >= def.w;
          const onLeft = p.dx <= 0;
          return (
            <g key={p.role}>
              <circle cx={p.dx} cy={p.dy} r={3.4} fill="#d8b44a" stroke="#8a6d1d" strokeWidth={1} />
              <text
                x={onRight ? p.dx - 6 : onLeft ? p.dx + 6 : p.dx}
                y={labelAbove ? p.dy - 7 : p.dy + 3.5}
                textAnchor={onRight ? 'end' : onLeft ? 'start' : 'middle'}
                fontSize={8}
                fontWeight={600}
                fill="#f2f5f2"
                fontFamily="system-ui"
                pointerEvents="none"
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </g>
      {selected && <SelectionRing x={x - 5} y={y - 5} w={def.w + 10} h={def.h + 10} />}
    </g>
  );
}

/** The card + interactive bits, drawn in module-local coordinates. */
function ModuleBody(props: ModuleViewProps) {
  const { comp, def, powered, motorSpeed, onBodyDown, onSliderDown } = props;
  const grab = { cursor: 'grab' as const };

  switch (comp.kind) {
    case 'lm393': {
      const moisture = comp.props.moisture ?? 0.5;
      const trackX = 12;
      const trackW = def.w - 24;
      return (
        <g>
          <g onPointerDown={onBodyDown} style={grab}>
            <rect width={def.w} height={def.h} rx={6} fill="#2b5f9e" stroke="#1d4474" strokeWidth={1.5} />
            <text x={def.w / 2} y={13} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#eaf1fa" fontFamily="system-ui">
              {def.title}
            </text>
            <circle cx={def.w - 10} cy={10} r={3} fill={powered ? '#5df06c' : '#26436b'} stroke="#16304f" />
            {/* the two soil probe prongs */}
            <path d="M 9 8 L 9 20 M 15 8 L 15 20" stroke="#c9a23a" strokeWidth={3} strokeLinecap="round" />
            <rect x={5.5} y={5} width={13} height={4.5} rx={1.5} fill="#1d4474" stroke="#16304f" />
          </g>
          {/* moisture slider: dry ← → wet */}
          <g style={{ cursor: 'ew-resize' }} onPointerDown={(e) => onSliderDown(comp, 'moisture', trackW, 0, 1, e)}>
            <text x={trackX - 3} y={36} fontSize={9} fill="#e0c98a" fontFamily="system-ui">🌵</text>
            <text x={trackX + trackW - 7} y={36} fontSize={9} fill="#9ed4ff" fontFamily="system-ui">💧</text>
            <rect x={trackX} y={44} width={trackW} height={5} rx={2.5} fill="#16304f" />
            <rect x={trackX} y={44} width={trackW * moisture} height={5} rx={2.5} fill="#57b8ff" />
            <circle cx={trackX + trackW * moisture} cy={46.5} r={7} fill="#f4f6f4" stroke="#2a6a9e" strokeWidth={1.5} />
          </g>
        </g>
      );
    }
    case 'dht11': {
      const t = comp.props.temperatureC ?? 24;
      const h = comp.props.humidityPct ?? 60;
      const trackX = 26;
      const trackW = def.w - 38;
      const tFrac = t / 50;
      const hFrac = (h - 20) / 70;
      return (
        <g>
          <g onPointerDown={onBodyDown} style={grab}>
            <rect width={def.w} height={def.h} rx={6} fill="#3f7dc4" stroke="#2c5b93" strokeWidth={1.5} />
            <text x={def.w / 2} y={13} textAnchor="middle" fontSize={10} fontWeight={700} fill="#ecf3fb" fontFamily="system-ui">
              {def.title}
            </text>
            <circle cx={def.w - 10} cy={10} r={3} fill={powered ? '#5df06c' : '#2c5b93'} stroke="#1d4474" />
          </g>
          <g style={{ cursor: 'ew-resize' }} onPointerDown={(e) => onSliderDown(comp, 'temperatureC', trackW, 0, 50, e)}>
            <text x={6} y={31} fontSize={9} fontWeight={700} fill="#ffd7c2" fontFamily="system-ui">{Math.round(t)}°</text>
            <rect x={trackX} y={25} width={trackW} height={5} rx={2.5} fill="#2c5b93" />
            <rect x={trackX} y={25} width={trackW * Math.min(1, Math.max(0, tFrac))} height={5} rx={2.5} fill="#ff8a5c" />
            <circle cx={trackX + trackW * Math.min(1, Math.max(0, tFrac))} cy={27.5} r={6} fill="#f4f6f4" stroke="#a05a3a" strokeWidth={1.5} />
          </g>
          <g style={{ cursor: 'ew-resize' }} onPointerDown={(e) => onSliderDown(comp, 'humidityPct', trackW, 20, 90, e)}>
            <text x={6} y={50} fontSize={9} fontWeight={700} fill="#c9e4ff" fontFamily="system-ui">{Math.round(h)}%</text>
            <rect x={trackX} y={44} width={trackW} height={5} rx={2.5} fill="#2c5b93" />
            <rect x={trackX} y={44} width={trackW * Math.min(1, Math.max(0, hFrac))} height={5} rx={2.5} fill="#7cc4ff" />
            <circle cx={trackX + trackW * Math.min(1, Math.max(0, hFrac))} cy={46.5} r={6} fill="#f4f6f4" stroke="#3a6ea0" strokeWidth={1.5} />
          </g>
        </g>
      );
    }
    case 'radar': {
      const speed = comp.props.speedMph ?? 0;
      const trackX = 10;
      const trackW = def.w - 20;
      const frac = Math.min(1, Math.max(0, speed / 100));
      return (
        <g>
          <g onPointerDown={onBodyDown} style={grab}>
            <rect width={def.w} height={def.h} rx={6} fill="#3a3f6e" stroke="#26294a" strokeWidth={1.5} />
            <text x={def.w / 2} y={13} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#eceafa" fontFamily="system-ui">
              {def.title}
            </text>
            <circle cx={def.w - 10} cy={10} r={3} fill={powered ? '#5df06c' : '#302f56'} stroke="#1e1d3a" />
            {/* dish */}
            <path d="M 10 24 A 9 9 0 0 1 24 24 Z" fill="#c9cfd4" stroke="#8b9297" strokeWidth={1} />
            <text x={30} y={29} fontSize={16} fontFamily="system-ui">🚓</text>
          </g>
          <g style={{ cursor: 'ew-resize' }} onPointerDown={(e) => onSliderDown(comp, 'speedMph', trackW, 0, 100, e)}>
            <text x={trackX} y={48} fontSize={9} fontWeight={700} fill="#c7ccf5" fontFamily="system-ui">
              {Math.round(speed)} mph
            </text>
            <rect x={trackX} y={54} width={trackW} height={5} rx={2.5} fill="#26294a" />
            <rect x={trackX} y={54} width={trackW * frac} height={5} rx={2.5} fill="#ff5c5c" />
            <circle cx={trackX + trackW * frac} cy={56.5} r={7} fill="#f4f6f4" stroke="#9c2e2e" strokeWidth={1.5} />
          </g>
        </g>
      );
    }
    case 'l298n':
      return (
        <g onPointerDown={onBodyDown} style={grab}>
          <rect width={def.w} height={def.h} rx={6} fill="#a63b3b" stroke="#7c2929" strokeWidth={1.5} />
          <text x={def.w / 2} y={14} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fbecec" fontFamily="system-ui">
            {def.title}
          </text>
          {/* heatsink */}
          <g fill="#2e3234">
            <rect x={def.w / 2 - 24} y={24} width={48} height={34} rx={2} />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={def.w / 2 - 22 + i * 10} y={20} width={4} height={42} rx={1} />
            ))}
          </g>
          <circle cx={def.w - 10} cy={10} r={3} fill={powered ? '#5df06c' : '#7c2929'} stroke="#5c1d1d" />
        </g>
      );
    case 'motor': {
      const speed = motorSpeed;
      const cx = def.w / 2 + 8;
      const cy = def.h / 2;
      const spinning = Math.abs(speed) > 0.02;
      const dur = spinning ? Math.max(0.25, 1.9 - Math.abs(speed) * 1.65) : 0;
      return (
        <g>
          <g onPointerDown={onBodyDown} style={grab}>
            {/* yellow TT-motor style body */}
            <rect x={2} y={cy - 16} width={20} height={32} rx={4} fill="#e8b93b" stroke="#a8842a" strokeWidth={1.5} />
            <circle cx={cx} cy={cy} r={26} fill="#c9cfd4" stroke="#8b9297" strokeWidth={2} />
            <circle cx={cx} cy={cy} r={5} fill="#5c6166" />
          </g>
          <g
            className="motor-rotor"
            pointerEvents="none"
            style={{
              animationName: spinning ? 'motor-spin' : 'none',
              animationDuration: `${Math.max(dur, 0.01)}s`,
              animationTimingFunction: 'linear',
              animationIterationCount: 'infinite',
              animationDirection: speed < 0 ? 'reverse' : 'normal',
              transformBox: 'fill-box',
              transformOrigin: 'center',
            }}
          >
            {[0, 90].map((a) => (
              <rect
                key={a}
                x={cx - 24}
                y={cy - 3.5}
                width={48}
                height={7}
                rx={3.5}
                fill="#e8eef2"
                stroke="#9aa0a6"
                transform={`rotate(${a}, ${cx}, ${cy})`}
              />
            ))}
          </g>
          <text x={cx} y={def.h + 12} textAnchor="middle" fontSize={9} fill="#6a6f74" fontFamily="system-ui" pointerEvents="none">
            {spinning ? `${Math.round(Math.abs(speed) * 100)}%${speed < 0 ? ' ◀' : ' ▶'}` : 'stopped'}
          </text>
        </g>
      );
    }
    case 'battery':
      return (
        <g onPointerDown={onBodyDown} style={grab}>
          <rect width={def.w} height={def.h} rx={6} fill="#22313f" stroke="#141e27" strokeWidth={1.5} />
          <rect x={def.w - 14} y={10} width={8} height={10} rx={2} fill="#d8b44a" />
          <rect x={def.w - 14} y={32} width={8} height={10} rx={2} fill="#c9cfd4" />
          <text x={10} y={24} fontSize={13} fontWeight={800} fill="#f2c94c" fontFamily="system-ui">9V</text>
          <text x={10} y={40} fontSize={8.5} fill="#c9d4de" fontFamily="system-ui">battery</text>
        </g>
      );
    default:
      return null;
  }
}
