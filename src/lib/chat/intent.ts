// ── Chat intent classifier (heuristic, no LLM call) ─────────────────────────
//
// Routes a message to either the full action rule set or a slim query prompt.
// Deliberately CONSERVATIVE: anything that could possibly write data resolves
// to 'action' (the full, unchanged rule set), so we never drop a save. Only
// clearly non-writing messages (questions, greetings, advice asks) get the
// slim 'query' prompt. A false 'action' just costs a few tokens; a false
// 'query' would lose a transaction — so we bias hard toward 'action'.
//
// A higher-precision LLM classifier (transaction-only vs investment-only, etc.)
// is the planned follow-up; it needs on-device verification before it can gate
// the money path, which is why v1 is heuristic.

export type ChatIntent = 'action' | 'query';

// Imperative verbs that signal the user is recording/creating something, plus
// budget/category admin verbs. Pure-question verbs like "spend"/"how much" are
// intentionally absent so questions fall through to 'query'.
const ACTION_VERB_RE =
  /\b(spent|paid|bought|buy|buying|log|logged|add|added|record|recorded|received|earn|earned|got\s+paid|sold|sell|invest|invested|deposit|deposited|withdrew|withdraw|create|created|make|made|rename|renamed|set)\b/i;

export function classifyChatIntent(message: string): ChatIntent {
  const m = (message ?? '').trim();
  if (!m) return 'query';
  // Any monetary amount or an action verb → treat as a potential data-writing
  // action and use the full rule set.
  if (/\d/.test(m) || ACTION_VERB_RE.test(m)) return 'action';
  return 'query';
}
