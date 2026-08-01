import * as Sharing from 'expo-sharing';

export async function shareCardFile(uri: string) {
  if (!await Sharing.isAvailableAsync()) throw new Error('sharing-unavailable');
  await Sharing.shareAsync(uri, { dialogTitle: '分享这一刻', mimeType: 'image/png', UTI: 'public.png' });
}
