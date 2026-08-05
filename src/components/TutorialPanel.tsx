import { STR } from '../i18n/strings';
import type { Tutorial } from '../tutorials/tutorials';

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
}) {
  const { tutorial, stepIndex, stepDone, onBack, onNext, onSkip, onExit, onInsertCode } = props;
  const step = tutorial.steps[stepIndex];
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
        {step.code && (
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
