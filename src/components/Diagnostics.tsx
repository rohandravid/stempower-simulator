import type { SimError } from '../sim/controller';
import type { CircuitDiagnostic } from '../circuit/types';
import { STR } from '../i18n/strings';

function simErrorText(simError: SimError): string {
  const prefix = simError.kind === 'parse' ? STR.diagCodeErrorPrefix : STR.diagStoppedPrefix;
  const location = simError.line !== undefined ? `Line ${simError.line}: ` : '';
  return `${prefix} — ${location}${simError.message}`;
}

const LEVEL_ICONS: Record<string, string> = { error: '✕', warning: '!', hint: 'i' };

export function Diagnostics(props: { simError: SimError | null; diagnostics: CircuitDiagnostic[] }) {
  const { simError, diagnostics } = props;
  const count = diagnostics.length + (simError ? 1 : 0);
  const isEmpty = count === 0;

  return (
    <div className="diagnostics">
      <div className="diagnostics-header">
        <span>{STR.diagTitle}</span>
        <span className="diagnostics-badge" data-ok={isEmpty}>
          {isEmpty ? '✓' : count}
        </span>
      </div>
      <div className="diagnostics-body">
        {simError && (
          <div className="diag-item" data-level="error">
            <span className="diag-dot" aria-hidden="true">{LEVEL_ICONS.error}</span>
            <span>{simErrorText(simError)}</span>
          </div>
        )}
        {diagnostics.map((d, i) => (
          <div className="diag-item" data-level={d.level} key={d.componentId ? `${d.componentId}-${i}` : i}>
            <span className="diag-dot" aria-hidden="true">{LEVEL_ICONS[d.level]}</span>
            <span>{d.message}</span>
          </div>
        ))}
        {isEmpty && (
          <div className="diag-item diag-empty" data-level="ok">
            <span className="diag-dot" aria-hidden="true">✓</span>
            <span>{STR.diagEmpty}</span>
          </div>
        )}
      </div>
    </div>
  );
}
