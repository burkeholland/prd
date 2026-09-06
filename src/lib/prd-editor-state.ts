import {
  createBlankPrdTemplateState,
  PRD_TEMPLATE_SECTIONS,
  type PrdTemplateSectionId,
  type PrdTemplateState,
} from './prd-template';

export const PRD_EDITOR_STORAGE_KEY = 'prd-guide:editor-draft';
export const PRD_EDITOR_PAYLOAD_VERSION = 1 as const;
export const PRD_EDITOR_BACKUP_MAX_BYTES = 5 * 1024 * 1024;

export type PrdEditorState = PrdTemplateState;

export interface PrdEditorDraftPayload {
  readonly version: typeof PRD_EDITOR_PAYLOAD_VERSION;
  readonly savedAt: string;
  readonly state: PrdEditorState;
}

export interface PrdEditorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ParsedPrdEditorDraft =
  | { readonly status: 'valid'; readonly payload: PrdEditorDraftPayload }
  | { readonly status: 'corrupt'; readonly reason: 'json' | 'payload' | 'fields' }
  | { readonly status: 'unsupported-version'; readonly version: number };

export type ReadPrdEditorBackup =
  | ParsedPrdEditorDraft
  | { readonly status: 'too-large' }
  | { readonly status: 'unreadable' };

export type LoadedPrdEditorDraft =
  | ((ParsedPrdEditorDraft | { readonly status: 'empty' }) & { readonly raw: string | null })
  | { readonly status: 'storage-error'; readonly error: unknown };

export type CheckedPrdEditorDraft =
  | { readonly status: 'unchanged'; readonly raw: string | null }
  | { readonly status: 'conflict'; readonly raw: string | null }
  | { readonly status: 'storage-error'; readonly error: unknown };

export type SavedPrdEditorDraft =
  | { readonly status: 'saved'; readonly payload: PrdEditorDraftPayload; readonly raw: string }
  | { readonly status: 'conflict'; readonly raw: string | null }
  | { readonly status: 'storage-error'; readonly error: unknown };

export type ClearedPrdEditorDraft =
  | { readonly status: 'cleared' }
  | { readonly status: 'conflict'; readonly raw: string | null }
  | { readonly status: 'storage-error'; readonly error: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
};

export const createBlankPrdEditorState = (): PrdEditorState =>
  createBlankPrdTemplateState('');

export const createPrdEditorDraftPayload = (
  state: PrdEditorState,
  now: Date = new Date(),
): PrdEditorDraftPayload => ({
  version: PRD_EDITOR_PAYLOAD_VERSION,
  savedAt: now.toISOString(),
  state,
});

export const parsePrdEditorDraft = (raw: string): ParsedPrdEditorDraft => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: 'json' };
  }

  if (!isRecord(value)) return { status: 'corrupt', reason: 'payload' };
  if (
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version !== PRD_EDITOR_PAYLOAD_VERSION
  ) {
    return { status: 'unsupported-version', version: value.version };
  }
  if (
    value.version !== PRD_EDITOR_PAYLOAD_VERSION ||
    !isIsoTimestamp(value.savedAt) ||
    !isRecord(value.state)
  ) {
    return { status: 'corrupt', reason: 'payload' };
  }
  if (
    typeof value.state.title !== 'string' ||
    !isRecord(value.state.values)
  ) {
    return { status: 'corrupt', reason: 'fields' };
  }

  const sectionValues: Partial<Record<PrdTemplateSectionId, string>> = {};
  for (const section of PRD_TEMPLATE_SECTIONS) {
    const sectionValue = value.state.values[section.id];
    if (typeof sectionValue !== 'string') return { status: 'corrupt', reason: 'fields' };
    sectionValues[section.id] = sectionValue;
  }

  return {
    status: 'valid',
    payload: {
      version: PRD_EDITOR_PAYLOAD_VERSION,
      savedAt: value.savedAt,
      state: {
        title: value.state.title,
        values: sectionValues as Record<PrdTemplateSectionId, string>,
      },
    },
  };
};

export const readPrdEditorBackup = async (
  file: Pick<File, 'size' | 'text'>,
): Promise<ReadPrdEditorBackup> => {
  if (file.size > PRD_EDITOR_BACKUP_MAX_BYTES) return { status: 'too-large' };

  let raw: string;
  try {
    raw = await file.text();
  } catch {
    return { status: 'unreadable' };
  }
  return parsePrdEditorDraft(raw);
};

export const loadPrdEditorDraft = (
  storage: PrdEditorStorage,
): LoadedPrdEditorDraft => {
  let raw: string | null;
  try {
    raw = storage.getItem(PRD_EDITOR_STORAGE_KEY);
  } catch (error) {
    return { status: 'storage-error', error };
  }

  return raw === null ? { status: 'empty', raw } : { ...parsePrdEditorDraft(raw), raw };
};

// Compare exact stored bytes, not timestamps or parsed fields. Undefined means
// this tab has never successfully read storage, not that storage was empty.
export const checkPrdEditorDraft = (
  storage: PrdEditorStorage,
  expectedRaw: string | null | undefined,
): CheckedPrdEditorDraft => {
  try {
    const raw = storage.getItem(PRD_EDITOR_STORAGE_KEY);
    return { status: raw === expectedRaw ? 'unchanged' : 'conflict', raw };
  } catch (error) {
    return { status: 'storage-error', error };
  }
};

export const savePrdEditorDraft = (
  storage: PrdEditorStorage,
  state: PrdEditorState,
  expectedRaw: string | null | undefined,
  now: Date = new Date(),
): SavedPrdEditorDraft => {
  const checked = checkPrdEditorDraft(storage, expectedRaw);
  if (checked.status !== 'unchanged') return checked;
  const payload = createPrdEditorDraftPayload(state, now);
  const raw = JSON.stringify(payload);
  try {
    storage.setItem(PRD_EDITOR_STORAGE_KEY, raw);
    return { status: 'saved', payload, raw };
  } catch (error) {
    return { status: 'storage-error', error };
  }
};

export const clearPrdEditorDraft = (
  storage: PrdEditorStorage,
  expectedRaw: string | null | undefined,
): ClearedPrdEditorDraft => {
  const checked = checkPrdEditorDraft(storage, expectedRaw);
  if (checked.status !== 'unchanged') return checked;
  try {
    storage.removeItem(PRD_EDITOR_STORAGE_KEY);
    return { status: 'cleared' };
  } catch (error) {
    return { status: 'storage-error', error };
  }
};
