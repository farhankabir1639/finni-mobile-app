// ── Number guardrail ────────────────────────────────────────────────────────
//
// The non-negotiable rule: the generated text may contain ONLY numbers that
// trace back to the trigger's `facts`. This is enforced in code, not by trusting
// the prompt — every numeric token in the output must match a fact (allowing for
// rounding and thousands separators). Anything else = the model invented a
// figure → reject.

const NUMBER_RE = /\d[\d,]*\.?\d*/g;

// Pull numeric tokens out of text, normalizing "৳1,200" / "24%" → 1200 / 24.
function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const matches = text.match(NUMBER_RE) ?? [];
  for (const m of matches) {
    const n = parseFloat(m.replace(/,/g, ''));
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

// A text number is "traceable" if it equals a fact within rounding tolerance.
function traceable(n: number, factValues: number[]): boolean {
  for (const f of factValues) {
    const tol = Math.max(0.5, Math.abs(f) * 0.01); // 1% or 0.5, whichever larger
    if (Math.abs(f - n) <= tol) return true;
    if (Math.round(f) === n) return true;            // model rounded the fact
    if (Math.round(f * 10) / 10 === n) return true;  // one-decimal rounding
  }
  return false;
}

export interface ValidationResult {
  ok: boolean;
  offending: number[]; // numbers that could not be traced to facts
}

export function validateNumbers(text: string, facts: Record<string, number>): ValidationResult {
  const factValues = Object.values(facts);
  const offending = extractNumbers(text).filter((n) => !traceable(n, factValues));
  return { ok: offending.length === 0, offending };
}
