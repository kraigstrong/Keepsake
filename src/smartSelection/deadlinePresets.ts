// "Wrap up by" choices for a group round (1c). Preset chips rather than
// a date picker, so the feature adds no native dependency. Every preset
// is 8 PM local time on its day.

const CLOSE_HOUR = 20;
const MIN_LEAD_MS = 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DeadlinePreset {
  key: string;
  label: string;
  closesAt: Date;
}

export const DEFAULT_DEADLINE_KEY = 'tomorrow';

function eightPm(now: Date, daysAhead: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, CLOSE_HOUR);
}

/** Tonight is offered only while it is at least an hour away. */
export function deadlinePresets(now: Date = new Date()): DeadlinePreset[] {
  const presets: DeadlinePreset[] = [];
  const tonight = eightPm(now, 0);
  if (tonight.getTime() - now.getTime() >= MIN_LEAD_MS) {
    presets.push({ key: 'tonight', label: 'Tonight, 8 PM', closesAt: tonight });
  }
  presets.push({ key: 'tomorrow', label: 'Tomorrow, 8 PM', closesAt: eightPm(now, 1) });
  for (const daysAhead of [2, 3]) {
    const closesAt = eightPm(now, daysAhead);
    presets.push({
      key: `in-${daysAhead}-days`,
      label: `${WEEKDAYS[closesAt.getDay()]}, 8 PM`,
      closesAt,
    });
  }
  return presets;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function timeOfDay(date: Date): string {
  const hour = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
  const minutes = date.getMinutes();
  const suffix = date.getHours() < 12 ? 'AM' : 'PM';
  return minutes === 0
    ? `${hour} ${suffix}`
    : `${hour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "tonight at 8 PM", "tomorrow at 8 PM", "Thu at 8 PM", or "Oct 14 at 8 PM" beyond a week. */
export function describeDeadline(closesAt: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(closesAt) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  const time = timeOfDay(closesAt);
  if (days === 0) return closesAt.getHours() >= 17 ? `tonight at ${time}` : `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[closesAt.getDay()]} at ${time}`;
  return `${MONTHS[closesAt.getMonth()]} ${closesAt.getDate()} at ${time}`;
}
