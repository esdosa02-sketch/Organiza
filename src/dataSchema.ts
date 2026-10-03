import type { Action, AppData, Contact, Project, Status } from './models';

/**
 * Version of the saved data. Data written before versioning existed has no
 * `schemaVersion` and is treated as version 0.
 */
export const CURRENT_SCHEMA_VERSION = 1;
export const BACKUP_FORMAT = 'organiza-backup';

const DEFAULT_STATUS_COLOR = '#5A9BD5';
const MAX_BACKUP_CHARACTERS = 25 * 1024 * 1024;

export type StoredData = AppData & { schemaVersion: number };

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  app: { name: string; version?: string };
  data: AppData;
};

export type DataCounts = { projects: number; actions: number; contacts: number };

type Failure = { ok: false; reason: string };

export type SanitizeResult = { ok: true; data: AppData; repairs: string[] } | Failure;

export type StoredDataResult =
  | { kind: 'empty' }
  | { kind: 'ok'; data: AppData; fromVersion: number; repairs: string[] }
  | { kind: 'error'; reason: string };

export type BackupParseResult =
  | { ok: true; exportedAt: string; data: AppData; counts: DataCounts; repairs: string[] }
  | Failure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.filter(isText) : [];
}

/**
 * Checks the shape of the saved data and fills in only the fields that older
 * versions may not have written. Unknown fields are kept untouched, and the
 * result is stable: sanitizing already sanitized data changes nothing.
 */
export function sanitizeAppData(raw: unknown): SanitizeResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: 'El contenido no tiene el formato de datos de Organiza.' };
  }
  if (raw.projects !== undefined && !Array.isArray(raw.projects)) {
    return { ok: false, reason: 'La lista de casos está dañada.' };
  }
  if (raw.contacts !== undefined && !Array.isArray(raw.contacts)) {
    return { ok: false, reason: 'La lista de contactos está dañada.' };
  }

  const repairs: string[] = [];
  const projects: Project[] = [];
  const rawProjects: unknown[] = Array.isArray(raw.projects) ? raw.projects : [];

  for (const [projectIndex, rawProject] of rawProjects.entries()) {
    const position = 'El caso n.º ' + (projectIndex + 1);
    if (!isRecord(rawProject) || !hasText(rawProject.id) || !isText(rawProject.title)) {
      return { ok: false, reason: position + ' no tiene identificador o nombre.' };
    }
    if (!Array.isArray(rawProject.statuses) || !rawProject.statuses.length) {
      return { ok: false, reason: position + ' («' + rawProject.title + '») no tiene fases.' };
    }

    const statuses: Status[] = [];
    for (const rawStatus of rawProject.statuses) {
      if (!isRecord(rawStatus) || !hasText(rawStatus.id) || !isText(rawStatus.label)) {
        return { ok: false, reason: position + ' («' + rawProject.title + '») tiene una fase dañada.' };
      }
      if (!hasText(rawStatus.color)) {
        repairs.push('Se asignó un color a la fase «' + rawStatus.label + '».');
      }
      statuses.push({
        ...rawStatus,
        id: rawStatus.id,
        label: rawStatus.label,
        color: hasText(rawStatus.color) ? rawStatus.color : DEFAULT_STATUS_COLOR,
      });
    }

    const statusIds = new Set(statuses.map((status) => status.id));
    let completedStatusId = rawProject.completedStatusId;
    if (!isText(completedStatusId) || !statusIds.has(completedStatusId)) {
      completedStatusId = statuses[statuses.length - 1].id;
      repairs.push('Se eligió la fase final de «' + rawProject.title + '» como fase completada.');
    }

    if (rawProject.actions !== undefined && !Array.isArray(rawProject.actions)) {
      return { ok: false, reason: position + ' («' + rawProject.title + '») tiene acciones dañadas.' };
    }
    const actions: Action[] = [];
    const rawActions: unknown[] = Array.isArray(rawProject.actions) ? rawProject.actions : [];
    for (const rawAction of rawActions) {
      if (!isRecord(rawAction) || !hasText(rawAction.id) || !isText(rawAction.title)) {
        return { ok: false, reason: position + ' («' + rawProject.title + '») tiene una acción dañada.' };
      }
      if (!hasText(rawAction.statusId)) {
        repairs.push('La acción «' + rawAction.title + '» no tenía fase; se le asignó la primera.');
      }
      if (!hasText(rawAction.updatedAt)) {
        repairs.push('La acción «' + rawAction.title + '» no tenía fecha de actualización.');
      }
      actions.push({
        ...rawAction,
        id: rawAction.id,
        title: rawAction.title,
        statusId: hasText(rawAction.statusId) ? rawAction.statusId : statuses[0].id,
        reminder: rawAction.reminder === true,
        inviteeIds: textList(rawAction.inviteeIds),
        calendarInviteeEmails: textList(rawAction.calendarInviteeEmails),
        updatedAt: hasText(rawAction.updatedAt) ? rawAction.updatedAt : new Date(0).toISOString(),
      } as Action);
    }

    projects.push({
      ...rawProject,
      id: rawProject.id,
      title: rawProject.title,
      statuses,
      completedStatusId,
      useGoogleCalendar: rawProject.useGoogleCalendar === true,
      actions,
    } as Project);
  }

  const contacts: Contact[] = [];
  const rawContacts: unknown[] = Array.isArray(raw.contacts) ? raw.contacts : [];
  for (const rawContact of rawContacts) {
    // Same rule Organiza has always applied: a contact needs id, name and email.
    if (
      isRecord(rawContact) &&
      hasText(rawContact.id) &&
      hasText(rawContact.name) &&
      hasText(rawContact.email)
    ) {
      contacts.push({
        ...rawContact,
        id: rawContact.id,
        name: rawContact.name,
        email: rawContact.email,
        updatedAt: isText(rawContact.updatedAt) ? rawContact.updatedAt : new Date(0).toISOString(),
      } as Contact);
    } else {
      repairs.push('Se omitió un contacto incompleto.');
    }
  }

  return { ok: true, data: { projects, contacts }, repairs };
}

/**
 * Brings data saved by any known version up to the current one. Version 0
 * (no `schemaVersion`) has the same structure as version 1, so the migration
 * only validates it; future versions add their steps here.
 */
function migrateData(raw: Record<string, unknown>, fromVersion: number): SanitizeResult {
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason:
        'Los datos se guardaron con una versión más nueva de Organiza. Actualiza la app para abrirlos.',
    };
  }
  const { schemaVersion: _ignored, ...content } = raw;
  return sanitizeAppData(content);
}

function versionOf(raw: Record<string, unknown>): number | undefined {
  if (raw.schemaVersion === undefined) {
    return 0;
  }
  return Number.isInteger(raw.schemaVersion) && (raw.schemaVersion as number) >= 0
    ? (raw.schemaVersion as number)
    : undefined;
}

export function readStoredData(raw: string | null): StoredDataResult {
  if (raw === null) {
    return { kind: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'error', reason: 'Los datos guardados en este teléfono están dañados y no se pueden leer.' };
  }
  if (!isRecord(parsed)) {
    return { kind: 'error', reason: 'Los datos guardados en este teléfono no tienen un formato válido.' };
  }

  const fromVersion = versionOf(parsed);
  if (fromVersion === undefined) {
    return { kind: 'error', reason: 'La versión de los datos guardados no es válida.' };
  }
  const migrated = migrateData(parsed, fromVersion);
  if (!migrated.ok) {
    return { kind: 'error', reason: migrated.reason };
  }
  return { kind: 'ok', data: migrated.data, fromVersion, repairs: migrated.repairs };
}

export function toStoredData(data: AppData): StoredData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, projects: data.projects, contacts: data.contacts };
}

export function countData(data: AppData): DataCounts {
  return {
    projects: data.projects.length,
    actions: data.projects.reduce((total, project) => total + project.actions.length, 0),
    contacts: data.contacts.length,
  };
}

/** Builds the exported file. Organiza does not keep passwords or tokens, so none are included. */
export function createBackup(data: AppData, exportedAt: Date, appVersion?: string): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    app: { name: 'Organiza', version: appVersion },
    data: { projects: data.projects, contacts: data.contacts },
  };
}

export function parseBackup(text: string): BackupParseResult {
  if (text.length > MAX_BACKUP_CHARACTERS) {
    return { ok: false, reason: 'El archivo es demasiado grande para ser un respaldo de Organiza.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, reason: 'El archivo no es un JSON válido.' };
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT) {
    return { ok: false, reason: 'El archivo no es un respaldo de Organiza.' };
  }

  const fromVersion = versionOf(parsed);
  if (fromVersion === undefined || fromVersion < 1) {
    return { ok: false, reason: 'La versión del respaldo no es válida.' };
  }
  if (!isRecord(parsed.data)) {
    return { ok: false, reason: 'El respaldo no contiene datos.' };
  }
  const exportedAt = hasText(parsed.exportedAt) && !Number.isNaN(Date.parse(parsed.exportedAt))
    ? parsed.exportedAt
    : undefined;
  if (!exportedAt) {
    return { ok: false, reason: 'El respaldo no indica una fecha de exportación válida.' };
  }

  const migrated = migrateData({ ...parsed.data, schemaVersion: fromVersion }, fromVersion);
  if (!migrated.ok) {
    return { ok: false, reason: migrated.reason };
  }
  return {
    ok: true,
    exportedAt,
    data: migrated.data,
    counts: countData(migrated.data),
    repairs: migrated.repairs,
  };
}
