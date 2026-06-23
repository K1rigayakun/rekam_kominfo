import { load } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';

let storeInstance: any = null;
const configuredApiBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;

export const DEFAULT_API_BASE = stripApiSuffix(configuredApiBase || 'http://localhost:3000');

function stripApiSuffix(value: string) {
  return value.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
}

export function normalizeApiBase(apiBase: string) {
  return stripApiSuffix(apiBase) || DEFAULT_API_BASE;
}

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
  await store.set('apiBase', normalizeApiBase(apiBase));
  await store.save();
}

export async function getApiBase(): Promise<string> {
  const store = await getStore();
  const saved = await store.get('apiBase');
  return typeof saved === 'string' && saved.trim() ? normalizeApiBase(saved) : DEFAULT_API_BASE;
}
