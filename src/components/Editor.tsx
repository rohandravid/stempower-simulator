import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { setDiagnostics } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export function Editor(props: {
  value: string;
  onChange: (v: string) => void;
  errorLine: number | null;
  errorMessage: string | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          cpp(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto' },
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Created once; external value/error sync handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== props.value && !view.hasFocus) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: props.value },
      });
    }
  }, [props.value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { errorLine, errorMessage } = props;
    const lineCount = view.state.doc.lines;
    if (errorLine !== null && errorLine >= 1 && errorLine <= lineCount) {
      const line = view.state.doc.line(errorLine);
      view.dispatch(
        setDiagnostics(view.state, [
          {
            from: line.from,
            to: line.to,
            severity: 'error',
            message: errorMessage ?? 'Error',
          },
        ]),
      );
    } else {
      view.dispatch(setDiagnostics(view.state, []));
    }
  }, [props.errorLine, props.errorMessage]);

  return <div className="editor-host" ref={hostRef} />;
}
