// ── Chat system-prompt assembler ────────────────────────────────────────────
//
// Composes the system prompt from modular blocks based on intent. The 'action'
// assembly includes every rule block in the original order, so the
// transaction-logging path is unchanged. The 'query' assembly is a strict
// subset (context + safety + query rules) — fewer tokens, fewer misfires, and
// no data-writing instructions a pure question doesn't need.

import {
  buildContextBlock,
  SAFETY_BLOCK,
  QUERY_RULES,
  CATEGORIZATION_RULES,
  CATEGORY_ADMIN_RULES,
  INCOME_EXPENSE_RULES,
  BUDGET_RULES,
  GOAL_RULES,
  INVESTMENT_RULES,
  DEBT_RULES,
  CRITICAL_RULES,
  type ContextInputs,
} from './promptBlocks';
import type { ChatIntent } from './intent';

export function buildChatPrompt(
  intent: ChatIntent,
  ctx: ContextInputs,
  userMessage: string
): string {
  const blocks: string[] = [buildContextBlock(ctx), SAFETY_BLOCK, QUERY_RULES];

  if (intent === 'action') {
    blocks.push(
      CATEGORIZATION_RULES,
      CATEGORY_ADMIN_RULES,
      INCOME_EXPENSE_RULES,
      BUDGET_RULES,
      GOAL_RULES,
      INVESTMENT_RULES,
      DEBT_RULES,
      CRITICAL_RULES
    );
  }

  return `${blocks.join('\n\n')}\n\nCurrent user message: ${userMessage}`;
}
