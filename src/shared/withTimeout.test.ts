import { TimeoutError, withTimeout } from './withTimeout';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('withTimeout', () => {
  it('passes a value through untouched when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'work')).resolves.toBe('ok');
  });

  it('passes the original rejection through rather than masking it', async () => {
    const failure = { code: 'P0001', message: 'invitation has expired' };
    await expect(withTimeout(Promise.reject(failure), 1000, 'work')).rejects.toEqual(failure);
  });

  it('rejects with a TimeoutError when the work never settles', async () => {
    const pending = withTimeout(new Promise(() => {}), 1000, 'accept_invitation');
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('names what stalled, so a Sentry report says which call it was', async () => {
    const pending = withTimeout(new Promise(() => {}), 250, 'accept_invitation');
    const assertion = expect(pending).rejects.toThrow('accept_invitation did not respond');
    jest.advanceTimersByTime(250);
    await assertion;
  });

  // Without this the timer stays queued after a fast success, which keeps
  // Jest's fake clock (and a real app's timer queue) busy for the full
  // timeout after the work is already done.
  it('clears its timer once the work settles', async () => {
    await withTimeout(Promise.resolve('ok'), 10_000, 'work');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears its timer when the work rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('no')), 10_000, 'work')).rejects.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });
});
