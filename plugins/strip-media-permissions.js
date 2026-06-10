const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Expo config plugin that forcefully removes READ_MEDIA_IMAGES,
 * READ_MEDIA_VIDEO, READ_EXTERNAL_STORAGE, and WRITE_EXTERNAL_STORAGE
 * from the final AndroidManifest.xml.
 *
 * Belt-and-suspenders guard in case any transitive dependency re-adds these
 * via its AAR manifest after expo-av and expo-file-system were removed.
 */
const PERMISSIONS_TO_STRIP = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  // expo-audio declares this for background playback; Finni only records short
  // voice clips for transcription and never plays audio in the background.
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
];

function stripMediaPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const existing = manifest['uses-permission'] ?? [];
    manifest['uses-permission'] = existing.filter((perm) => {
      const name = perm.$?.['android:name'];
      return !PERMISSIONS_TO_STRIP.includes(name);
    });
    return cfg;
  });
}

module.exports = stripMediaPermissions;
