import React from 'react';
import { Modal, View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { t, fonts } from '../theme/tokens';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.finni.app';

interface UpdatePromptProps {
  type: 'soft' | 'force';
  onDismiss?: () => void;
}

export default function UpdatePrompt({ type, onDismiss }: UpdatePromptProps) {
  const isForce = type === 'force';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={isForce ? undefined : onDismiss}
    >
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.emoji}>🚀</Text>
          <Text style={s.title}>{isForce ? 'Update Required' : 'Update Available'}</Text>
          <Text style={s.body}>
            {isForce
              ? 'This version of Finni is no longer supported. Please update to continue using the app.'
              : 'A new version of Finni is available with improvements and bug fixes. Update now for the best experience.'}
          </Text>

          <TouchableOpacity
            style={s.updateBtn}
            onPress={() => Linking.openURL(PLAY_STORE_URL)}
            activeOpacity={0.85}
          >
            <Text style={s.updateBtnText}>Update Now</Text>
          </TouchableOpacity>

          {!isForce && (
            <TouchableOpacity style={s.laterBtn} onPress={onDismiss} activeOpacity={0.7}>
              <Text style={s.laterBtnText}>Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2,3,8,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    backgroundColor: 'rgba(14,12,26,0.98)',
    borderRadius: t.rXl,
    borderWidth: 1,
    borderColor: t.glassLine2,
    padding: 28,
    alignItems: 'center',
  },
  emoji: { fontSize: 44, marginBottom: 14 },
  title: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: t.text,
    letterSpacing: -0.4,
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    fontSize: 14.5,
    fontFamily: fonts.regular,
    color: t.text2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 26,
  },
  updateBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: t.rMd,
    backgroundColor: t.auraIndigo,
    alignItems: 'center',
    marginBottom: 10,
  },
  updateBtnText: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: '#fff',
  },
  laterBtn: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: t.rMd,
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
    alignItems: 'center',
  },
  laterBtnText: {
    fontSize: 15,
    fontFamily: fonts.medium,
    color: t.text2,
  },
});
