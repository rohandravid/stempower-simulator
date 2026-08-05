import { useEffect, useRef } from 'react';
import { STR } from '../i18n/strings';

const NEAR_BOTTOM_PX = 40;

export function SerialMonitor(props: { text: string; onClear: () => void }) {
  const { text, onClear } = props;
  const preRef = useRef<HTMLPreElement | null>(null);
  const wasNearBottomRef = useRef(true);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    if (wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text]);

  function handleScroll() {
    const el = preRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_PX;
  }

  return (
    <div className="serial-monitor">
      <div className="serial-toolbar">
        <span>{STR.serialTitle}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          {STR.serialClear}
        </button>
      </div>
      <pre className="serial-text" ref={preRef} onScroll={handleScroll}>
        {text ? text : <span className="serial-placeholder">{STR.serialPlaceholder}</span>}
      </pre>
    </div>
  );
}
