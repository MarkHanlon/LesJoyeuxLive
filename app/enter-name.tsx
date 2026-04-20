import { useRef, useState } from 'react';
import {
  View,
  Image,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function EnterName() {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const pinRef = useRef<TextInput>(null);
  const { width, height } = useWindowDimensions();

  async function handleJoin() {
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await register(name.trim(), pin);
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong. Try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.root}>
      <Image
        source={require('../assets/les_joyeux.jpg')}
        style={[styles.bgImage, { width, height }]}
        resizeMode="cover"
      />
      <View style={styles.overlay} />

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.inner}>
          <Text style={styles.fleur}>⚜</Text>

          <View style={styles.headingBlock}>
            <Text style={styles.headline}>Bienvenue !</Text>
            <Text style={styles.subline}>
              Tell us your name{'\n'}to join the family.
            </Text>
          </View>

          {/* Frosted card holds the form inputs */}
          <View style={styles.card}>
            <View style={styles.inputBlock}>
              <TextInput
                style={styles.input}
                placeholder="Your first name"
                placeholderTextColor="#B8956A"
                value={name}
                onChangeText={text => {
                  setName(text);
                  setError('');
                }}
                onSubmitEditing={() => pinRef.current?.focus()}
                autoFocus
                autoComplete="given-name"
                textContentType="givenName"
                returnKeyType="next"
              />
              <View style={styles.inputBar} />
            </View>

            <View style={[styles.inputBlock, { marginTop: 28 }]}>
              <Text style={styles.pinLabel}>Your PIN</Text>
              <TextInput
                ref={pinRef}
                style={styles.input}
                placeholder="4-digit PIN"
                placeholderTextColor="#B8956A"
                value={pin}
                onChangeText={text => {
                  setPin(text.replace(/\D/g, '').slice(0, 4));
                  setError('');
                }}
                keyboardType="numeric"
                maxLength={4}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={handleJoin}
              />
              <View style={styles.inputBar} />
              <Text style={styles.pinHint}>New here? Just make up any 4 digits.{'\n'}Joining again on a new device? Use your usual PIN.</Text>
            </View>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, isSubmitting && styles.buttonDisabled]}
            onPress={handleJoin}
            disabled={isSubmitting}
            activeOpacity={0.82}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#F5EDD6" />
            ) : (
              <Text style={styles.buttonText}>Join the Family →</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.vines}>🌿 &nbsp;&nbsp; ⚜ &nbsp;&nbsp; 🌿</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(245, 237, 214, 0.74)',
  },
  keyboardAvoid: {
    flex: 1,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingBottom: 40,
  },
  fleur: {
    fontSize: 34,
    color: '#C8973D',
    marginBottom: 24,
    letterSpacing: 4,
  },
  headingBlock: {
    alignItems: 'center',
    marginBottom: 40,
  },
  headline: {
    fontSize: 52,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    textAlign: 'center',
    lineHeight: 60,
    marginBottom: 14,
  },
  subline: {
    fontSize: 17,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#5C3D2E',
    textAlign: 'center',
    lineHeight: 27,
    letterSpacing: 0.3,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(255, 252, 244, 0.82)',
    borderRadius: 18,
    paddingVertical: 28,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: 'rgba(200, 151, 61, 0.25)',
    shadowColor: '#6B4A1A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
    marginBottom: 8,
  },
  inputBlock: {
    width: '100%',
  },
  input: {
    fontSize: 22,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#1A1209',
    paddingVertical: 10,
    paddingHorizontal: 2,
    letterSpacing: 0.5,
  },
  inputBar: {
    height: 1.5,
    backgroundColor: '#C8973D',
    borderRadius: 1,
    opacity: 0.6,
  },
  pinLabel: {
    fontSize: 12,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  pinHint: {
    fontSize: 12,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    textAlign: 'center',
    letterSpacing: 0.2,
    marginTop: 10,
  },
  error: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#C85A2E',
    marginTop: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#C85A2E',
    paddingVertical: 17,
    paddingHorizontal: 44,
    borderRadius: 50,
    marginTop: 36,
    shadowColor: '#6B2E15',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
    minWidth: 230,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    fontSize: 17,
    fontFamily: 'Raleway, system-ui, sans-serif',
    fontWeight: '700',
    color: '#F5EDD6',
    letterSpacing: 1,
  },
  vines: {
    marginTop: 44,
    fontSize: 20,
    color: '#C8973D',
    opacity: 0.6,
    letterSpacing: 6,
  },
});
