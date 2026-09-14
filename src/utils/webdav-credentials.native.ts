import * as SecureStore from 'expo-secure-store';

const PASSWORD_KEY = 'shishi-webdav-password';

export async function getWebDavPassword() {
  return (await SecureStore.getItemAsync(PASSWORD_KEY)) ?? '';
}

export async function saveWebDavPassword(password: string) {
  if (password) await SecureStore.setItemAsync(PASSWORD_KEY, password);
  else await SecureStore.deleteItemAsync(PASSWORD_KEY);
}

export async function clearWebDavPassword() {
  await SecureStore.deleteItemAsync(PASSWORD_KEY);
}
