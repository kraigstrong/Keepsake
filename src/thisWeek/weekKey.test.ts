import { currentWeekKey } from './weekKey';

describe('currentWeekKey', () => {
  it('returns the ISO year-week for a plain midweek date', () => {
    // 2026-08-06 is a Thursday, ISO week 32 (day 218 of 2026, exactly
    // 31 whole weeks after 2026-01-01's own Thursday).
    expect(currentWeekKey(new Date(2026, 7, 6))).toBe('2026-W32');
  });

  it('returns the same key for every day Monday through Sunday of a week', () => {
    const days = [3, 4, 5, 6, 7, 8, 9].map((day) => new Date(2026, 7, day));
    for (const day of days) {
      expect(currentWeekKey(day)).toBe('2026-W32');
    }
  });

  it('assigns January 1st to week 1 when it falls on a Thursday', () => {
    expect(currentWeekKey(new Date(2026, 0, 1))).toBe('2026-W01');
  });

  it("assigns the last days of December to next year's week 1 when appropriate", () => {
    // 2025-12-31 is a Wednesday; its ISO week's Thursday is 2026-01-01,
    // so it belongs to 2026-W01, not 2025's own last week.
    expect(currentWeekKey(new Date(2025, 11, 31))).toBe('2026-W01');
  });

  it('always produces a zero-padded two-digit week number', () => {
    expect(currentWeekKey(new Date(2026, 0, 1))).toMatch(/^\d{4}-W\d{2}$/);
  });
});
