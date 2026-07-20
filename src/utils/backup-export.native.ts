import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportBackupFile(contents: string, filename: string) {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  if (!await Sharing.isAvailableAsync()) throw new Error('sharing-unavailable');
  await Sharing.shareAsync(file.uri, { dialogTitle: '导出拾时记录', mimeType: 'application/json', UTI: 'public.json' });
}
