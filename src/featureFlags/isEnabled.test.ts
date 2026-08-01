import { FLAGS } from './flags';
import { isEnabled } from './isEnabled';

describe('isEnabled', () => {
  afterEach(() => {
    delete FLAGS.testFlag;
  });

  it('fails closed for an unregistered flag name', () => {
    expect(isEnabled('definitelyNotARegisteredFlag')).toBe(false);
  });

  it('reflects a registered flag value', () => {
    FLAGS.testFlag = true;

    expect(isEnabled('testFlag')).toBe(true);
  });
});
