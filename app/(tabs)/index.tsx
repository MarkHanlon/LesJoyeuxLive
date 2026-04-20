import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';

export default function HomeScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Les Joyeux Live</Text>
      <Text style={styles.subtitle}>Family Organization App</Text>
      {user && <Text style={styles.greeting}>Bonjour, {user.name} !</Text>}

      <TouchableOpacity style={styles.notMe} onPress={logout}>
        <Text style={styles.notMeText}>Not me</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5EDD6',
  },
  title: {
    fontSize: 32,
    fontFamily: 'Playfair Display, Georgia, serif',
    fontWeight: 'bold',
    color: '#1A1209',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#5C3D2E',
  },
  greeting: {
    marginTop: 16,
    fontSize: 15,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#8B6245',
    fontStyle: 'italic',
  },
  notMe: {
    position: 'absolute',
    bottom: 16,
    right: 20,
  },
  notMeText: {
    fontSize: 11,
    fontFamily: 'Raleway, system-ui, sans-serif',
    color: '#B8956A',
    textDecorationLine: 'underline',
  },
});
