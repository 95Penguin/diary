export async function shareCardFile(uri: string) {
  const anchor = document.createElement('a');
  anchor.href = uri;
  anchor.download = `拾时分享卡片-${Date.now()}.png`;
  anchor.click();
}

export async function shareCardFiles(uris: string[]) {
  for (const uri of uris) await shareCardFile(uri);
}
