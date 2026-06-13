const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Expo config plugin that removes expo-audio's background media-playback
 * service from the final AndroidManifest.xml.
 *
 * Why: expo-audio declares two foreground services in its AAR manifest —
 *   - AudioRecordingService  (foregroundServiceType="microphone")   ← recording
 *   - AudioControlsService   (foregroundServiceType="mediaPlayback") ← playback
 * AudioControlsService rides on androidx.media3's MediaSessionService, whose
 * media-button / session lifecycle gives Play's static analyzer a path to
 * "start a restricted foreground service from a BOOT_COMPLETED context", which
 * crashes on Android 15+ (targetSdk 36). Play Console flags this under
 * "Restricted foreground service types".
 *
 * Finni uses expo-audio for RECORDING ONLY (short voice clips while the app is
 * foregrounded) and never plays audio, so AudioControlsService is dead weight.
 * We instruct the manifest merger to remove it (tools:node="remove"), which
 * eliminates the flagged mediaPlayback path. The microphone recording service
 * stays — it is started from a user tap while the app is in the foreground,
 * which remains allowed. Pairs with strip-media-permissions (which already
 * drops FOREGROUND_SERVICE_MEDIA_PLAYBACK).
 *
 * Also drops the unused RECEIVE_BOOT_COMPLETED permission and any BOOT_COMPLETED
 * receiver present in the app manifest (Finni uses push notifications only — no
 * local scheduled notifications — so nothing legitimately needs boot-completion).
 */
const TOOLS_NS = 'http://schemas.android.com/tools';
const MEDIA_PLAYBACK_SERVICE = 'expo.modules.audio.service.AudioControlsService';
const BOOT_PERMISSION = 'android.permission.RECEIVE_BOOT_COMPLETED';
const BOOT_ACTION = 'android.intent.action.BOOT_COMPLETED';

function receiverHandlesBoot(receiver) {
  const filters = receiver['intent-filter'] ?? [];
  return filters.some((filter) =>
    (filter.action ?? []).some((a) => a.$?.['android:name'] === BOOT_ACTION),
  );
}

function stripAudioBackgroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Declare the tools namespace so tools:node="remove" is honored by the merger.
    manifest.$ = manifest.$ ?? {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? TOOLS_NS;

    // Drop the unused RECEIVE_BOOT_COMPLETED permission.
    const perms = manifest['uses-permission'] ?? [];
    manifest['uses-permission'] = perms.filter(
      (p) => p.$?.['android:name'] !== BOOT_PERMISSION,
    );

    const app = manifest.application?.[0];
    if (!app) return cfg;

    // Remove any BOOT_COMPLETED receiver present in the app manifest.
    if (app.receiver) {
      app.receiver = app.receiver.filter((r) => !receiverHandlesBoot(r));
    }

    // Instruct the manifest merger to remove expo-audio's mediaPlayback service.
    app.service = app.service ?? [];
    const alreadyRemoved = app.service.some(
      (s) =>
        s.$?.['android:name'] === MEDIA_PLAYBACK_SERVICE &&
        s.$?.['tools:node'] === 'remove',
    );
    if (!alreadyRemoved) {
      app.service.push({
        $: { 'android:name': MEDIA_PLAYBACK_SERVICE, 'tools:node': 'remove' },
      });
    }

    return cfg;
  });
}

module.exports = stripAudioBackgroundService;
