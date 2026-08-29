import { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, TextInput } from 'react-native';

import { useSession } from './SessionProvider';
import { Button } from '../components/Button';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Email OTP (magic-link code) is the default and only required sign-in
 * method — ADR-0008: no new secret for a non-technical household member
 * to choose, remember, or recover. ADR-0012 adds an opt-in password path
 * alongside it for whoever has set one from Settings, without changing
 * this default for anyone who hasn't. Once verifyOtp/signInWithPassword
 * succeeds, the auth-state listener in SessionProvider updates the
 * session and app/_layout.tsx's Stack.Protected guard navigates away on
 * its own — this screen never navigates itself.
 */
export function SignInScreen() {
  const { sendOtp, verifyOtp, signInWithPassword } = useSession();
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
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

  const handleSignInWithPassword = async () => {
    setError(null);
    setIsSubmitting(true);
    const { error: signInError } = await signInWithPassword(email.trim(), password);
    setIsSubmitting(false);

    if (signInError) {
      setError(signInError);
    }
  };

  return (
    // KeyboardAvoidingView, not the ScrollView inset SettingsScreen uses:
    // this screen is a centred flex:1 View with nothing to scroll, so
    // there is no content inset to adjust. "padding" shrinks the
    // container by the keyboard's height, and centred content rises with
    // it — which is what keeps "Sign in with password instead" reachable
    // (developer device testing, 2026-08-29).
    <KeyboardAvoidingView behavior="padding" style={styles.container} testID="sign-in-screen">
      <Text style={styles.title}>Sign in</Text>

      {step === 'email' ? (
        <>
          <Text style={styles.subtitle}>
            New here? Entering your email creates your account — no separate sign-up needed.
          </Text>
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
          <Button
            testID="sign-in-use-password-button"
            title="Sign in with password instead"
            variant="secondary"
            onPress={() => {
              setStep('password');
              setError(null);
            }}
            disabled={isSubmitting || email.trim().length === 0}
          />
        </>
      ) : step === 'code' ? (
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
      ) : (
        <>
          <Text style={styles.subtitle}>Sign in to {email}</Text>
          <TextInput
            testID="sign-in-password-input"
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            editable={!isSubmitting}
          />
          <Button
            testID="sign-in-with-password-button"
            title="Sign in"
            onPress={handleSignInWithPassword}
            disabled={isSubmitting || password.length === 0}
          />
          <Button
            testID="sign-in-use-code-button"
            title="Use a code instead"
            variant="secondary"
            onPress={() => {
              setStep('email');
              setPassword('');
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
    </KeyboardAvoidingView>
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
    ...typography.input,
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
