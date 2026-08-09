// Manual mock — see __mocks__/react-native-reanimated.js for why. Only
// react-native-gesture-handler's reanimatedWrapper.ts touches this
// package directly (Worklets?.scheduleOnUI(...)), and the real module
// crashes at import under Jest the same way reanimated's native
// initializers do.
module.exports = {
  scheduleOnUI: (fn) => {
    if (typeof fn === 'function') fn();
  },
};
