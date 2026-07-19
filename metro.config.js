const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite uses a WebAssembly bundle on web. Metro does not include .wasm
// in its default asset extensions, so it must be registered explicitly.
config.resolver.assetExts.push('wasm');

// SharedArrayBuffer, used by expo-sqlite on web, requires cross-origin
// isolation headers during local development.
config.server.enhanceMiddleware = (middleware) => (request, response, next) => {
  response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  return middleware(request, response, next);
};

module.exports = config;
