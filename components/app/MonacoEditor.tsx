/**
 * The code editor for the coding round — Monaco, the engine behind VS Code.
 *
 * Loaded from our own origin (public/monaco, populated by scripts/copy-monaco.mjs)
 * rather than the package's default jsDelivr CDN. A candidate's coding round is
 * timed and paid for; a third-party CDN that is slow or blocked by a corporate
 * proxy would burn that time on a spinner.
 *
 * Monaco is ~24MB of assets and knows nothing about the server, so it is loaded
 * dynamically and never rendered during SSR.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { loader, type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Loader2 } from 'lucide-react';

import type { LanguageId } from '@/lib/execution/types';

const LOCAL_VS = '/monaco/vs';

/**
 * Last resort if the local copy is not there.
 *
 * public/monaco is generated at build time and gitignored, so it depends on the
 * prebuild script having run wherever this is deployed. If that ever silently
 * does not happen, the alternative to this line is a candidate sitting in front
 * of a blank pane during a round they paid for. Version-pinned to what is in
 * package.json — an unpinned CDN URL is a different outage waiting to happen.
 */
const CDN_VS = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.56.0/min/vs';

/** loader.config throws if called after Monaco has begun initialising. */
let configured = false;

async function configureLoader(): Promise<void> {
  if (configured) return;
  configured = true;

  let vs = LOCAL_VS;
  try {
    const res = await fetch(`${LOCAL_VS}/loader.js`, { method: 'HEAD' });
    if (!res.ok) vs = CDN_VS;
  } catch {
    vs = CDN_VS;
  }

  if (vs === CDN_VS) {
    console.warn('[monaco] local bundle missing; falling back to CDN. Did prebuild run?');
  }
  loader.config({ paths: { vs } });
}

const Editor = dynamic(() => import('@monaco-editor/react').then((m) => m.Editor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

function EditorSkeleton() {
  return (
    <div className="h-full flex items-center justify-center gap-2 text-[#1B1F3B]/55">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="font-[family-name:var(--font-mono)] text-xs">Loading editor…</span>
    </div>
  );
}

/** Our LanguageId → Monaco's language id. They mostly agree; cpp is the exception. */
const MONACO_LANGUAGE: Record<LanguageId, string> = {
  python: 'python',
  javascript: 'javascript',
  typescript: 'typescript',
  java: 'java',
  cpp: 'cpp',
  go: 'go',
};

const THEME = 'dta-interview';

/**
 * A light theme on the app's cream, rather than Monaco's default white or the
 * near-black vs-dark. Neither sits inside a warm-paper UI without looking like
 * a window from another application.
 */
function defineTheme(monaco: Monaco) {
  monaco.editor.defineTheme(THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8A8FA3', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C2410C', fontStyle: 'bold' },
      { token: 'string', foreground: '15803D' },
      { token: 'number', foreground: '7C3AED' },
      { token: 'type', foreground: '0369A1' },
      { token: 'identifier', foreground: '1B1F3B' },
    ],
    colors: {
      'editor.background': '#FFFDF9',
      'editor.foreground': '#1B1F3B',
      'editorLineNumber.foreground': '#1B1F3B59',
      'editorLineNumber.activeForeground': '#1B1F3B',
      'editor.lineHighlightBackground': '#F5EBE066',
      'editor.selectionBackground': '#FFC93C55',
      'editorCursor.foreground': '#1B1F3B',
      'editorIndentGuide.background1': '#1B1F3B1A',
      'editorGutter.background': '#FFFDF9',
    },
  });
}

export default function MonacoEditor({
  language,
  value,
  onChange,
  readOnly = false,
}: {
  language: LanguageId;
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
}) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // The loader is pointed at a base URL before the Editor mounts, never after.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void configureLoader().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const handleMount = useCallback((instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = instance;
    defineTheme(monaco);
    monaco.editor.setTheme(THEME);

    /*
     * Monaco type-checks TypeScript in the browser and would redline a bare
     * function that reads stdin — the candidate's code is a script, not a
     * module in a project with types installed. Red squiggles that mean nothing
     * are worse than no squiggles.
     */
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });

    instance.focus();
  }, []);

  if (!ready) return <EditorSkeleton />;

  return (
    <Editor
      height="100%"
      language={MONACO_LANGUAGE[language]}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={handleMount}
      beforeMount={defineTheme}
      theme={THEME}
      options={{
        readOnly,
        fontSize: 13.5,
        lineHeight: 21,
        fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
        fontLigatures: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        renderLineHighlight: 'line',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        padding: { top: 14, bottom: 14 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        // An interview, not an autocomplete exercise. Bracket and quote closing
        // stays (everyone expects it); whole-line suggestions do not.
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        wordBasedSuggestions: 'currentDocument',
        inlineSuggest: { enabled: false },
        parameterHints: { enabled: false },
        stickyScroll: { enabled: false },
        contextmenu: false,
      }}
    />
  );
}
