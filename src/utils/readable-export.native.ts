import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function shareReadableExport(contents: string, filename: string, mimeType: string) {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  if (!await Sharing.isAvailableAsync()) throw new Error('sharing-unavailable');
  await Sharing.shareAsync(file.uri, {
    dialogTitle: '导出可阅读日记',
    mimeType,
    UTI: mimeType === 'text/html' ? 'public.html' : 'net.daringfireball.markdown',
  });
}
