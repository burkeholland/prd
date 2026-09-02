import { describe, expect, it } from 'vitest';
import {
  clearPrdEditorDraft,
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  loadPrdEditorDraft,
  parsePrdEditorDraft,
  PRD_EDITOR_PAYLOAD_VERSION,
  PRD_EDITOR_STORAGE_KEY,
  savePrdEditorDraft,
  type PrdEditorStorage,
} from '../../src/lib/prd-editor-state';
import {
  PRD_TEMPLATE_SECTIONS,
  type PrdTemplateSectionId,
} from '../../src/lib/prd-template';

const NOW = new Date('2026-09-02T18:00:00.000Z');

const filledState = () => ({
  title: 'Browser draft',
  values: Object.fromEntries(
    PRD_TEMPLATE_SECTIONS.map((section, index) => [
      section.id,
      `Section ${index + 1}`,
    ]),
  ) as Record<PrdTemplateSectionId, string>,
});

const memoryStorage = (): PrdEditorStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
};

describe('PRD editor state', () => {
  it('creates one blank title and all 12 canonical section values', () => {
    const state = createBlankPrdEditorState();

    expect(state.title).toBe('');
    expect(Object.keys(state.values)).toEqual(
      PRD_TEMPLATE_SECTIONS.map((section) => section.id),
    );
    expect(Object.values(state.values)).toEqual(Array(12).fill(''));
  });

  it('round-trips all 13 strings through the versioned payload and ignores unknown keys', () => {
    const original = createPrdEditorDraftPayload(filledState(), NOW);
    const raw = JSON.stringify({
      ...original,
      futureTopLevelKey: true,
      state: {
        ...original.state,
        futureStateKey: 'ignored',
        values: { ...original.state.values, futureSection: 'ignored' },
      },
    });

    expect(parsePrdEditorDraft(raw)).toEqual({
      status: 'valid',
      payload: original,
    });
  });

  it('reports corrupt JSON and unsupported numeric versions without throwing', () => {
    expect(parsePrdEditorDraft('{not json')).toEqual({ status: 'corrupt' });
    expect(
      parsePrdEditorDraft(
        JSON.stringify({
          ...createPrdEditorDraftPayload(filledState(), NOW),
          version: PRD_EDITOR_PAYLOAD_VERSION + 1,
        }),
      ),
    ).toEqual({ status: 'unsupported-version', version: 2 });
  });

  it('rejects missing fields and non-string values rather than coercing them', () => {
    const payload = createPrdEditorDraftPayload(filledState(), NOW);
    const missingValues = { ...payload.state.values } as Partial<
      Record<PrdTemplateSectionId, string>
    >;
    delete missingValues['summary-outcome'];

    for (const invalid of [
      { ...payload, savedAt: NOW.getTime() },
      { ...payload, state: { ...payload.state, title: 17 } },
      { ...payload, state: { ...payload.state, values: missingValues } },
      {
        ...payload,
        state: {
          ...payload.state,
          values: { ...payload.state.values, 'summary-outcome': false },
        },
      },
    ]) {
      expect(parsePrdEditorDraft(JSON.stringify(invalid))).toEqual({
        status: 'corrupt',
      });
    }
  });
});

describe('PRD editor storage', () => {
  it('writes and reads a complete payload under the stable storage key', () => {
    const storage = memoryStorage();
    const state = filledState();

    expect(savePrdEditorDraft(storage, state, NOW)).toEqual({
      status: 'saved',
      payload: createPrdEditorDraftPayload(state, NOW),
    });
    expect(storage.values.has(PRD_EDITOR_STORAGE_KEY)).toBe(true);
    expect(loadPrdEditorDraft(storage)).toEqual({
      status: 'valid',
      payload: createPrdEditorDraftPayload(state, NOW),
    });
  });

  it('distinguishes an empty store and clears a saved draft', () => {
    const storage = memoryStorage();

    expect(loadPrdEditorDraft(storage)).toEqual({ status: 'empty' });
    savePrdEditorDraft(storage, filledState(), NOW);
    expect(clearPrdEditorDraft(storage)).toEqual({ status: 'cleared' });
    expect(loadPrdEditorDraft(storage)).toEqual({ status: 'empty' });
  });

  it('surfaces read, write, and removal failures', () => {
    const error = new DOMException('Storage unavailable', 'QuotaExceededError');
    const failingStorage: PrdEditorStorage = {
      getItem: () => {
        throw error;
      },
      setItem: () => {
        throw error;
      },
      removeItem: () => {
        throw error;
      },
    };

    expect(loadPrdEditorDraft(failingStorage)).toEqual({
      status: 'storage-error',
      error,
    });
    expect(savePrdEditorDraft(failingStorage, filledState(), NOW)).toEqual({
      status: 'storage-error',
      error,
    });
    expect(clearPrdEditorDraft(failingStorage)).toEqual({
      status: 'storage-error',
      error,
    });
  });
});
