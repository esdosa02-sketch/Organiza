import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CURRENT_SCHEMA_VERSION,
  createBackup,
  parseBackup,
  readStoredData,
  toStoredData,
  type BackupParseResult,
} from './dataSchema';
import type { AppData } from './models';

/** The key Organiza has always used. It must not change without a migration. */
export const STORAGE_KEY = '@organiza-app/personal-table-v2';
const PRE_MIGRATION_KEY = '@organiza-app/before-schema-v' + CURRENT_SCHEMA_VERSION;
const DAMAGED_COPY_KEY = '@organiza-app/damaged-copy';
const AUTO_BACKUP_PREFIX = '@organiza-app/auto-backup/';
const AUTO_BACKUPS_TO_KEEP = 5;

export type LoadOutcome =
  | { status: 'ready'; data: AppData; migratedFrom?: number; repairs: string[] }
  | { status: 'error'; reason: string; damagedText?: string; damagedCopySaved: boolean };

export async function loadAppData(): Promise<LoadOutcome> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      status: 'error',
      reason: 'No fue posible leer el almacenamiento de este teléfono. Tus datos no se modificaron.',
      damagedCopySaved: false,
    };
  }

  const result = readStoredData(raw);
  if (result.kind === 'empty') {
    return { status: 'ready', data: { projects: [], contacts: [] }, repairs: [] };
  }
  if (result.kind === 'error') {
    let damagedCopySaved = false;
    try {
      // Keep an untouched copy aside in case the person later starts over.
      await AsyncStorage.setItem(DAMAGED_COPY_KEY, raw as string);
      damagedCopySaved = true;
    } catch {
      // The original key stays untouched anyway; nothing is written over it.
    }
    return { status: 'error', reason: result.reason, damagedText: raw ?? undefined, damagedCopySaved };
  }

  if (result.fromVersion < CURRENT_SCHEMA_VERSION && raw !== null) {
    try {
      // The first copy is the original; running the migration again keeps it.
      if ((await AsyncStorage.getItem(PRE_MIGRATION_KEY)) === null) {
        await AsyncStorage.setItem(PRE_MIGRATION_KEY, raw);
      }
    } catch {
      // The migration does not remove anything, so it can continue without this copy.
    }
  }

  return {
    status: 'ready',
    data: result.data,
    migratedFrom: result.fromVersion < CURRENT_SCHEMA_VERSION ? result.fromVersion : undefined,
    repairs: result.repairs,
  };
}

export async function saveAppData(data: AppData) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toStoredData(data)));
}

/** Saves the current data on this phone before it is replaced. Throws if it cannot be saved. */
export async function createAutoBackup(data: AppData, appVersion?: string) {
  const now = new Date();
  await AsyncStorage.setItem(
    AUTO_BACKUP_PREFIX + now.toISOString(),
    JSON.stringify(createBackup(data, now, appVersion)),
  );

  try {
    const keys = (await autoBackupKeys()).slice(AUTO_BACKUPS_TO_KEEP);
    if (keys.length) {
      await AsyncStorage.multiRemove(keys);
    }
  } catch {
    // Old copies can be cleaned up next time.
  }
}

async function autoBackupKeys() {
  const keys = await AsyncStorage.getAllKeys();
  // ISO dates sort chronologically, so the newest copy comes first.
  return keys.filter((key) => key.startsWith(AUTO_BACKUP_PREFIX)).sort().reverse();
}

export async function loadLatestAutoBackup(): Promise<BackupParseResult | null> {
  const [latest] = await autoBackupKeys();
  if (!latest) {
    return null;
  }
  const text = await AsyncStorage.getItem(latest);
  return text === null ? null : parseBackup(text);
}
