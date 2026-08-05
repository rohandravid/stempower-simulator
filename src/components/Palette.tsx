import type { ComponentKind } from '../circuit/types';
import { STR } from '../i18n/strings';

interface Part {
  kind: ComponentKind;
  icon: string;
  label: string;
}

const GROUPS: Array<{ title: string; parts: Part[] }> = [
  {
    title: STR.paletteGroupBasics,
    parts: [
      { kind: 'led', icon: '💡', label: STR.paletteLed },
      { kind: 'resistor', icon: '〰️', label: STR.paletteResistor },
      { kind: 'button', icon: '🔘', label: STR.paletteButton },
      { kind: 'potentiometer', icon: '🎛️', label: STR.paletteKnob },
    ],
  },
  {
    title: STR.paletteGroupSensors,
    parts: [
      { kind: 'lm393', icon: '🌱', label: STR.paletteLm393 },
      { kind: 'dht11', icon: '🌡️', label: STR.paletteDht11 },
    ],
  },
  {
    title: STR.paletteGroupPower,
    parts: [
      { kind: 'l298n', icon: '⚙️', label: STR.paletteL298n },
      { kind: 'motor', icon: '🌀', label: STR.paletteMotor },
      { kind: 'battery', icon: '🔋', label: STR.paletteBattery },
    ],
  },
];

export function Palette(props: {
  onAdd: (kind: ComponentKind) => void;
  canDelete: boolean;
  onDelete: () => void;
  canFlip: boolean;
  onFlip: () => void;
}) {
  const { onAdd, canDelete, onDelete, canFlip, onFlip } = props;

  return (
    <aside className="palette">
      <div className="palette-header">{STR.paletteTitle}</div>
      <div className="palette-groups">
        {GROUPS.map((group) => (
          <div className="palette-group" key={group.title}>
            <div className="palette-group-title">{group.title}</div>
            {group.parts.map((p) => (
              <button key={p.kind} type="button" className="palette-btn" onClick={() => onAdd(p.kind)}>
                <span className="palette-btn-icon" aria-hidden="true">{p.icon}</span>
                <span>{p.label}</span>
                <span className="palette-btn-add" aria-hidden="true">+</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {(canDelete || canFlip) && (
        <div className="palette-selection">
          <div className="palette-group-title">{STR.paletteSelectionTitle}</div>
          <div className="palette-selection-actions">
            {canFlip && (
              <button type="button" className="palette-btn palette-action" onClick={onFlip}>
                <span className="palette-btn-icon" aria-hidden="true">🔄</span>
                <span>{STR.paletteFlip}</span>
              </button>
            )}
            <button type="button" className="palette-btn palette-action palette-delete" disabled={!canDelete} onClick={onDelete}>
              <span className="palette-btn-icon" aria-hidden="true">🗑️</span>
              <span>{STR.paletteDelete}</span>
            </button>
          </div>
        </div>
      )}
      <p className="palette-hint">{STR.paletteHint}</p>
    </aside>
  );
}
