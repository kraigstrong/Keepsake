/**
 * Design tokens — plain object, styled via React Native's built-in
 * StyleSheet, deliberately not a styling framework (ADR-0007). The PRD's
 * scope ("few settings," "calm," no visually complex screens) doesn't
 * need one; add a framework only if this outgrows a plain tokens object.
 *
 * "Ink & Paper" visual direction (Phase 3.5, ADR-0009) — flat, editorial,
 * no shadows/elevation; hierarchy comes from hairlines and type weight.
 *
 * Light-mode only for now, matching app.json's userInterfaceStyle. The
 * design handoff includes a dark palette for Cooking Mode specifically
 * (Phase 4+, not built yet) — not represented here until that screen
 * exists.
 */

export const colors = {
  background: '#F7F3EC',
  // No distinct "elevated" surface in this direction (no shadows) — a
  // faint warm tint off the paper background, just enough to read as a
  // separate region (banners, secondary buttons, image placeholders)
  // without introducing elevation.
  surface: '#F1EBDF',
  border: 'rgba(33, 29, 24, 0.12)',
  textPrimary: '#211D18',
  textSecondary: 'rgba(33, 29, 24, 0.55)',
  textTertiary: 'rgba(33, 29, 24, 0.45)',
  // Rust — reserved for primary actions, checkmarks, step numbers, flags.
  // Never used as a general "brand color" wash.
  accent: '#B5502E',
  danger: '#9B3A26',
  warning: '#8C6D2F',
} as const;

// 24px screen padding, 14px row padding, otherwise an 8-point-ish rhythm
// (6/8/12/14/18/22px gaps per the handoff) — xs/md retuned to match;
// lg/xl/xxl were already consistent with it.
export const spacing = {
  xs: 6,
  sm: 8,
  md: 14,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Font sizes/line heights only — actual scaling for Dynamic Type happens
 * automatically via React Native's Text component (allowFontScaling
 * defaults to true), not something these tokens need to compute.
 *
 * letterSpacing values are the handoff's em specs converted to points
 * against each role's own fontSize (RN's letterSpacing is absolute, not
 * font-relative).
 */
export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.56 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 27, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  // body's roomy 27pt lineHeight (tuned for paragraph text) clips
  // descenders (g, y, p) at the bottom on iOS single-line TextInputs —
  // the native field doesn't grow to fit an RN lineHeight taller than
  // its own font-metric height the way multiline Text does. Every
  // TextInput in the app should use this instead of body.
  input: { fontSize: 16, lineHeight: 20, fontWeight: '400' },
} as const;

// Thumbnails/buttons 10–12px, hero images 16px, pills fully round, list
// rows/dividers unrounded (flat, editorial — no radius token needed
// there, rows just don't apply one).
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;
