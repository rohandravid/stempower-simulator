import { useEffect, useRef, useState } from 'react';
import { DEMOS, type Demo } from '../circuit/model';
import type { SimStatus } from '../sim/controller';
import { STR } from '../i18n/strings';
import { TUTORIALS } from '../tutorials/tutorials';

export function Toolbar(props: {
  status: SimStatus;
  onRun: () => void;
  onStop: () => void;
  onLoadExample: (demo: Demo) => void;
  onStartTutorial: (demo: Demo) => void;
  onClear: () => void;
}) {
  const { status, onRun, onStop, onLoadExample, onStartTutorial, onClear } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the projects menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const statusLabel =
    status === 'running' ? STR.statusRunning : status === 'error' ? STR.statusError : STR.statusReady;

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">⚡</span>
        <span className="brand-text">
          <span className="brand-title">{STR.appTitle}</span>
          <span className="brand-tagline">{STR.appTagline}</span>
        </span>
      </div>
      <div className="toolbar-actions">
        <div className="menu" ref={menuRef}>
          <button type="button" className="btn btn-ghost" onClick={() => setMenuOpen((v) => !v)}>
            📚 {STR.toolbarExamples} <span className="menu-caret" aria-hidden="true">▾</span>
          </button>
          {menuOpen && (
            <div className="menu-list" role="menu">
              <div className="menu-header">
                <div className="menu-title">{STR.projectsMenuTitle}</div>
                <div className="menu-subtitle">{STR.projectsMenuSubtitle}</div>
              </div>
              {DEMOS.map((demo) => (
                <div key={demo.id} className="menu-item">
                  <span className="menu-item-name">{demo.name}</span>
                  <span className="menu-item-blurb">{demo.blurb}</span>
                  <span className="menu-item-chips">
                    {demo.teaches.map((t) => (
                      <span className="chip" key={t}>{t}</span>
                    ))}
                  </span>
                  <span className="menu-item-actions">
                    {TUTORIALS[demo.id] && (
                      <button
                        type="button"
                        className="btn btn-sm btn-tutorial-start"
                        onClick={() => {
                          setMenuOpen(false);
                          onStartTutorial(demo);
                        }}
                      >
                        🎓 {STR.projectsBuildIt}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setMenuOpen(false);
                        onLoadExample(demo);
                      }}
                    >
                      ⚡ {STR.projectsOpenFinished}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          {STR.toolbarClear}
        </button>
        <span className="status-chip" data-status={status}>
          {statusLabel}
        </span>
        {status === 'running' ? (
          <button type="button" className="btn btn-stop" onClick={onStop}>
            ■ {STR.toolbarStop}
          </button>
        ) : (
          <button type="button" className="btn btn-run" onClick={onRun}>
            ▶ {STR.toolbarRun}
          </button>
        )}
      </div>
    </header>
  );
}
