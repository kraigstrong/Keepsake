// Manual mock, applied automatically to every test — see
// __mocks__/@sentry/react-native.js for why (same class of issue, same
// fix). A jest.fn() constructor (not a plain class) so tests can assert
// on how it was called, not just on the instance it produces.
const mockCapture = jest.fn();
const PostHog = jest.fn().mockImplementation(() => ({ capture: mockCapture }));
PostHog.mockCapture = mockCapture;

module.exports = PostHog;
module.exports.default = PostHog;
