import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../src/components/Button';
import { useSession } from '../src/session/SessionProvider';
import { colors, spacing, typography } from '../src/theme/tokens';

/**
 * Email OTP (magic-link code), not a password — ADR-0008: no new secret
 * for a non-technical household member to choose, remember, or recover.
 * Two steps: request a code, then verify it. Once verifyOtp succeeds,
 * the auth-state listener in SessionProvider updates the session and
 * app/_layout.tsx's Stack.Protected guard navigates away on its own —
 * this screen never navigates itself.
 */
export default function SignInScreen() {
  const { sendOtp, verifyOtp } = useSession();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSendCode = async () => {
    setError(null);
    setIsSubmitting(true);
    const { error: sendError } = await sendOtp(email.trim());
    setIsSubmitting(false);

    if (sendError) {
      setError(sendError);
      return;
    }
    setStep('code');
  };

  const handleVerifyCode = async () => {
    setError(null);
    setIsSubmitting(true);
    const { error: verifyError } = await verifyOtp(email.trim(), code.trim());
    setIsSubmitting(false);

    if (verifyError) {
      setError(verifyError);
    }
  };

  return (
    <View style={styles.container} testID="sign-in-screen">
      <Text style={styles.title}>Sign in</Text>

      {step === 'email' ? (
        <>
          <TextInput
            testID="sign-in-email-input"
            style={styles.input}
            placeholder="Email address"
            placeholderTextColor={colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!isSubmitting}
          />
          <Button
            testID="sign-in-send-code-button"
            title="Send code"
            onPress={handleSendCode}
            disabled={isSubmitting || email.trim().length === 0}
          />
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>Enter the code we sent to {email}</Text>
          <TextInput
            testID="sign-in-code-input"
            style={styles.input}
            placeholder="6-digit code"
            placeholderTextColor={colors.textTertiary}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            editable={!isSubmitting}
          />
          <Button
            testID="sign-in-verify-button"
            title="Verify"
            onPress={handleVerifyCode}
            disabled={isSubmitting || code.trim().length === 0}
          />
          <Button
            testID="sign-in-change-email-button"
            title="Use a different email"
            variant="secondary"
            onPress={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
            disabled={isSubmitting}
          />
        </>
      )}

      {error && (
        <Text style={styles.error} testID="sign-in-error" accessible accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  error: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
});
