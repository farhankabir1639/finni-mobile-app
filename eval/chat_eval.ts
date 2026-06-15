/**
 * Chat prompt-chaining eval — verifies the intent router and prompt assembly.
 *
 *   npx tsx eval/chat_eval.ts
 *
 * Guards two invariants:
 *   1. The classifier is conservative — every message that could write data
 *      resolves to 'action' (never silently dropped to 'query').
 *   2. The 'action' prompt still contains every data-writing rule; the 'query'
 *      prompt contains none of them (so a question can't accidentally be told
 *      to emit TRANSACTION_DATA, and an action is never starved of the rules).
 */

import { classifyChatIntent } from '../src/lib/chat/intent';
import { buildChatPrompt } from '../src/lib/chat/buildChatPrompt';
import type { ContextInputs } from '../src/lib/chat/promptBlocks';

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const ACTIONS = [
  'spent 500 on lunch', 'log coffee', 'bought 10 shares of GP at 450',
  'set my food budget to 300', 'create a Travel category', 'save 5000 for the trip',
  'received 50000 salary', 'meetup 2000, grocery 6000', 'sold 5 shares at 280',
];
const QUERIES = [
  "how's my budget?", 'what did I spend on food?', 'am I on track this month?',
  'hi', 'give me some saving tips', 'how am I doing?',
];

function suiteIntent() {
  console.log('\n[A] Intent classification (conservative)');
  for (const m of ACTIONS) check(`action: "${m}"`, classifyChatIntent(m) === 'action');
  for (const m of QUERIES) check(`query:  "${m}"`, classifyChatIntent(m) === 'query');
}

const ctx: ContextInputs = {
  name: 'Farhan', currency: 'BDT', todayDateStr: '2026-06-15', pastThreadNote: '',
  monthlyIncome: 60000, todaySpent: 0, monthSpent: 20000, monthLeft: 40000,
  categoriesJson: '[]', goalsJson: '[]', transactionContext: 'No transactions.',
  investmentContext: 'No investments.', portfolioLine: '',
};

// Block headers (not bare tags — the SAFETY block legitimately says "Do NOT
// emit TRANSACTION_DATA", so we check the rule sections themselves).
const DATA_RULES = [
  'CATEGORIZATION RULES:',
  'INVESTMENT TRACKING:',
  'GOAL CREATION — MANDATORY:',
  'CATEGORY BUDGET SETTING — MANDATORY:',
  'STANDALONE CATEGORY CREATION',
  'CRITICAL RULES — YOU MUST FOLLOW THESE EXACTLY:',
];

function suiteAssembly() {
  console.log('\n[B] Prompt assembly');
  const action = buildChatPrompt('action', ctx, 'spent 500 on lunch');
  const query = buildChatPrompt('query', ctx, "how's my budget?");

  check('action prompt keeps ALL data-writing rules', DATA_RULES.every((r) => action.includes(r)));
  check('query prompt drops ALL data-writing rules', DATA_RULES.every((r) => !query.includes(r)));
  check('both include SAFETY block', action.includes('SAFETY & CONTENT MODERATION') && query.includes('SAFETY & CONTENT MODERATION'));
  check('both include FINANCIAL QUERY RULES', action.includes('FINANCIAL QUERY RULES') && query.includes('FINANCIAL QUERY RULES'));
  check('both carry the context + user message', action.includes('Farhan') && query.includes("Current user message: how's my budget?"));
  check('query prompt is materially smaller', query.length < action.length * 0.6);
}

suiteIntent();
suiteAssembly();
console.log(`\n── ${pass} passed, ${fail} failed ──`);
process.exit(fail ? 1 : 0);
