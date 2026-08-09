// Manual mock, applied automatically to every test — see
// __mocks__/posthog-react-native.js for the same pattern. Needed once
// src/thisWeek/ThisWeekScreen.tsx started pulling in
// react-native-gesture-handler/ReanimatedSwipeable (gesture-handler v3
// dropped the classic non-Reanimated Swipeable).
//
// Not reanimated's own bundled `react-native-reanimated/mock` — that
// mock's index re-exports (setUpTests, reanimatedVersion, etc.) pull in
// the real `initializers.native.ts`, which unconditionally instantiates
// the native Worklets module and crashes under Jest ("Cannot read
// properties of undefined (reading 'loadUnpackers')"), unlike the
// generic (non-`.native`) initializer, which does guard on
// `IS_JEST`. So this hand-rolls just the surface
// ReanimatedSwipeable/gesture-handler actually touch, mirroring the
// shape of reanimated's own mock (lib/module/mock.js) for the pieces
// that don't require touching the real module graph.
const { View, Text, Image, Animated: AnimatedRN } = require('react-native');
const { Extrapolation } = require('react-native-reanimated/lib/module/interpolation');
const { ReduceMotion } = require('react-native-reanimated/lib/module/commonTypes');

const NOOP = () => {};
const ID = (value) => value;

// ReanimatedSwipeable branches on this global to tell JS-thread code from
// worklet (UI-thread) code — the real babel plugin/worklet runtime sets it,
// neither of which run here, so it's just undeclared without this.
globalThis._WORKLET = false;

// Satisfies react-native-gesture-handler's ReanimatedNativeDetector, which
// otherwise falls back to requiring
// react-native-reanimated/src/createAnimatedComponent/NativeEventsManager
// directly (a subpath require Jest's module mock can't intercept) and
// instantiates it once per Swipeable row — with several rows in a list,
// any real failure there surfaces as a single opaque AggregateError, not
// a readable per-instance stack.
class MockNativeEventsManager {
  attachEvents() {}
  detachEvents() {}
  updateEvents() {}
}

// gesture-handler's useJSResponderHandler calls .addListener/.removeListener
// directly on shared values it's given (e.g. Swipeable's `enabled` prop
// wrapped as one) — real SharedValues support this, a plain { value } object
// doesn't.
function makeSharedValue(initial) {
  const listeners = new Map();
  return {
    __isReanimatedSharedValue: true,
    value: initial,
    get: function () {
      return this.value;
    },
    set: function (next) {
      this.value = typeof next === 'function' ? next(this.value) : next;
    },
    addListener: (id, listener) => listeners.set(id, listener),
    removeListener: (id) => listeners.delete(id),
  };
}

module.exports = {
  __esModule: true,

  NativeEventsManager: MockNativeEventsManager,

  runOnJS: ID,
  runOnUI: ID,
  createSerializable: ID,
  cancelAnimation: NOOP,
  enableLayoutAnimations: NOOP,
  isReanimated3: () => false,

  useSharedValue: makeSharedValue,
  isSharedValue: (value) =>
    !!value && typeof value === 'object' && value.__isReanimatedSharedValue === true,
  // Drops a computed `pointerEvents` — ReanimatedSwipeable derives it from
  // swipe-progress shared values that only a real gesture would advance
  // (open/closed starts closed and stays there under a static render), so
  // taking it at face value would make the swipe actions permanently
  // untouchable by RTL's pointerEvents-aware fireEvent, in tests that
  // aren't exercising the swipe gesture itself.
  useAnimatedStyle: (styleFactory) => {
    const style = typeof styleFactory === 'function' ? styleFactory() : {};
    if (style && typeof style === 'object' && 'pointerEvents' in style) {
      const { pointerEvents: _pointerEvents, ...rest } = style;
      return rest;
    }
    return style;
  },
  useAnimatedReaction: NOOP,
  useAnimatedRef: () => ({ current: null }),
  useDerivedValue: (processor) => makeSharedValue(processor()),
  useEvent: () => NOOP,
  useHandler: () => ({ doDependenciesDiffer: false, context: { lastUpdateEvent: undefined } }),
  makeMutable: makeSharedValue,
  isWorkletFunction: () => false,

  withSpring: (toValue, _config, callback) => {
    callback?.(true);
    return toValue;
  },
  withTiming: (toValue, _config, callback) => {
    callback?.(true);
    return toValue;
  },
  withDelay: (_delayMs, nextAnimation) => nextAnimation,
  withRepeat: ID,
  withSequence: () => 0,

  measure: () => ({ x: 0, y: 0, width: 0, height: 0, pageX: 0, pageY: 0 }),
  scrollTo: NOOP,

  Extrapolation,
  interpolate: NOOP,
  clamp: NOOP,
  ReduceMotion,

  default: {
    View,
    Text,
    Image,
    ScrollView: AnimatedRN.ScrollView,
    FlatList: AnimatedRN.FlatList,
    Extrapolate: Extrapolation,
    createAnimatedComponent: ID,
  },
};
