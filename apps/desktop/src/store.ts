import { load } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';

let storeInstance: any = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load('settings.json');
  }
  return storeInstance;
}

export async function setToken(token: string) {
  try {
    await invoke('set_keyring_token', { token });
  } catch (err) {
    console.error('Failed to set token in keyring', err);
  }
}

export async function getToken(): Promise<string | null> {
  try {
    const token = await invoke<string>('get_keyring_token');
    return token || null;
  } catch (err) {
    return null;
  }
}

export async function clearToken() {
  try {
    await invoke('delete_keyring_token');
  } catch (err) {
    console.error('Failed to clear token', err);
  }
}

export async function setApiBase(apiBase: string) {
  const store = await getStore();
  await store.set('apiBase', apiBase.replace(/\/+$/, ''));
  await store.save();
}

export async function getApiBase(): Promise<string> {
  const store = await getStore();
  return (await store.get('apiBase')) || 'http://localhost:3000';
}
