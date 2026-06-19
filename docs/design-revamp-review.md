# Design Revamp Review (Finni 2.0 prototype) — CTO assessment

Source: claude.ai/design project "Finni AI" → `finni/Finni.html` (+ screens/ui/tokens).
Reviewed 2026-06-19. Logo ignored per instruction. Design's "AI Budget" ignored
(the app's model-based Smart Budget is superior — keep it).

## Headline
**The app already matches — and often exceeds — this design on nearly every
screen.** The current app was built from an earlier revision of this same
prototype, so the token system, Home, Transactions, Analytics, Investments,
Onboarding, and Auth are already faithful. This is a **polish pass + two
structural decisions**, NOT a revamp/rebuild. Don't budget it as one.

## Where the app already equals or beats the design
| Screen | Verdict |
|---|---|
| **Design language / tokens** | Identical (Aurora palette, Plus Jakarta Sans, indigo, radii). No re-theme. |
| **Home** | Match. App has ArcMeter+Orb hero, pace pill, FinniInsightCard, chat, voice, history. |
| **Transactions** | App **ahead** (adds custom date range + delete). |
| **Analytics** | App **ahead** (insight feedback + detail sheet, customize prompt, refresh, savings recs). |
| **Investments** | App **ahead** (sparkline, allocation bar, detail breakdown). |
| **Onboarding** | Near 1:1 (same 3 steps, FinniSay, goal grid). |
| **Auth** | Match + app **ahead** (Google OAuth — design has none; keep it). |
| **Settings + sheets** | Same features (Profile/Currency/Income/Categories/Goals), design styling. |

## The actual delta — small cosmetic polish (low risk, optional)
1. **Home AI feedback** — design has expandable feedback panels (reason chips + note + toast); app has a shallow like/dislike/regen/flag row. *Polish.*
2. **Home pace pill** — design quantifies it ("spending 12% under pace"); app shows only "On track / Over pace". *1-line add.*
3. **Onboarding goal tiles** — design uses vector icons; app uses emoji. *Swap for parity.*
4. **Auth** — design adds a "Bank-level encryption · data never sold" trust pill; subtitle wording differs. *Copy/badge.*
5. **Investments asset colors** — align palette to design (Stocks=violet, Crypto/Gold=amber, MF=blue, Other=aqua). *Token tweak.*

None of these are structural. A day of polish, total.

## The two real decisions

### Decision 1 — Navigation paradigm (the only significant effort)
- **Design:** bottom **GlassDock** = Home / Transactions / Analytics / Investments / **Review**, with **Settings moved OUT of the dock** into a top **NavShelf** (slide-down drawer) opened via a **Breadcrumb**. So: drops the Settings tab, adds a Review tab, adds two new nav primitives.
- **App today:** 5 fixed bottom tabs — Home / Wallet / Insights / Invest / **Settings**. Simple, standard.
- **CTO take:** this is the biggest effort + risk in the whole design, for arguably marginal benefit. Settings-as-a-tab is perfectly good UX. The NavShelf/Breadcrumb is prettier but adds a new interaction model, more surface area, and regression risk on the core nav every user touches daily. **Recommendation: keep the current 5-tab nav.** If you want Review reachable, slot it in when its backend is live (or keep the Home inbox icon). Only adopt NavShelf if the aesthetic is a real priority.

### Decision 2 — Review screen (blocked, already gated)
- **Design:** Review is a first-class routed screen with source-connection toggles (email + push), a copyable "forward to Finni" address, and source filter chips.
- **App today:** `ReviewModal`, opened from a Home inbox icon, **gated off** (`EMAIL_CAPTURE_ENABLED=false`) pending the SendGrid email-capture backend.
- **CTO take:** don't build the fuller Review screen until the email-capture flow is verified end-to-end (it's intentionally hidden). When you wire SendGrid, we expand the modal into the design's screen (source toggles + forwarding card + filters) and flip the flag. **No action now.**

## Recommendation
This is **not a revamp project** — you're already there. Suggested path:
1. **Do the cosmetic polish** (items 1–5) as one small, low-risk batch in the next build. Highest visual-parity-per-effort.
2. **Keep the current navigation** (5 tabs incl. Settings). Skip NavShelf/Breadcrumb unless you specifically want that aesthetic — it's the costliest, riskiest piece for the least functional gain.
3. **Leave Review gated** until the email backend ships; expand it to the design's screen then.

Net: a day of polish gets you to near-pixel parity. The big-looking "revamp" is mostly already shipped.

## Open decisions for you
1. Polish batch — do all of items 1–5, a subset, or skip?
2. Navigation — keep current 5-tab (recommended), or adopt the NavShelf/Breadcrumb + Review-in-dock paradigm?
3. (Already settled) Review screen waits for SendGrid; Smart Budget stays; logo ignored.
