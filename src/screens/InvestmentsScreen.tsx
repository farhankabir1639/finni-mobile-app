import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function InvestmentsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>📈</Text>
      <Text style={styles.title}>Investments</Text>
      <Text style={styles.subtitle}>Track your investments coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0F1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
  },
});
