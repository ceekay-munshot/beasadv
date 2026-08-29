// lib/llm.mjs — JSON extraction via an LLM, with provider failover.
//
//   completeJSON({ prompt, system, schema }) -> { data, provider }
//
// Primary provider is chosen by env LLM_PROVIDER ('claude' default); the other
// is the fallback. Each provider gets one retry on invalid/schema-failing JSON.
// Global fetch only — no SDK. Never leaks keys; throws only if EVERY attempt
// fails (callers catch and keep last-good).
const REGION = () => process.env.CLAUDE_BEDROCK_REGION || 'us-east-1';
const MODEL = () => process.env.CLAUDE_BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const MISTRAL_MODEL = () => process.env.MISTRAL_MODEL || 'mistral-large-latest';

const hasClaude = () => !!process.env.CLAUDE_BEDROCK_API_KEY;
const hasMistral = () => !!process.env.MISTRAL_API_KEY;

// ---- JSON helpers ---------------------------------------------------------
function parseLoose(text) {
  if (text == null) throw new Error('empty LLM response');
  let s = String(text).trim();
  // strip ```json … ``` / ``` … ``` fences if present
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // fall back to the outermost { … } or [ … ] span
  if (s[0] !== '{' && s[0] !== '[') {
    const m = s.match(/[{[][\s\S]*[}\]]/);
    if (m) s = m[0];
  }
  return JSON.parse(s);
}

// tiny JSON-schema-ish validator (object/array/string/number/boolean/null,
// properties, required, items). Throws on mismatch.
function validate(value, schema, path = '$') {
  if (!schema || !schema.type) return;
  const t = schema.type;
  const is = (x) => (x === 'array' ? Array.isArray(value) : x === 'null' ? value === null : typeof value === x);
  const types = Array.isArray(t) ? t : [t];
  if (!types.some(is)) throw new Error(`${path}: expected ${types.join('|')}, got ${Array.isArray(value) ? 'array' : typeof value}`);
  if (types.includes('object') && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) throw new Error(`${path}.${k}: required`);
    if (schema.properties) for (const [k, sub] of Object.entries(schema.properties)) if (k in value) validate(value[k], sub, `${path}.${k}`);
  }
  if (types.includes('array') && Array.isArray(value) && schema.items) value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`));
}

// ---- providers ------------------------------------------------------------
async function callBedrock({ prompt, system }) {
  if (!hasClaude()) throw new Error('CLAUDE_BEDROCK_API_KEY not set');
  const url = `https://bedrock-runtime.${REGION()}.amazonaws.com/model/${encodeURIComponent(MODEL())}/converse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CLAUDE_BEDROCK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      system: [{ text: system }],
      inferenceConfig: { temperature: 0.1, maxTokens: 2000 },
    }),
  });
  if (!res.ok) throw new Error(`bedrock HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const parts = j?.output?.message?.content || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('bedrock: no text in response');
  return text;
}

async function callMistral({ prompt, system }) {
  if (!hasMistral()) throw new Error('MISTRAL_API_KEY not set');
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MISTRAL_MODEL(),
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`mistral HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new Error('mistral: no content in response');
  return text;
}

const PROVIDERS = { claude: callBedrock, mistral: callMistral };

function providerOrder() {
  const primary = (process.env.LLM_PROVIDER || 'claude').toLowerCase() === 'mistral' ? 'mistral' : 'claude';
  const order = [primary, primary === 'claude' ? 'mistral' : 'claude'];
  // keep only providers that have a key configured
  return order.filter((p) => (p === 'claude' ? hasClaude() : hasMistral()));
}

export function llmAvailable() {
  return providerOrder().length > 0;
}

export async function completeJSON({ prompt, system, schema }) {
  const order = providerOrder();
  if (!order.length) throw new Error('no LLM provider configured (need CLAUDE_BEDROCK_API_KEY or MISTRAL_API_KEY)');
  const sys = `${system || 'You extract structured data.'}\n\nRespond with ONLY a single JSON value — no prose, no markdown fences.${schema ? `\nJSON schema (informal): ${JSON.stringify(schema)}` : ''}`;
  let lastErr;
  for (const prov of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was not valid JSON matching the schema. Return ONLY the corrected JSON.`;
        const raw = await PROVIDERS[prov]({ prompt: p, system: sys });
        const data = parseLoose(raw);
        if (schema) validate(data, schema);
        return { data, provider: prov };
      } catch (e) {
        lastErr = e;
        console.error(`[llm] ${prov} attempt ${attempt + 1} failed: ${e.message}`);
      }
    }
  }
  throw lastErr || new Error('all LLM providers failed');
}
