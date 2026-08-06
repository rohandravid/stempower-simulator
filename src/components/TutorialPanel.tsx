import { useMemo } from 'react';
import { astToBlocks } from '../blocks/fromAst';
import { GlobalsStack, BlockStack } from './blocks/BlockStack';
import { STR } from '../i18n/strings';
import { parseSketch } from '../interpreter/parser';
import type { Tutorial } from '../tutorials/tutorials';

/** Best-effort preview of a code snippet as read-only blocks; null if it doesn't parse. */
function useBlockPreview(code: string | undefined) {
  return useMemo(() => {
    if (!code) return null;
    try {
      return astToBlocks(parseSketch(code));
    } catch {
      return null;
    }
  }, [code]);
}

export function TutorialPanel(props: {
  tutorial: Tutorial;
  stepIndex: number;
  /** Current step's check has passed (or the step has no check). */
  stepDone: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onExit: () => void;
  onInsertCode: (code: string) => void;
  blockMode: boolean;
}) {
  const { tutorial, stepIndex, stepDone, onBack, onNext, onSkip, onExit, onInsertCode, blockMode } = props;
  const step = tutorial.steps[stepIndex];
  const blockPreview = useBlockPreview(blockMode ? step.code : undefined);
  const total = tutorial.steps.length;
  const isLast = stepIndex === total - 1;
  const progress = ((stepIndex + (stepDone ? 1 : 0)) / total) * 100;
  const stepLabel = STR.tutorialStepOf.replace('{i}', String(stepIndex + 1)).replace('{n}', String(total));

  return (
    <section className="tutorial" aria-label={`${STR.tutorialTitle}: ${tutorial.name}`}>
      <div className="tutorial-header">
        <span className="tutorial-badge" aria-hidden="true">🎓</span>
        <span className="tutorial-name">{tutorial.name}</span>
        <span className="tutorial-progress-label">{stepLabel}</span>
        <button type="button" className="tutorial-exit" onClick={onExit} aria-label={STR.tutorialExit}>
          ✕
        </button>
      </div>
      <div className="tutorial-progress" role="progressbar" aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={total}>
        <div className="tutorial-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="tutorial-body">
        <div className="tutorial-step-title">{step.title}</div>
        {step.body.split('\n\n').map((para, i) => (
          <p className="tutorial-text" key={i}>{para}</p>
        ))}
        {step.code && blockPreview && (
          <div className="tutorial-code tutorial-code-blocks">
            <div className="tutorial-block-hint">{STR.tutorialBlockPreviewHint}</div>
            <div className="block-editor block-editor-preview">
              <div className="block-editor-scroll">
                {blockPreview.globals.length > 0 && (
                  <section className="blk-section">
                    <h3 className="blk-section-title">🧮 Variables</h3>
                    <GlobalsStack list={blockPreview.globals} />
                  </section>
                )}
                {blockPreview.setup.length > 0 && (
                  <section className="blk-section">
                    <h3 className="blk-section-title">🔧 setup()</h3>
                    <BlockStack list={blockPreview.setup} listId="setup" depth={0} />
                  </section>
                )}
                {blockPreview.loop.length > 0 && (
                  <section className="blk-section">
                    <h3 className="blk-section-title">🔁 loop()</h3>
                    <BlockStack list={blockPreview.loop} listId="loop" depth={0} />
                  </section>
                )}
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onInsertCode(step.code!)}>
              {STR.tutorialInsertBlocks}
            </button>
          </div>
        )}
        {step.code && !blockPreview && (
          <div className="tutorial-code">
            <pre>{step.code}</pre>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onInsertCode(step.code!)}>
              {STR.tutorialInsertCode}
            </button>
          </div>
        )}
        {step.check && (
          <div className="tutorial-check" data-done={stepDone}>
            <span className="tutorial-check-dot" aria-hidden="true">{stepDone ? '✓' : '○'}</span>
            <span>{stepDone ? STR.tutorialCheckDone : step.checkLabel}</span>
          </div>
        )}
      </div>
      <div className="tutorial-nav">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onBack} disabled={stepIndex === 0}>
          ← {STR.tutorialBack}
        </button>
        {step.check && !stepDone && (
          <button type="button" className="tutorial-skip" onClick={onSkip}>
            {STR.tutorialSkip}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-tutorial-next" onClick={onNext} disabled={!stepDone}>
          {isLast ? STR.tutorialFinish : `${STR.tutorialNext} →`}
        </button>
      </div>
    </section>
  );
}
