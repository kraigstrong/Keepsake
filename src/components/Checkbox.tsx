import { StyleSheet, View } from 'react-native';

import { colors, radii } from '../theme/tokens';
import { CheckIcon } from './icons/CheckIcon';

const BOX_SIZE = 22;
// Sized to sit inside the 22px box rather than to a step on the design
// handoff's scale, which covers standalone icons rather than ones nested
// in a control.
const CHECK_SIZE = 14;
const CHECKED_FOREGROUND = '#FFFFFF';

export interface CheckboxProps {
  checked: boolean;
}

// The checked box only — the row's press handling, label, and layout stay
// with the caller, because the four screens using this differ in all
// three (a cooking step, a sheet toggle, a recipe row, a grocery line).
export function Checkbox({ checked }: CheckboxProps) {
  return (
    <View style={[styles.box, checked && styles.boxChecked]}>
      {checked ? <CheckIcon color={CHECKED_FOREGROUND} size={CHECK_SIZE} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
});
