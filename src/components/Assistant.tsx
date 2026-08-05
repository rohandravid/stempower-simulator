import { useEffect, useRef, useState } from 'react';
import { STR } from '../i18n/strings';

export interface AssistantContext {
  code: string;
  serialTail: string;
  diagnostics: string[];
  circuit: unknown;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function Assistant(props: { getContext: () => AssistantContext }) {
  const { getContext } = props;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setBusy(true);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, context: getContext() }),
      });

      if (res.ok) {
        const data = (await res.json()) as { reply: string };
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      } else if (res.status === 503) {
        setUnavailable(true);
        setMessages((prev) => [...prev, { role: 'assistant', content: STR.assistantUnavailable }]);
      } else {
        let errorCode: string | null = null;
        try {
          const data = (await res.json()) as { error?: string };
          errorCode = data.error ?? null;
        } catch {
          errorCode = null;
        }
        if (errorCode === 'unavailable') {
          setUnavailable(true);
          setMessages((prev) => [...prev, { role: 'assistant', content: STR.assistantUnavailable }]);
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', content: STR.assistantError }]);
        }
      }
    } catch {
      // fetch itself failed — server likely isn't running
      setUnavailable(true);
      setMessages((prev) => [...prev, { role: 'assistant', content: STR.assistantUnavailable }]);
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="assistant">
      <div className="assistant-header">
        <span className="assistant-avatar" aria-hidden="true">✨</span>
        <span className="assistant-identity">
          <span className="assistant-name">{STR.assistantName}</span>
          <span className="assistant-role">{STR.assistantRole}</span>
        </span>
      </div>
      <div className="assistant-messages" ref={messagesRef}>
        {messages.length === 0 && <div className="assistant-welcome">{STR.assistantWelcome}</div>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'msg msg-user' : 'msg msg-ai'}>
            {m.content}
          </div>
        ))}
        {busy && <div className="msg msg-ai msg-typing">{STR.assistantTyping}</div>}
      </div>
      {unavailable && <div className="assistant-note">{STR.assistantUnavailable}</div>}
      <div className="assistant-quick">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => void send(STR.assistantQuickDebugMessage)}
        >
          {STR.assistantQuickDebug}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => void send(STR.assistantQuickProjectMessage)}
        >
          {STR.assistantQuickProject}
        </button>
      </div>
      <div className="assistant-input-row">
        <textarea
          value={input}
          placeholder={STR.assistantPlaceholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="btn btn-run" disabled={busy} onClick={() => void send(input)}>
          {STR.assistantSend}
        </button>
      </div>
      <div className="assistant-note">{STR.assistantNote}</div>
    </div>
  );
}
