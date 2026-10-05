import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readMealsOnlyPreference,
  writeMealsOnlyPreference,
  useMealsOnlyPreference,
} from './useMealsOnlyPreference';

afterEach(() => {
  jest.restoreAllMocks();
  return AsyncStorage.clear();
});

it('starts off and remembers separate Library and planning choices', async () => {
  expect(await readMealsOnlyPreference('library')).toBe(false);
  expect(await readMealsOnlyPreference('planning')).toBe(false);
  await writeMealsOnlyPreference('planning', true);
  expect(await readMealsOnlyPreference('planning')).toBe(true);
  expect(await readMealsOnlyPreference('library')).toBe(false);
  await writeMealsOnlyPreference('planning', false);
  expect(await readMealsOnlyPreference('planning')).toBe(false);
});

it('falls back to off for corrupt/unreadable preferences, and tolerates failed writes', async () => {
  await AsyncStorage.setItem('keepsake.library.mealsOnly', 'bogus');
  expect(await readMealsOnlyPreference('library')).toBe(false);
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('read failed'));
  expect(await readMealsOnlyPreference('planning')).toBe(false);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('write failed'));
  await expect(writeMealsOnlyPreference('planning', true)).resolves.toBeUndefined();
});

it('rehydrates a reopened planning sheet without overriding a choice made during the read', async () => {
  await writeMealsOnlyPreference('planning', true);
  const { result, rerender } = await renderHook<
    ReturnType<typeof useMealsOnlyPreference>,
    { visible: boolean }
  >(({ visible }) => useMealsOnlyPreference('planning', visible), {
    initialProps: { visible: true },
  });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.mealsOnly).toBe(true);
  await rerender({ visible: false });
  expect(result.current.ready).toBe(false);
  let releaseRead: (value: string | null) => void = () => {};
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseRead = resolve;
      }),
  );
  await rerender({ visible: true });
  expect(result.current.ready).toBe(false);
  await act(() => result.current.setMealsOnly(false));
  await act(() => releaseRead('true'));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.mealsOnly).toBe(false);
});
