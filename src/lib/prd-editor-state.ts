import {
  createBlankPrdTemplateState,
  PRD_TEMPLATE_SECTIONS,
  type PrdTemplateSectionId,
  type PrdTemplateState,
} from './prd-template';

export const PRD_EDITOR_STORAGE_KEY = 'prd-guide:editor-draft';
export const PRD_EDITOR_PAYLOAD_VERSION = 1 as const;

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
  | { readonly status: 'corrupt' }
  | { readonly status: 'unsupported-version'; readonly version: number };

export type LoadedPrdEditorDraft =
  | ParsedPrdEditorDraft
  | { readonly status: 'empty' }
  | { readonly status: 'storage-error'; readonly error: unknown };

export type SavedPrdEditorDraft =
  | { readonly status: 'saved'; readonly payload: PrdEditorDraftPayload }
  | { readonly status: 'storage-error'; readonly error: unknown };

export type ClearedPrdEditorDraft =
  | { readonly status: 'cleared' }
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
    return { status: 'corrupt' };
  }

  if (!isRecord(value)) return { status: 'corrupt' };
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
    !isRecord(value.state) ||
    typeof value.state.title !== 'string' ||
    !isRecord(value.state.values)
  ) {
    return { status: 'corrupt' };
  }

  const sectionValues: Partial<Record<PrdTemplateSectionId, string>> = {};
  for (const section of PRD_TEMPLATE_SECTIONS) {
    const sectionValue = value.state.values[section.id];
    if (typeof sectionValue !== 'string') return { status: 'corrupt' };
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

export const loadPrdEditorDraft = (
  storage: PrdEditorStorage,
): LoadedPrdEditorDraft => {
  let raw: string | null;
  try {
    raw = storage.getItem(PRD_EDITOR_STORAGE_KEY);
  } catch (error) {
    return { status: 'storage-error', error };
  }

  return raw === null ? { status: 'empty' } : parsePrdEditorDraft(raw);
};

export const savePrdEditorDraft = (
  storage: PrdEditorStorage,
  state: PrdEditorState,
  now: Date = new Date(),
): SavedPrdEditorDraft => {
  const payload = createPrdEditorDraftPayload(state, now);
  try {
    storage.setItem(PRD_EDITOR_STORAGE_KEY, JSON.stringify(payload));
    return { status: 'saved', payload };
  } catch (error) {
    return { status: 'storage-error', error };
  }
};

export const clearPrdEditorDraft = (
  storage: PrdEditorStorage,
): ClearedPrdEditorDraft => {
  try {
    storage.removeItem(PRD_EDITOR_STORAGE_KEY);
    return { status: 'cleared' };
  } catch (error) {
    return { status: 'storage-error', error };
  }
};
