// Finni Aurora — design token system
// Mirrors tokens.css from the design file

export const t = {
  // ── Surfaces ──────────────────────────────────────
  bg:           '#05070F',
  bg2:          '#080B16',
  surface:      '#0D1322',
  surface2:     '#121A2C',
  surface3:     '#18223A',
  surfaceGlass: 'rgba(13,19,34,0.72)',

  // ── Lines ─────────────────────────────────────────
  line:         'rgba(255,255,255,0.07)',
  line2:        'rgba(255,255,255,0.04)',
  lineStrong:   'rgba(255,255,255,0.13)',
  lineIndigo:   'rgba(129,140,248,0.45)',

  // ── Text ──────────────────────────────────────────
  text:         '#F4F6FC',
  text2:        '#97A3BD',
  text3:        '#57647F',
  text4:        '#3A4660',

  // ── Primary (Indigo) ──────────────────────────────
  indigo:       '#6366F1',
  indigoBright: '#8B8FFF',
  indigoDeep:   '#4F46E5',
  indigoTint:   'rgba(99,102,241,0.14)',
  indigoGlow:   'rgba(99,102,241,0.55)',

  // ── Secondary (Cyan) ──────────────────────────────
  cyan:         '#22D3EE',
  cyanTint:     'rgba(34,211,238,0.13)',

  // ── Aurora palette ────────────────────────────────
  auraBg:       '#07070E',
  auraViolet:   '#8B5CF6',
  auraIndigo:   '#6366F1',
  auraAqua:     '#5EEAD4',
  auraRose:     '#FB7185',
  auraBlue:     '#60A5FA',
  glass:        'rgba(255,255,255,0.055)',
  glass2:       'rgba(255,255,255,0.085)',
  glassLine:    'rgba(255,255,255,0.10)',
  glassLine2:   'rgba(255,255,255,0.16)',

  // ── Semantic ──────────────────────────────────────
  green:        '#34D399',
  greenDeep:    '#10B981',
  greenTint:    'rgba(52,211,153,0.13)',
  amber:        '#FBBF24',
  amberTint:    'rgba(251,191,36,0.14)',
  red:          '#FB7185',
  redDeep:      '#F43F5E',
  redTint:      'rgba(251,113,133,0.13)',

  // ── Category colours ──────────────────────────────
  catFood:      '#FB7185',
  catTransport: '#A78BFA',
  catShopping:  '#F472B6',
  catBills:     '#FBBF24',
  catIncome:    '#34D399',
  catUncat:     '#60A5FA',

  // ── Radii ─────────────────────────────────────────
  rXs:   8,
  rSm:   12,
  rMd:   16,
  rLg:   20,
  rXl:   26,
  r2xl:  32,
  rPill: 999,

  // ── Spacing ───────────────────────────────────────
  s1: 4,  s2: 8,  s3: 12, s4: 16,
  s5: 20, s6: 24, s7: 28, s8: 32, s10: 40,

  // ── Motion durations (ms) ─────────────────────────
  dFast: 160,
  dMed:  260,
  dSlow: 420,
} as const;

// ── Font family names (loaded via useFonts in App.tsx) ──
export const fonts = {
  regular:   'PlusJakartaSans',
  medium:    'PlusJakartaSans-Medium',
  semiBold:  'PlusJakartaSans-SemiBold',
  bold:      'PlusJakartaSans-Bold',
  extraBold: 'PlusJakartaSans-ExtraBold',
} as const;

// Gradient definitions used across auth + home
export const gradients = {
  cta:    ['#5EEAD4', '#A5B4FC'] as [string, string],  // aqua → lavender
  sphere: ['#e9d5ff', '#a78bfa', '#6366f1', '#3b2f8f', '#241a5e'] as string[],
  aurora: ['#0d0d1c', '#07070e', '#050509'] as string[],
} as const;
