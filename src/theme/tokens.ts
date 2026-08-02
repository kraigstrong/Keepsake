/**
 * Design tokens — plain object, styled via React Native's built-in
 * StyleSheet, deliberately not a styling framework (ADR-0007). The PRD's
 * scope ("few settings," "calm," no visually complex screens) doesn't
 * need one; add a framework only if this outgrows a plain tokens object.
 *
 * Light-mode only for now, matching app.json's userInterfaceStyle.
 */

export const colors = {
  background: '#FFFFFF',
  surface: '#F5F5F5',
  border: '#E0E0E0',
  textPrimary: '#1A1A1A',
  textSecondary: '#5C5C5C',
  textTertiary: '#8A8A8A',
  accent: '#2E7D5B',
  danger: '#B3261E',
  warning: '#8A6D00',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Font sizes/line heights only — actual scaling for Dynamic Type happens
 * automatically via React Native's Text component (allowFontScaling
 * defaults to true), not something these tokens need to compute.
 */
export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const;

export const radii = {
  sm: 6,
  md: 12,
  lg: 20,
  full: 999,
} as const;
