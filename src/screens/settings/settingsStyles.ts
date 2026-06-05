import { StyleSheet } from 'react-native';
import { t, fonts } from '../../theme/tokens';

export const styles = StyleSheet.create({
  // ── Root / layout ──
  root: { flex: 1, backgroundColor: t.auraBg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 22, paddingBottom: 120 },

  // ── Header ──
  header: {
    paddingHorizontal: 22,
    paddingTop: 62,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: fonts.extraBold,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.6,
  },

  // ── Profile card ──
  profileCard: {
    alignItems: 'center',
    padding: 26,
    paddingBottom: 24,
    marginBottom: 24,
    overflow: 'hidden',
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 34,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: '#fff',
  },
  profileName: {
    fontSize: 20,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: t.text,
    marginTop: 16,
  },
  profileEmail: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: t.text2,
    marginTop: 4,
  },

  // ── Section ──
  sectionLabel: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: t.text3,
    marginBottom: 12,
    marginLeft: 4,
  },
  section: { marginBottom: 24 },

  // ── Settings row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 15,
    paddingHorizontal: 16,
    borderRadius: t.rMd,
    backgroundColor: t.glass2,
    borderWidth: 1,
    borderColor: t.glassLine,
    marginBottom: 10,
  },
  rowDanger: {
    backgroundColor: 'rgba(251,113,133,0.08)',
    borderColor: 'rgba(251,113,133,0.35)',
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.medium,
    fontWeight: '500',
    color: t.text,
  },
  rowChevron: {
    fontSize: 18,
    color: t.text3,
    fontWeight: '600',
  },

  // ── Disclaimer ──
  disclaimer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
    paddingHorizontal: 4,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: fonts.medium,
    fontWeight: '500',
    color: t.text3,
    lineHeight: 20,
  },

  // ── Sign out button ──
  signOutBtn: {
    marginTop: 22,
    paddingVertical: 17,
    borderRadius: t.rMd,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  signOutText: {
    fontSize: 17,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: '#fff',
  },

  // ═══ Modal shared ═══
  modalRoot: { flex: 1, backgroundColor: t.auraBg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 60,
    paddingBottom: 16,
  },
  modalTitle: {
    fontSize: 26,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: t.text,
    letterSpacing: -0.5,
  },
  modalHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: t.rPill,
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: t.text2,
  },
  modalScroll: { flex: 1 },
  modalScrollContent: { padding: 22, paddingBottom: 100 },
  modalLoading: { paddingVertical: 48, alignItems: 'center' },

  // ── Add/Action button (small) ──
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: t.rMd,
    backgroundColor: t.auraIndigo,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addBtnText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: '#fff',
  },
  aiBudgetBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: t.rMd,
    backgroundColor: t.glass2,
    borderWidth: 1,
    borderColor: t.glassLine2,
  },
  aiBudgetText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.auraAqua,
  },

  // ── Form ──
  formCard: {
    padding: 18,
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 17,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text,
    letterSpacing: -0.3,
    marginBottom: 14,
  },
  formLabel: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: t.text3,
    marginBottom: 10,
  },
  formInput: {
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
    borderRadius: t.rMd,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15.5,
    fontFamily: fonts.medium,
    fontWeight: '500',
    color: t.text,
    marginBottom: 14,
  },
  formInputBig: {
    height: 60,
    fontSize: 17,
    paddingHorizontal: 18,
  },
  formRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },

  // ── Chip (generic glass chip) ──
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: t.rPill,
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
  },
  chipActive: {
    backgroundColor: t.auraIndigo,
    borderColor: 'transparent',
  },
  chipText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text2,
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // ── Buttons ──
  btnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: t.rMd,
    backgroundColor: t.auraIndigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    fontSize: 16,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: '#fff',
  },
  btnSecondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: t.rMd,
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text2,
  },

  // ── Mini button (edit/delete) ──
  miniBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
  },

  // ── Empty state ──
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: t.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: t.text2,
    marginBottom: 20,
  },

  // ── Category card ──
  catCard: {
    padding: 16,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  catTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  catIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catInfo: { flex: 1, minWidth: 0 },
  catName: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text,
  },
  catBudget: {
    fontSize: 13.5,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.auraAqua,
    marginTop: 3,
  },
  catProgress: { marginTop: 13 },
  catProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  catSpent: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: t.text3,
  },
  catPct: {
    fontSize: 12,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  barTrack: {
    height: 6,
    borderRadius: 99,
    backgroundColor: t.surface3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 99,
  },

  // ── Goal card ──
  goalCard: {
    padding: 18,
    paddingBottom: 20,
    marginBottom: 14,
  },
  goalTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  goalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  goalIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: t.cyanTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalName: {
    fontSize: 16.5,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text,
  },
  goalTypeBadge: {
    marginTop: 5,
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 99,
    backgroundColor: 'rgba(139,92,246,0.18)',
    alignSelf: 'flex-start',
  },
  goalTypeBadgeText: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: t.auraViolet,
  },
  goalProgress: { marginTop: 16 },
  goalStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 11,
  },
  goalAmounts: {
    fontSize: 13.5,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: t.text,
  },
  goalAmountTarget: {
    color: t.text3,
    fontWeight: '500',
  },
  goalDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  goalDateText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: t.text3,
  },

  // ── Currency item ──
  currencyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 15,
    paddingHorizontal: 18,
    borderRadius: t.rLg,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 10,
  },
  currencyItemActive: {
    backgroundColor: t.indigoTint,
    borderColor: t.lineIndigo,
  },
  currencySymBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: t.surface2,
    borderWidth: 1,
    borderColor: t.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencySym: {
    fontSize: 18,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: t.text2,
  },
  currencySymActive: { color: t.indigoBright },
  currencyCode: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text,
  },
  currencyCodeActive: { color: t.indigoBright },
  currencyName: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: t.text3,
    marginTop: 2,
  },
  currencyCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Income banner ──
  incomeBanner: {
    padding: 20,
    borderRadius: t.rXl,
    backgroundColor: t.greenTint,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.3)',
    alignItems: 'center',
    marginBottom: 22,
  },
  incomeBannerLabel: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: t.green,
  },
  incomeBannerAmount: {
    fontSize: 32,
    fontFamily: fonts.extraBold,
    fontWeight: '800',
    color: t.green,
    marginTop: 10,
    letterSpacing: -0.5,
  },

  // ── Income item ──
  incomeCard: {
    padding: 16,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  incomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  incomeIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: t.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incomeInfo: { flex: 1 },
  incomeLabel: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text,
  },
  incomeSub: {
    fontSize: 13.5,
    fontFamily: fonts.medium,
    color: t.text3,
    marginTop: 3,
  },
  incomeDeleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: t.redTint,
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Info box (edit profile) ──
  infoBox: {
    marginTop: 18,
    padding: 14,
    paddingHorizontal: 16,
    borderRadius: t.rMd,
    backgroundColor: t.indigoTint,
    borderWidth: 1,
    borderColor: t.lineIndigo,
    flexDirection: 'row',
    gap: 10,
  },
  infoBoxText: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: fonts.medium,
    fontWeight: '500',
    color: t.text2,
    lineHeight: 21,
  },
  infoBoxHighlight: {
    color: t.indigoBright,
    fontWeight: '700',
  },
});
