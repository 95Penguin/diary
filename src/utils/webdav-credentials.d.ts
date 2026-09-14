export function getWebDavPassword(): Promise<string>;
export function saveWebDavPassword(password: string): Promise<void>;
export function clearWebDavPassword(): Promise<void>;
