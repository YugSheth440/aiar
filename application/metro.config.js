// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Ensure platform-specific extensions are resolved correctly.
// Metro will prefer .web.tsx over .tsx when bundling for web.
config.resolver.platforms = ['web', 'android', 'ios', 'native'];

module.exports = config;
