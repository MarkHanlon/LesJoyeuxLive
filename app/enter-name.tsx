import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function EnterName() {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();

  async function handleJoin() {
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await register(name.trim());
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong. Try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Decorative leaf — bottom-right corner */}
      <Text style={styles.bgLeaf}>🍃</Text>

      <View style={styles.inner}>
        <Text style={styles.fleur}>⚜</Text>

        <View style={styles.headingBlock}>
          <Text style={styles.headline}>Bienvenue !</Text>
          <Text style={styles.subline}>
            Tell us your name{'\n'}to join the family.
          </Text>
        </View>

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
            onSubmitEditing={handleJoin}
            autoFocus
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="done"
          />
          <View style={styles.inputBar} />
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
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5EDD6',
  },
  bgLeaf: {
    position: 'absolute',
    fontSize: 220,
    bottom: -30,
    right: -40,
    opacity: 0.06,
    transform: [{ rotate: '-20deg' }],
    pointerEvents: 'none',
  } as any,
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
    marginBottom: 28,
    letterSpacing: 4,
  },
  headingBlock: {
    alignItems: 'center',
    marginBottom: 44,
  },
  headline: {
    fontSize: 46,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontStyle: 'italic',
    color: '#1A1209',
    textAlign: 'center',
    lineHeight: 54,
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
  inputBlock: {
    width: '100%',
    maxWidth: 340,
    marginBottom: 8,
  },
  input: {
    fontSize: 24,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#1A1209',
    paddingVertical: 12,
    paddingHorizontal: 4,
    letterSpacing: 0.5,
  },
  inputBar: {
    height: 2,
    backgroundColor: '#C8973D',
    borderRadius: 1,
  },
  error: {
    fontSize: 14,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#C85A2E',
    marginTop: 10,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#C85A2E',
    paddingVertical: 17,
    paddingHorizontal: 44,
    borderRadius: 50,
    marginTop: 40,
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
    marginTop: 52,
    fontSize: 20,
    color: '#C8973D',
    opacity: 0.55,
    letterSpacing: 6,
  },
});
