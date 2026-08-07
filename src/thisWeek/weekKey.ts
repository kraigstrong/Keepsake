/**
 * ISO 8601 year-week ("2026-W32") of the given date, computed from the
 * device's local calendar — the "current week" partition key
 * get_or_create_current_weekly_plan() expects (ADR-0021: no household
 * timezone is stored anywhere in this app, so this is a client-clock
 * approximation, not a true household-local computation).
 *
 * Standard ISO week algorithm: a week belongs to the year containing its
 * Thursday, so shift to that week's Thursday first, then count whole
 * weeks from the year's own first Thursday. Handles both boundary cases
 * this way — e.g. Dec 31 can fall in week 1 of the next year, and Jan 1
 * can fall in week 52/53 of the previous year.
 */
export function currentWeekKey(date: Date = new Date()): string {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const isoDayNumber = (target.getDay() + 6) % 7; // Mon=0 .. Sun=6
  target.setDate(target.getDate() - isoDayNumber + 3); // this week's Thursday

  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstIsoDayNumber = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstIsoDayNumber + 3);

  const weekNumber =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));

  return `${target.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}
