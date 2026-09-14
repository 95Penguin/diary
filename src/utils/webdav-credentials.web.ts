export async function getWebDavPassword() { return ''; }
export async function saveWebDavPassword(_password: string) { throw new Error('webdav-native-only'); }
export async function clearWebDavPassword() { /* Nothing is stored on web. */ }
