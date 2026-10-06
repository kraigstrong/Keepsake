import { DEFAULT_DEADLINE_KEY, deadlinePresets } from './deadlinePresets';

// Months are zero-based: 9 is October. 2026-10-06 is a Tuesday.
function local(day: number, hour: number, minute = 0) {
  return new Date(2026, 9, day, hour, minute);
}

it('offers tonight, tomorrow and the two days after, all at 8 PM local', () => {
  const presets = deadlinePresets(local(6, 9));

  expect(presets.map((p) => p.label)).toEqual([
    'Tonight, 8 PM',
    'Tomorrow, 8 PM',
    'Thu, 8 PM',
    'Fri, 8 PM',
  ]);
  expect(presets.map((p) => p.closesAt)).toEqual([
    local(6, 20),
    local(7, 20),
    local(8, 20),
    local(9, 20),
  ]);
});

it('drops tonight once it is less than an hour away', () => {
  expect(deadlinePresets(local(6, 19, 0)).map((p) => p.key)).toContain('tonight');
  expect(deadlinePresets(local(6, 19, 1)).map((p) => p.key)).not.toContain('tonight');
  expect(deadlinePresets(local(6, 21)).map((p) => p.key)).not.toContain('tonight');
});

it('rolls weekday labels across a month boundary', () => {
  const presets = deadlinePresets(local(30, 21));
  expect(presets.map((p) => p.label)).toEqual(['Tomorrow, 8 PM', 'Sun, 8 PM', 'Mon, 8 PM']);
  expect(presets[2]!.closesAt).toEqual(new Date(2026, 10, 2, 20));
});

it('always includes the default, and every preset is in the future', () => {
  for (const hour of [0, 12, 19, 23]) {
    const now = local(6, hour);
    const presets = deadlinePresets(now);
    expect(presets.some((p) => p.key === DEFAULT_DEADLINE_KEY)).toBe(true);
    for (const preset of presets) {
      expect(preset.closesAt.getTime()).toBeGreaterThan(now.getTime());
    }
  }
});
