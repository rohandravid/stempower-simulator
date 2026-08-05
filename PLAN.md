# StemPower Arduino Simulator — Redesigned MVP Plan

> **Status: implemented 2026-07-10.** This plan has been built and verified (48 tests, clean build, browser smoke test). See README.md for usage. One deviation: the AI server runs on port 8917 instead of 8787 (that port was occupied on the dev machine).

## Context

StemPower (nonprofit teaching Arduino to students in India) needs a free, browser-based Arduino simulator. Per your update, the priorities are now: **works cleanly with minimal bugs > simplicity > feature completeness**. Offline support is dropped for now, the spec is a guide not a contract, and the AI assistant should be wired up but doesn't need to be polished. Directory is empty — greenfield.

## API keys you'll need

**Just one: `ANTHROPIC_API_KEY`** (from console.anthropic.com) — powers the AI tutor/debug chat. Everything else is dependency-free:
- No database, no auth, no hosting keys needed for the MVP (frontend is a static build; the AI proxy is one small Node server you run with the key in env).
- The app runs fine without the key — the AI panel just shows "AI assistant unavailable" and the simulator is unaffected.

## What I'm cutting/changing from the original spec (for reliability)

| Original spec | Redesign | Why |
|---|---|---|
| PWA + aggressive offline caching | Plain static site | Service workers are a classic source of stale-cache bugs; you said wifi is OK. Easy to add later. |
| avr8js instruction-level AVR core | Small **source-level interpreter** for the beginner Arduino C++ subset | avr8js runs compiled hex, so it needs an avr-gcc compile server (real infra + an unofficial third-party API, more failure modes). A bounded, well-tested interpreter is fewer moving parts, gives friendly line-numbered errors, and "compiles" instantly. avr8js documented in README as a future high-accuracy mode. |
| Monaco or CodeMirror | **CodeMirror 6** | ~10× lighter, better on cheap Android, simpler integration. |
| AI as Phase 2 | **AI chat panel + minimal proxy server in MVP** | You asked for "ability for AI support" now. One Express endpoint calling the Claude API with structured circuit+code+serial context; graceful degradation without the key. |
| Multi-language groundwork | All UI strings in one `strings.ts` module | Costs nothing now, makes Hindi a dictionary-add later. |
| Full component palette | LED, resistor, push button, potentiometer, wires | Matches the deliverable scenario + analogRead. Nothing exotic. |

Simulator core stays exactly per spec: drag-and-drop circuit builder with electrical validation, code editor with error markers, and student code **actually driving** the simulated circuit (digitalWrite/digitalRead/analogRead/analogWrite/delay/millis/Serial).

## Tech stack

- **Vite + React 18 + TypeScript** frontend; hand-rolled SVG canvas (no GPU-heavy libs).
- **CodeMirror 6** (`codemirror`, `@codemirror/lang-cpp`, `@codemirror/lint`).
- **vitest** unit tests for the two riskiest modules (interpreter, circuit analysis) — this is the main bug-prevention investment.
- **Node + Express** micro-server (`server/`) for the one AI endpoint, calling the Claude API (key stays server-side; Vite dev-proxies `/api` to it).

## Project structure

```
stemlab/
├── package.json, tsconfig.json, vite.config.ts, index.html, .gitignore, README.md, .env.example
├── server/index.mjs             # Express: POST /api/assistant → Claude API (tutor system prompt)
└── src/
    ├── main.tsx, App.tsx, styles.css
    ├── i18n/strings.ts
    ├── interpreter/             # Arduino C++ subset execution
    │   ├── preprocess.ts        # strip #include, expand simple #define
    │   ├── tokenizer.ts / ast.ts / parser.ts   # line/col-tracked errors → editor markers
    │   └── interpreter.ts       # generator-based VM + builtins (pinMode, digitalWrite, delay, Serial…)
    ├── sim/
    │   ├── hardware.ts          # pin modes/outputs/PWM + serial buffer
    │   └── controller.ts        # run/stop, rAF loop w/ ~4ms budget (infinite loops can't freeze UI)
    ├── circuit/
    │   ├── types.ts / model.ts  # breadboard hole grid, Uno pins, occupancy, auto-placement
    │   └── analysis.ts          # nets (union-find) + reachability → LED state, reads, validation
    └── components/
        ├── CircuitCanvas.tsx    # SVG Uno + breadboard + components + tap-to-wire + drag (touch-first)
        ├── Editor.tsx, SerialMonitor.tsx, Diagnostics.tsx, Palette.tsx, Toolbar.tsx
        └── Assistant.tsx        # chat panel; sends circuit JSON + code + serial to /api/assistant
```

## How it works (essentials)

- **Circuit model**: breadboard half-columns/rails/Uno pins are nets (union-find merged by wires); components are edges between nets (resistor always conducts, button when pressed, LED directional). BFS from LED anode→any source (OUTPUT-HIGH pin, 5V, PWM) and cathode→ground (GND or OUTPUT-LOW pin) decides lit state. Validation produces the spec's messages: "LED will burn out — no resistor", "circuit is open", reversed-polarity, short-circuit. `digitalRead` honors INPUT_PULLUP (classic button lesson works correctly); `analogRead` reads the pot wiper.
- **Execution**: Run → parse (errors as CodeMirror markers) → generator-based VM runs `setup()` then `loop()` forever, time-budgeted per animation frame, `delay()` yields, `millis()` = elapsed time. Runtime errors stop cleanly with a line number and plain-language message.
- **Interaction**: palette tap auto-places component on free holes; drag body/legs to move (snap to holes); tap pin → tap pin to wire; tap to select + Delete. Button cap is pressable live during sim; pot knob draggable. Desktop = canvas beside editor; narrow screens = tabs.
- **Preloaded demo**: D13→LED→220Ω→GND and D2→button→GND, with a matching INPUT_PULLUP sketch, so the first "Run" works out of the box.
- **AI assistant**: chat panel with two quick actions ("Help me debug", "Suggest a project"). Frontend posts messages + structured state (components, wires, code, serial tail, diagnostics) to `/api/assistant`; server wraps it in a Socratic beginner-tutor system prompt and calls the Claude API. No key/server → panel disables itself with a friendly note; simulator unaffected.

## Documented limitations (README)
Interpreter subset: no arrays/pointers/`String` class in v1 (clear "not supported yet" parse errors); numbers are JS doubles (no 16-bit overflow emulation). avr8js decision record + roadmap (PWA/offline, more components, Hindi UI, save/load).

## Verification
1. `npx vitest run` — interpreter tests (blink timing, control flow, functions, `#define`, Serial, parse-error positions, infinite-loop yielding) + circuit tests (demo circuit lights LED, missing-resistor warning, reversed LED, pullup button reads, short detection).
2. `npm run build` — clean production build, `tsc` type-check passes.
3. `npm run dev` — manual smoke test: preloaded demo runs, button press lights LED, serial monitor streams; AI panel answers when `ANTHROPIC_API_KEY` is set in `server/.env`, degrades gracefully when not.
