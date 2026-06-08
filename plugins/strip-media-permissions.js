const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Expo config plugin that forcefully removes READ_MEDIA_IMAGES,
 * READ_MEDIA_VIDEO, READ_EXTERNAL_STORAGE, and WRITE_EXTERNAL_STORAGE
 * from the final AndroidManifest.xml.
 *
 * These get auto-added by expo-file-system and expo-image-picker, and on
 * SDK 33+ the build toolchain can upgrade READ_EXTERNAL_STORAGE into
 * READ_MEDIA_* variants — which bypasses Expo's blockedPermissions list.
 */
const PERMISSIONS_TO_STRIP = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
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
