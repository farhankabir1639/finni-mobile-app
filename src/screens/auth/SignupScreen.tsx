import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../contexts/AuthContext';
import { signInWithGoogle } from '../../lib/googleAuth';
import Aurora from '../../components/Aurora';
import Orb from '../../components/Orb';
import { t, fonts, gradients } from '../../theme/tokens';
import Svg, { Path } from 'react-native-svg';

const PRIVACY_URL = 'https://www.heyfinni.com/privacy-policy';
const DATA_DELETION_URL = 'https://www.heyfinni.com/data-deletion';

type SignupScreenProps = {
  navigation: { navigate: (name: string) => void };
};

function GoogleIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}

function Divider() {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={[styles.dividerText, { fontFamily: fonts.medium }]}>or</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

export default function SignupScreen({ navigation }: SignupScreenProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [fullNameFocused, setFullNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);

  const handleSignUp = async () => {
    setError(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError('Email is required'); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) { setError('Please enter a valid email address'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setLoading(true);
    try {
      const { error: err } = await signUp(trimmedEmail, password, fullName?.trim() || undefined);
      if (err) { setError(err.message); return; }
      setSuccessMessage('Account created! Check your email to confirm your account.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const { error: err } = await signInWithGoogle();
      if (err) setError(err.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Aurora width={width} height={height} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* hero */}
        <View style={styles.hero}>
          <Orb size={88} rings />
          <Text style={[styles.title, { fontFamily: fonts.extraBold }]}>
            Create your account
          </Text>
          <Text style={[styles.subtitle, { fontFamily: fonts.regular }]}>
            Begin a calmer relationship with money
          </Text>
        </View>

        {/* form */}
        <View style={styles.form}>
          {/* Google button */}
          <TouchableOpacity
            style={styles.googleBtn}
            onPress={handleGoogleSignUp}
            disabled={googleLoading}
            activeOpacity={0.8}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color={t.text} />
            ) : (
              <>
                <GoogleIcon />
                <Text style={[styles.googleBtnText, { fontFamily: fonts.semiBold }]}>
                  Continue with Google
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Divider />

          <TextInput
            style={[styles.input, fullNameFocused && styles.inputFocused, { fontFamily: fonts.regular }]}
            placeholder="Full Name"
            placeholderTextColor={t.text3}
            value={fullName}
            onChangeText={setFullName}
            onFocus={() => setFullNameFocused(true)}
            onBlur={() => setFullNameFocused(false)}
            autoCapitalize="words"
            autoComplete="name"
          />
          <TextInput
            style={[styles.input, emailFocused && styles.inputFocused, { fontFamily: fonts.regular }]}
            placeholder="Email"
            placeholderTextColor={t.text3}
            value={email}
            onChangeText={setEmail}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            style={[styles.input, passwordFocused && styles.inputFocused, { fontFamily: fonts.regular }]}
            placeholder="Password"
            placeholderTextColor={t.text3}
            value={password}
            onChangeText={setPassword}
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => setPasswordFocused(false)}
            secureTextEntry
            autoComplete="new-password"
          />
          <TextInput
            style={[styles.input, confirmFocused && styles.inputFocused, { fontFamily: fonts.regular }]}
            placeholder="Confirm Password"
            placeholderTextColor={t.text3}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onFocus={() => setConfirmFocused(true)}
            onBlur={() => setConfirmFocused(false)}
            secureTextEntry
            autoComplete="new-password"
          />

          {error ? (
            <View style={styles.errorContainer}>
              <Text style={[styles.errorText, { fontFamily: fonts.medium }]}>{error}</Text>
            </View>
          ) : null}
          {successMessage ? (
            <View style={styles.successContainer}>
              <Text style={[styles.successText, { fontFamily: fonts.medium }]}>{successMessage}</Text>
            </View>
          ) : null}

          <TouchableOpacity onPress={handleSignUp} disabled={loading} activeOpacity={0.85}>
            <LinearGradient
              colors={gradients.cta}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
            >
              {loading ? (
                <ActivityIndicator color="#0b0a1a" />
              ) : (
                <Text style={[styles.ctaBtnText, { fontFamily: fonts.bold }]}>
                  Create Account
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.switchRow}>
            <Text style={[styles.switchText, { fontFamily: fonts.regular }]}>
              Already have an account?{' '}
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={[styles.switchLink, { fontFamily: fonts.semiBold }]}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* legal */}
        <View style={styles.legalNote}>
          <Text style={[styles.legalText, { fontFamily: fonts.regular }]}>
            By creating an account you agree to our{' '}
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Text style={[styles.legalLink, { fontFamily: fonts.medium }]}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={[styles.legalText, { fontFamily: fonts.regular }]}>
            . You can request{' '}
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL(DATA_DELETION_URL)}>
            <Text style={[styles.legalLink, { fontFamily: fonts.medium }]}>data deletion</Text>
          </TouchableOpacity>
          <Text style={[styles.legalText, { fontFamily: fonts.regular }]}> at any time.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.auraBg,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
  },
  hero: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    color: t.text,
    textAlign: 'center',
    letterSpacing: -0.4,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 15,
    color: t.text2,
    textAlign: 'center',
  },
  form: {
    gap: 13,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 15,
    borderRadius: t.rMd,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: t.glassLine2,
  },
  googleBtnText: {
    fontSize: 15,
    color: t.text,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: t.line,
  },
  dividerText: {
    fontSize: 13,
    color: t.text3,
  },
  input: {
    backgroundColor: 'rgba(18,26,44,0.85)',
    borderWidth: 1,
    borderColor: t.glassLine,
    borderRadius: t.rMd,
    paddingHorizontal: 18,
    paddingVertical: 15,
    fontSize: 16,
    color: t.text,
  },
  inputFocused: {
    borderColor: t.auraAqua,
  },
  ctaBtn: {
    borderRadius: t.rMd,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  ctaBtnDisabled: {
    opacity: 0.7,
  },
  ctaBtnText: {
    fontSize: 16,
    color: '#0b0a1a',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 4,
  },
  switchText: {
    fontSize: 14,
    color: t.text2,
  },
  switchLink: {
    fontSize: 14,
    color: t.auraAqua,
  },
  errorContainer: {
    backgroundColor: 'rgba(251,113,133,0.12)',
    borderRadius: t.rSm,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.3)',
  },
  errorText: {
    color: t.red,
    fontSize: 13,
    textAlign: 'center',
  },
  successContainer: {
    backgroundColor: 'rgba(52,211,153,0.12)',
    borderRadius: t.rSm,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.3)',
  },
  successText: {
    color: t.green,
    fontSize: 13,
    textAlign: 'center',
  },
  legalNote: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 20,
    paddingHorizontal: 8,
  },
  legalText: {
    fontSize: 11,
    color: t.text3,
    lineHeight: 18,
  },
  legalLink: {
    fontSize: 11,
    color: t.text3,
    textDecorationLine: 'underline',
    lineHeight: 18,
  },
});
