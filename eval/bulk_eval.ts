/**
 * Bulk-transaction parsing eval — stress-tests multi-transaction prompts.
 *
 *   npx tsx eval/bulk_eval.ts                  # full battery (calls Gemini)
 *   npx tsx eval/bulk_eval.ts --n 8            # first 8 cases only
 *
 * Builds the REAL action prompt (buildChatPrompt) and sends each case to
 * Gemini, then grades:
 *   - count integrity: did it emit one record per transaction (no drop/merge/split)?
 *   - type accuracy: income vs expense vs investment, matched by amount
 *   - category sensibility: LLM-judged 1-5
 *
 * Cases authored by two independent eval experts (categorization + adversarial
 * formatting). Expected categories are best-guesses; the judge handles nuance.
 */

import { buildChatPrompt } from '../src/lib/chat/buildChatPrompt';
import type { ContextInputs } from '../src/lib/chat/promptBlocks';

type ExpItem = { type: 'expense' | 'income' | 'investment'; category: string; amount: number };
type Case = { input: string; expected: ExpItem[]; tests: string };

// ── Compiled battery (expert A: categorization, expert B: adversarial) ───────
const CASES: Case[] = [
  // Expert A — categorization & income/expense
  { input: 'beton pelam 55000 ar bazar koresi 3200 ar uber e airport gesi 850', expected: [{ type: 'income', category: 'Salary', amount: 55000 }, { type: 'expense', category: 'Food', amount: 3200 }, { type: 'expense', category: 'Transport', amount: 850 }], tests: 'banglish salary + 2 expenses' },
  { input: 'got my salary 80000 today, paid house rent 25000 and electricity bill 1800', expected: [{ type: 'income', category: 'NEW:Salary', amount: 80000 }, { type: 'expense', category: 'NEW:Rent', amount: 25000 }, { type: 'expense', category: 'Bills', amount: 1800 }], tests: 'salary+rent+bill' },
  { input: 'daraz order 2400, gym membership 1500, lunch at kacchi bhai 650', expected: [{ type: 'expense', category: 'Shopping', amount: 2400 }, { type: 'expense', category: 'Health', amount: 1500 }, { type: 'expense', category: 'Food', amount: 650 }], tests: 'semantic mapping' },
  { input: 'recharged grameenphone 300 taka and bkash cash out fee 25 and netflix bill 600', expected: [{ type: 'expense', category: 'Bills', amount: 300 }, { type: 'expense', category: 'NEW:Fees', amount: 25 }, { type: 'expense', category: 'Entertainment', amount: 600 }], tests: 'recharge/fee/netflix' },
  { input: 'bought 10 shares of grameenphone at 290 each, also paid 500 for cng', expected: [{ type: 'investment', category: 'Stocks', amount: 2900 }, { type: 'expense', category: 'Transport', amount: 500 }], tests: 'investment + expense' },
  { input: 'freelancing payment received 45000, bought paracetamol 80, doctor visit 800', expected: [{ type: 'income', category: 'NEW:Freelance', amount: 45000 }, { type: 'expense', category: 'Health', amount: 80 }, { type: 'expense', category: 'Health', amount: 800 }], tests: 'freelance income + health' },
  { input: 'month e onek kharap gelo: rent 22000, gas bill 1050, internet 1200, grocery 5500, dudher dam 400', expected: [{ type: 'expense', category: 'NEW:Rent', amount: 22000 }, { type: 'expense', category: 'Bills', amount: 1050 }, { type: 'expense', category: 'Bills', amount: 1200 }, { type: 'expense', category: 'Food', amount: 5500 }, { type: 'expense', category: 'Food', amount: 400 }], tests: '5 expenses banglish' },
  { input: 'salary 90000 dhukse, baccader school fee 12000 dilam, ar tk 3000 boi kinlam', expected: [{ type: 'income', category: 'NEW:Salary', amount: 90000 }, { type: 'expense', category: 'Education', amount: 12000 }, { type: 'expense', category: 'Education', amount: 3000 }], tests: 'school+books=Education' },
  { input: 'pathao bike 120, cup of cha 30, office er lunch 200, cigarette 60, friend ke dhar dilam 1000', expected: [{ type: 'expense', category: 'Transport', amount: 120 }, { type: 'expense', category: 'Food', amount: 30 }, { type: 'expense', category: 'Food', amount: 200 }, { type: 'expense', category: 'NEW:Personal', amount: 60 }, { type: 'expense', category: 'NEW:Lending', amount: 1000 }], tests: '5 small items' },
  { input: 'received 5000 refund from daraz, gift for ammu 2000, eid shopping 8000', expected: [{ type: 'income', category: 'NEW:Refund', amount: 5000 }, { type: 'expense', category: 'NEW:Gifts', amount: 2000 }, { type: 'expense', category: 'Shopping', amount: 8000 }], tests: 'refund/gift/shopping' },
  { input: 'betal 70000, bari vara 20000, bidyut bill 1500, pani bill 400, gas 950, net 1100, mobile recharge 500, bazar 6000', expected: [{ type: 'income', category: 'NEW:Salary', amount: 70000 }, { type: 'expense', category: 'NEW:Rent', amount: 20000 }, { type: 'expense', category: 'Bills', amount: 1500 }, { type: 'expense', category: 'Bills', amount: 400 }, { type: 'expense', category: 'Bills', amount: 950 }, { type: 'expense', category: 'Bills', amount: 1100 }, { type: 'expense', category: 'Bills', amount: 500 }, { type: 'expense', category: 'Food', amount: 6000 }], tests: '8 items all-bangla' },
  { input: 'petrol 2000, car servicing 4500, parking 100, fastpay toll 80', expected: [{ type: 'expense', category: 'Transport', amount: 2000 }, { type: 'expense', category: 'Transport', amount: 4500 }, { type: 'expense', category: 'Transport', amount: 100 }, { type: 'expense', category: 'Transport', amount: 80 }], tests: '4 transport items' },
  { input: 'beta hospital e admit cilo: bed 8000, ostudh 3500, test 2200, ar coming back e cng 300', expected: [{ type: 'expense', category: 'Health', amount: 8000 }, { type: 'expense', category: 'Health', amount: 3500 }, { type: 'expense', category: 'Health', amount: 2200 }, { type: 'expense', category: 'Transport', amount: 300 }], tests: '3 health + transport' },
  { input: 'bonus pelam 15000, kinlam ekta shirt 1800, restaurant e dinner 1500, cinema ticket 700, popcorn 250', expected: [{ type: 'income', category: 'NEW:Bonus', amount: 15000 }, { type: 'expense', category: 'Shopping', amount: 1800 }, { type: 'expense', category: 'Food', amount: 1500 }, { type: 'expense', category: 'Entertainment', amount: 700 }, { type: 'expense', category: 'Food', amount: 250 }], tests: 'bonus + mixed' },
  { input: 'salary 100000, sip mutual fund 10000, fixed deposit 50000, dps 5000, electricity 2000', expected: [{ type: 'income', category: 'NEW:Salary', amount: 100000 }, { type: 'investment', category: 'Mutual Fund', amount: 10000 }, { type: 'investment', category: 'NEW:Fixed Deposit', amount: 50000 }, { type: 'investment', category: 'NEW:DPS', amount: 5000 }, { type: 'expense', category: 'Bills', amount: 2000 }], tests: 'multi-investment' },
  { input: 'ajke: chicken 450, rickshaw 40, bua salary 4000, kerosene 200, bacchar dudh 350, mach 600, sobji 300, dim 150, chal 1200, tel 800', expected: [{ type: 'expense', category: 'Food', amount: 450 }, { type: 'expense', category: 'Transport', amount: 40 }, { type: 'expense', category: 'NEW:Household', amount: 4000 }, { type: 'expense', category: 'NEW:Household', amount: 200 }, { type: 'expense', category: 'Food', amount: 350 }, { type: 'expense', category: 'Food', amount: 600 }, { type: 'expense', category: 'Food', amount: 300 }, { type: 'expense', category: 'Food', amount: 150 }, { type: 'expense', category: 'Food', amount: 1200 }, { type: 'expense', category: 'Food', amount: 800 }], tests: '10 grocery items' },

  // Expert B — adversarial formatting
  { input: 'Lunch 250, uber 180, recharge 100', expected: [{ type: 'expense', category: 'Food', amount: 250 }, { type: 'expense', category: 'Transport', amount: 180 }, { type: 'expense', category: 'Bills', amount: 100 }], tests: 'comma baseline' },
  { input: 'Meetup/Towheed 2000 Grocery 6000 New phone 13000', expected: [{ type: 'expense', category: 'NEW:Social', amount: 2000 }, { type: 'expense', category: 'Food', amount: 6000 }, { type: 'expense', category: 'Shopping', amount: 13000 }], tests: 'slash + space-only delimiters' },
  { input: 'Salary 85,000 received', expected: [{ type: 'income', category: 'NEW:Salary', amount: 85000 }], tests: 'thousands separator not split' },
  { input: '৳2000 dinner, Tk 500 cng, 1,500 for medicine', expected: [{ type: 'expense', category: 'Food', amount: 2000 }, { type: 'expense', category: 'Transport', amount: 500 }, { type: 'expense', category: 'Health', amount: 1500 }], tests: 'mixed currency symbols' },
  { input: 'bazar e 1500 kharcha, cng te 200, baba ke 5000 dilam', expected: [{ type: 'expense', category: 'Food', amount: 1500 }, { type: 'expense', category: 'Transport', amount: 200 }, { type: 'expense', category: 'NEW:Family', amount: 5000 }], tests: 'banglish give-money-out' },
  { input: 'lunch 250 and 300 for uber', expected: [{ type: 'expense', category: 'Food', amount: 250 }, { type: 'expense', category: 'Transport', amount: 300 }], tests: 'ambiguous amount placement' },
  { input: 'Grocery 1200\nNetflix 600\nElectric bill 3400\nGym 2500\nPetrol 1000', expected: [{ type: 'expense', category: 'Food', amount: 1200 }, { type: 'expense', category: 'Entertainment', amount: 600 }, { type: 'expense', category: 'Bills', amount: 3400 }, { type: 'expense', category: 'Health', amount: 2500 }, { type: 'expense', category: 'Transport', amount: 1000 }], tests: 'newline-delimited' },
  { input: 'Rent 18000, groceries 7500, internet 1200, water bill 600, school fee 9000, doctor 1500, restaurant 2200, fuel 3000, salary 90000, shopping 4500', expected: [{ type: 'expense', category: 'NEW:Rent', amount: 18000 }, { type: 'expense', category: 'Food', amount: 7500 }, { type: 'expense', category: 'Bills', amount: 1200 }, { type: 'expense', category: 'Bills', amount: 600 }, { type: 'expense', category: 'Education', amount: 9000 }, { type: 'expense', category: 'Health', amount: 1500 }, { type: 'expense', category: 'Food', amount: 2200 }, { type: 'expense', category: 'Transport', amount: 3000 }, { type: 'income', category: 'NEW:Salary', amount: 90000 }, { type: 'expense', category: 'Shopping', amount: 4500 }], tests: '10 items, salary buried at #9' },
  { input: 'coffee 150 coffee 150 coffee 150', expected: [{ type: 'expense', category: 'Food', amount: 150 }, { type: 'expense', category: 'Food', amount: 150 }, { type: 'expense', category: 'Food', amount: 150 }], tests: 'duplicates not deduped' },
  { input: 'paid 1299.50 for headphones and 49.99 for app', expected: [{ type: 'expense', category: 'Shopping', amount: 1299.5 }, { type: 'expense', category: 'NEW:Apps', amount: 49.99 }], tests: 'decimals preserved' },
  { input: 'Tuition 12000, books 3500, how much did I spend on food this month?, pen 200', expected: [{ type: 'expense', category: 'Education', amount: 12000 }, { type: 'expense', category: 'Education', amount: 3500 }, { type: 'expense', category: 'Shopping', amount: 200 }], tests: 'embedded question ignored' },
  { input: 'Movie tickets 800, popcorn, parking 200', expected: [{ type: 'expense', category: 'Entertainment', amount: 800 }, { type: 'expense', category: 'Transport', amount: 200 }], tests: 'item with no amount skipped' },
  { input: 'Freelance payment 45000, client refund 5000, paid hosting 2000, AWS bill 3500', expected: [{ type: 'income', category: 'NEW:Freelance', amount: 45000 }, { type: 'income', category: 'NEW:Refund', amount: 5000 }, { type: 'expense', category: 'Bills', amount: 2000 }, { type: 'expense', category: 'Bills', amount: 3500 }], tests: 'mixed income+expense' },
  { input: 'Groceries 2500, dinner 1800, snacks 400, forget the last one', expected: [{ type: 'expense', category: 'Food', amount: 2500 }, { type: 'expense', category: 'Food', amount: 1800 }], tests: 'explicit retraction drops snacks' },
  { input: 'Tea 30 biscuit 20 cigarette 50 rickshaw 40 mobile recharge 200 lunch 180 newspaper 15 charger 450', expected: [{ type: 'expense', category: 'Food', amount: 30 }, { type: 'expense', category: 'Food', amount: 20 }, { type: 'expense', category: 'NEW:Personal', amount: 50 }, { type: 'expense', category: 'Transport', amount: 40 }, { type: 'expense', category: 'Bills', amount: 200 }, { type: 'expense', category: 'Food', amount: 180 }, { type: 'expense', category: 'NEW:Misc', amount: 15 }, { type: 'expense', category: 'Shopping', amount: 450 }], tests: '8 items, no separators' },
  { input: 'monthly salary 1,20,000 paisa, house rent diye dilam 25000, gas bill 1050, internet 1500, transport e weekly 2000, restaurant a 3200, baccha r school 8000, eid shopping 15000, medicine 900, donation 5000', expected: [{ type: 'income', category: 'NEW:Salary', amount: 120000 }, { type: 'expense', category: 'NEW:Rent', amount: 25000 }, { type: 'expense', category: 'Bills', amount: 1050 }, { type: 'expense', category: 'Bills', amount: 1500 }, { type: 'expense', category: 'Transport', amount: 2000 }, { type: 'expense', category: 'Food', amount: 3200 }, { type: 'expense', category: 'Education', amount: 8000 }, { type: 'expense', category: 'Shopping', amount: 15000 }, { type: 'expense', category: 'Health', amount: 900 }, { type: 'expense', category: 'NEW:Donation', amount: 5000 }], tests: '10 items, lakh grouping 1,20,000' },
];

// ── Gemini ───────────────────────────────────────────────────────────────────
async function loadKey(): Promise<string | null> {
  if (process.env.EXPO_PUBLIC_GEMINI_API_KEY) return process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  try {
    const fs = await import('node:fs');
    const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const m = env.match(/EXPO_PUBLIC_GEMINI_API_KEY=(.+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}
async function gemini(key: string, prompt: string, maxOutputTokens = 2048, temperature = 0.3): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } } }),
  });
  const data = await res.json() as any;
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

type Rec = { type: string; category: string; amount: number };
function parseRecords(text: string): Rec[] {
  const recs: Rec[] = [];
  let m: RegExpExecArray | null;
  const txRe = /TRANSACTION_DATA:\s*(\{[^}]*\})/g;
  while ((m = txRe.exec(text))) { try { const o = JSON.parse(m[1]); recs.push({ type: String(o.type), category: String(o.category_id ?? ''), amount: Number(o.amount) }); } catch { /* skip */ } }
  const invRe = /INVESTMENT_DATA:\s*(\{[^}]*\})/g;
  while ((m = invRe.exec(text))) { try { const o = JSON.parse(m[1]); recs.push({ type: 'investment', category: String(o.asset_type ?? o.name ?? ''), amount: Number(o.quantity) * Number(o.buy_price) }); } catch { /* skip */ } }
  return recs;
}

const ctx: ContextInputs = {
  name: 'Farhan', currency: 'BDT', todayDateStr: '2026-06-15', pastThreadNote: '',
  monthlyIncome: 0, todaySpent: 0, monthSpent: 0, monthLeft: 0,
  categoriesJson: JSON.stringify(['Food', 'Transport', 'Entertainment', 'Bills', 'Health', 'Shopping', 'Education', 'Other'].map((n, i) => ({ id: String(i), name: n }))),
  goalsJson: '[]', transactionContext: 'No transactions yet.', investmentContext: 'No investments yet.', portfolioLine: '',
};

// Match parsed records to expected by nearest amount; return type-accuracy.
function typeAccuracy(expected: ExpItem[], parsed: Rec[]): number {
  if (!expected.length) return 1;
  const pool = [...parsed];
  let correct = 0;
  for (const e of expected) {
    let bestIdx = -1, bestDiff = Infinity;
    pool.forEach((p, i) => { const d = Math.abs(p.amount - e.amount); if (d < bestDiff) { bestDiff = d; bestIdx = i; } });
    if (bestIdx >= 0 && bestDiff <= Math.max(1, e.amount * 0.02)) {
      if (pool[bestIdx].type === e.type) correct++;
      pool.splice(bestIdx, 1);
    }
  }
  return correct / expected.length;
}

async function main() {
  const key = await loadKey();
  if (!key) { console.log('No EXPO_PUBLIC_GEMINI_API_KEY found.'); process.exit(1); }
  const nArg = process.argv.indexOf('--n');
  const cases = nArg >= 0 ? CASES.slice(0, Number(process.argv[nArg + 1])) : CASES;

  let countOk = 0, typeSum = 0, catSum = 0;
  const failures: string[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const prompt = buildChatPrompt('action', ctx, c.input);
    const text = await gemini(key!, prompt);
    const parsed = parseRecords(text);

    const cMatch = parsed.length === c.expected.length;
    if (cMatch) countOk++;
    const tAcc = typeAccuracy(c.expected, parsed);
    typeSum += tAcc;

    // LLM judge for category sensibility.
    let catScore = 0;
    const judge = await gemini(key!,
      `Rate 1-5 how sensible these category assignments are overall (5=all sensible). Existing categories: Food, Transport, Entertainment, Bills, Health, Shopping, Education, Other. New category names are GOOD when an item fits none. Return ONLY {"score":n}.\nUser wrote: "${c.input}"\nAI assigned: ${JSON.stringify(parsed.map((p) => ({ amount: p.amount, type: p.type, category: p.category })))}`,
      64, 0.1);
    try { catScore = JSON.parse(judge.replace(/```json?|```/g, '').trim()).score ?? 0; } catch { /* 0 */ }
    catSum += catScore;

    const flag = (!cMatch || tAcc < 1 || catScore < 4) ? '  ⚠' : '';
    console.log(`#${String(i + 1).padStart(2)} [${c.tests}]${flag}`);
    console.log(`     count ${parsed.length}/${c.expected.length}${cMatch ? '' : ' ✗'}  type ${(tAcc * 100).toFixed(0)}%  cat ${catScore}/5`);
    if (!cMatch || tAcc < 1) {
      failures.push(`#${i + 1} "${c.input.slice(0, 50)}…" → count ${parsed.length}/${c.expected.length}, type ${(tAcc * 100).toFixed(0)}%`);
      console.log(`     parsed: ${JSON.stringify(parsed.map((p) => `${p.type}:${p.category}:${p.amount}`))}`);
    }
  }

  const n = cases.length;
  console.log(`\n══ BULK PARSING SCORECARD (${n} cases) ══`);
  console.log(`  count integrity : ${countOk}/${n} (${((countOk / n) * 100).toFixed(0)}%)`);
  console.log(`  type accuracy   : ${((typeSum / n) * 100).toFixed(0)}%`);
  console.log(`  category quality: ${(catSum / n).toFixed(2)}/5`);
  if (failures.length) { console.log(`\n  Failures:`); failures.forEach((f) => console.log(`   - ${f}`)); }
  process.exit(0);
}
main();
