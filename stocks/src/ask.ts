/** /ask: on-demand questions about one NSE stock in the Telegram bot.
 *  "/ask Tata Motors" returns the research card plus returns. "/ask Tata Motors: is it near support?" also answers the
 *  question: with an LLM configured (any OpenAI-compatible endpoint via LLM_BASE_URL/LLM_MODEL/LLM_API_KEY, or ANTHROPIC_API_KEY),
 *  the model answers from the same data pack only; without one, a keyword-picked section.
 *  Research output from public prices and headlines, never advice or orders. */
import { resolveSymbol, advise, type Advice } from './watch.ts';
import { getStore } from './store.ts';

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const istDay = (t: number) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
export const ASK_PER_DAY = 15;   // Claude answers per chat per day (cost guard); data-only replies are not counted

/** Splits "<stock> [: or ?] <question>" into the stock and the question. Tries an explicit separator first,
 *  then the longest leading run of words (up to 4) that resolves to an NSE stock. */
export async function parseAsk(arg: string): Promise<{ sym: string; name: string; question: string } | null> {
  const t = arg.trim();
  if (!t) return null;
  const sep = t.match(/^([^:?\-–]{2,40})\s*[:\-–]\s*(.+)$/s);
  if (sep) { const hit = await resolveSymbol(sep[1]); if (hit) return { ...hit, question: sep[2].trim() }; }
  const words = t.split(/\s+/);
  for (let k = Math.min(4, words.length); k >= 1; k--) {
    const head = words.slice(0, k).join(' ').replace(/[?,.!]+$/, '');
    const hit = await resolveSymbol(head);
    if (hit) return { ...hit, question: words.slice(k).join(' ').replace(/^[:,\-–\s]+/, '').trim() };
  }
  return null;
}

/** Without an API key: pick the part of the data that matches the question's words. */
function keywordAnswer(a: Advice, q: string): string {
  const l = q.toLowerCase(), f = a.facts.split('\n');
  const pick = (re: RegExp) => f.filter(x => re.test(x));
  const parts: string[] = [];
  if (/support|resist|level|target|stop|pivot|breakout|breakdown/.test(l)) parts.push(...pick(/20-day high|pivots|plan|setup/i));
  if (/return|perform|gain|loss|week|month|year|ytd/.test(l)) parts.push(...pick(/^Returns/));
  if (/news|headline|sentiment|why/.test(l)) parts.push(...pick(/Headlines|No headlines/));
  if (/buy|sell|hold|enter|exit|invest|trend|stance|good|bad/.test(l)) parts.push(...pick(/stance|plan/i));
  if (/rsi|overbought|oversold|average|ema|dma|atr|volatil/.test(l)) parts.push(...pick(/Averages/));
  if (/fundamental|p\/?e|earning|profit|debt|dividend|valuation|result/.test(l)) parts.push(...pick(/Not available/));
  return parts.length ? [...new Set(parts)].map(esc).join('\n') : '';
}

const SYSTEM = `You answer one question about one Indian stock for a retail investor, inside a Telegram bot.
Use only the facts provided in the user message. If the facts do not cover the question (for example fundamentals, analyst targets or future prices), say plainly that the bot does not have that data, and point to what the facts do show.
Do not tell the person to buy or sell. You may explain what the rules-based stance and plan say and what would change them (levels, averages, triggers).
Write plain text in simple English, at most 120 words, no markdown, no headings. Use the ₹ sign for prices. End with nothing extra: the bot adds its own disclaimer.`;

/** Any OpenAI-compatible chat endpoint (open models on Groq, OpenRouter, Together, Cloudflare Workers AI, a self-hosted
 *  Ollama/vLLM...). Set LLM_BASE_URL (e.g. https://api.groq.com/openai/v1), LLM_MODEL and, if the host needs one, LLM_API_KEY. */
async function openModelAnswer(a: Advice, question: string): Promise<string | null> {
  const base = process.env.LLM_BASE_URL, model = process.env.LLM_MODEL;
  if (!base || !model) return null;
  try {
    const r = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({ model, max_tokens: 400, temperature: 0.2, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Facts:\n${a.facts}\n\nQuestion: ${question}` }] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) { console.error(`ask: LLM HTTP ${r.status}`); return null; }   // never log the body or URL with keys
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return text || null;
  } catch (e) {
    console.error(`ask: LLM call failed: ${(e as Error).message}`);
    return null;
  }
}

/** Claude answer grounded on the data pack. Returns null when no key is configured or the call fails. */
async function claudeAnswer(a: Advice, question: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const res = await client.beta.messages.create({
      model: process.env.ASK_MODEL || 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Facts:\n${a.facts}\n\nQuestion: ${question}` }],
    } as never) as unknown as { stop_reason: string; content: { type: string; text?: string }[] };
    if (res.stop_reason === 'refusal') return null;
    const text = res.content.filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
    return text || null;
  } catch (e) {
    console.error(`ask: Claude call failed: ${(e as Error).message}`);
    return null;
  }
}

async function underLimit(chat: number): Promise<boolean> {
  const store = getStore(), key = 'stock-ask-usage', today = istDay(Date.now());
  const u = (await store.get<{ day: string; n: Record<string, number> }>(key)) ?? { day: today, n: {} };
  if (u.day !== today) { u.day = today; u.n = {}; }
  if ((u.n[chat] ?? 0) >= ASK_PER_DAY) return false;
  u.n[chat] = (u.n[chat] ?? 0) + 1;
  await store.set(key, u);
  return true;
}

export async function handleAsk(chat: number, arg: string, send: (chat: number, html: string) => Promise<unknown>) {
  if (!arg.trim()) {
    await send(chat, 'Ask about one stock, e.g. <code>/ask Tata Motors</code> or <code>/ask SWIGGY: is it near support?</code>');
    return;
  }
  // "/ask TCS vs INFY": side by side, no LLM needed
  const vs = arg.split(/\s+(?:vs\.?|versus)\s+/i).map(x => x.replace(/[?]+$/, '').trim()).filter(Boolean);
  if (vs.length >= 2 && vs.length <= 4 && /\s(vs\.?|versus)\s/i.test(arg)) {
    const rows: string[] = [];
    for (const q of vs) {
      const hit = await resolveSymbol(q);
      if (!hit) { rows.push(`⚠️ "${esc(q)}" not found`); continue; }
      try { const x = await advise(hit.sym, hit.name); rows.push(`${x.line}\n${esc(x.perf)}`); }
      catch { rows.push(`⚠️ <b>${esc(hit.sym)}</b> · no data`); }
    }
    await send(chat, `<b>⚖️ Side by side</b>\n\n${rows.join('\n\n')}\n\n<i>Price data only, not advice. /ask NAME for one full card.</i>`);
    return;
  }
  const p = await parseAsk(arg);
  if (!p) { await send(chat, `Couldn't find a stock in "${esc(arg.slice(0, 60))}". Start with the NSE symbol or company name, e.g. <code>/ask TATAMOTORS: how has it done this year?</code>`); return; }
  let a: Advice;
  try { a = await advise(p.sym, p.name); }
  catch (e) { await send(chat, `${esc(p.sym)}: price data is not available right now (${esc((e as Error).message)}).`); return; }
  let answer = '';
  if (p.question) {
    const ai = (await underLimit(chat)) ? (await openModelAnswer(a, p.question)) ?? (await claudeAnswer(a, p.question)) : null;
    answer = ai ? `💬 <b>${esc(p.question)}</b>\n${esc(ai)}` : '';
    if (!answer) {
      const kw = keywordAnswer(a, p.question);
      answer = `💬 <b>${esc(p.question)}</b>\n` + (kw || 'I can answer from price data only: trend, levels, returns, RSI, volume, setups and recent headlines. The card below has all of it.');
    }
  }
  await send(chat, (answer ? answer + '\n\n' : '') + `${a.card}\n${esc(a.perf)}\n\n<i>Research from public prices and headlines, not investment advice. No fundamentals in this bot.</i>`);
}
