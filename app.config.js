module.exports = ({ config }) => {
  const amapAndroidApiKey = process.env.AMAP_ANDROID_API_KEY?.trim();

  if (process.env.EAS_BUILD && !amapAndroidApiKey) {
    throw new Error('AMAP_ANDROID_API_KEY is required for Android builds that include the footprint map.');
  }

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []).filter((plugin) => !['expo-image', 'expo-gaode-map', 'expo-secure-store', '@react-native-community/datetimepicker', 'react-native-zip-archive'].includes(Array.isArray(plugin) ? plugin[0] : plugin)),
      'expo-image',
      'expo-secure-store',
      '@react-native-community/datetimepicker',
      'react-native-zip-archive',
      [
        'expo-gaode-map',
        {
          androidKey: amapAndroidApiKey ?? '',
          enableLocation: true,
          enableBackgroundLocation: false,
          locationDescription: '允许拾时在你主动选择时读取当前位置，用于记录这一刻发生的地点。',
        },
      ],
    ],
    extra: {
      ...config.extra,
      amapConfigured: Boolean(amapAndroidApiKey),
    },
  };
};
