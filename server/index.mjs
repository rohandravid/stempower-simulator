// Express proxy that puts the Claude API behind /api so the frontend never
// needs an API key. Run with `npm run server` (see package.json).
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

// Load server/.env first, then fall back to a root .env if present. Missing
// files are fine — dotenv just no-ops.
dotenv.config({ path: new URL('./.env', import.meta.url).pathname });
dotenv.config();

const PORT = process.env.PORT || 8917;

// Zero-arg client: resolves ANTHROPIC_API_KEY, or an `ant auth login`
// profile, from the environment. Created once at startup and reused.
const client = new Anthropic();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const MAX_MESSAGE_CHARS = 8000;
const MAX_CODE_CHARS = 20000;
const MAX_SERIAL_CHARS = 2000;
const MAX_CIRCUIT_CHARS = 6000;
const MAX_MESSAGES = 20;

function truncate(str, max) {
  if (typeof str !== 'string') return '';
  return str.length > max ? str.slice(0, max) : str;
}

function isValidMessage(m) {
  return (
    m !== null &&
    typeof m === 'object' &&
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string'
  );
}

function buildSystemPrompt(context) {
  const rules = `You are Spark, a friendly Socratic tutor for StemPower, a nonprofit that teaches Arduino to school students — many in India, with English as a second language.

How you talk:
- Use simple, short sentences.
- Be warm and encouraging. Celebrate progress.
- Guide with questions and hints instead of dumping full corrected code. Only give a full solution if the student is clearly stuck after a few hints, or explicitly insists on the answer.
- When debugging, first check the circuit JSON and diagnostics for wiring problems, then look at the code.
- Refer to concrete things the student can see: "your LED's cathode in b6", "line 12", "the resistor near the button".
- Keep responses under about 150 words.
- No markdown tables. Plain text with occasional short code snippets is fine.
- Never invent components the simulator doesn't have. Available parts: LED, resistor, push button, potentiometer, LM393 soil moisture sensor module (DO reads HIGH when the soil is dry; AO voltage rises as it dries), DHT11 temperature/humidity module, L298N motor driver, DC motor, and 9V battery. The supported Arduino code subset has no arrays, String, or switch statements yet — don't suggest them.`;

  const code = truncate(context?.code ?? '', MAX_CODE_CHARS);
  const serialTail = truncate(context?.serialTail ?? '', MAX_SERIAL_CHARS);
  const diagnostics = Array.isArray(context?.diagnostics) ? context.diagnostics : [];
  const diagnosticsText = diagnostics.length > 0 ? diagnostics.join('\n') : '(none)';
  let circuitText = '(none)';
  if (context?.circuit !== undefined) {
    try {
      circuitText = truncate(JSON.stringify(context.circuit), MAX_CIRCUIT_CHARS);
    } catch {
      circuitText = '(unavailable)';
    }
  }

  return `${rules}

<current_project_state>
This is the live state of the student's workspace right now.

Code:
${code || '(empty)'}

Circuit (JSON):
${circuitText}

Diagnostics:
${diagnosticsText}

Serial monitor (tail):
${serialTail || '(empty)'}
</current_project_state>`;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/assistant', async (req, res) => {
  const body = req.body ?? {};
  const messages = body.messages;

  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isValidMessage)) {
    return res.status(400).json({ error: 'bad_request' });
  }
  if (messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'bad_request' });
  }

  const trimmedMessages = messages.slice(-MAX_MESSAGES).map((m) => ({
    role: m.role,
    content: truncate(m.content, MAX_MESSAGE_CHARS),
  }));

  const system = buildSystemPrompt(body.context);

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system,
      messages: trimmedMessages,
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    res.json({ reply: text });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Anthropic authentication error:', err.message);
      res.status(503).json({ error: 'unavailable' });
    } else if (err instanceof Error && /Could not resolve authentication/.test(err.message)) {
      // No API key and no `ant auth login` profile at all — the SDK fails this
      // pre-flight, client-side, before it ever reaches the API (so it isn't an
      // Anthropic.AuthenticationError). Same "AI isn't set up" story either way.
      console.error('No Anthropic credentials configured:', err.message);
      res.status(503).json({ error: 'unavailable' });
    } else if (err instanceof Anthropic.RateLimitError) {
      console.error('Anthropic rate limit error:', err.message);
      res.status(429).json({ error: 'rate_limited' });
    } else if (err instanceof Anthropic.APIError) {
      console.error('Anthropic API error:', err.status, err.message);
      res.status(502).json({ error: 'api_error' });
    } else {
      console.error('Unexpected error in /api/assistant:', err);
      res.status(500).json({ error: 'server_error' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`StemPower AI Helper server listening on http://localhost:${PORT}`);
  console.log('Set ANTHROPIC_API_KEY (or run `ant auth login`) for live answers from Spark.');
});
