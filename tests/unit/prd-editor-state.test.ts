import { describe, expect, it } from 'vitest';
import {
  checkPrdEditorDraft,
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
    expect(parsePrdEditorDraft('{not json')).toEqual({ status: 'corrupt', reason: 'json' });
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
      expect(parsePrdEditorDraft(JSON.stringify(invalid))).toMatchObject({
        status: 'corrupt',
      });
    }
  });
});

describe('PRD editor storage', () => {
  it('writes and reads a complete payload under the stable storage key', () => {
    const storage = memoryStorage();
    const state = filledState();

    const raw = JSON.stringify(createPrdEditorDraftPayload(state, NOW));
    expect(savePrdEditorDraft(storage, state, null, NOW)).toEqual({
      status: 'saved',
      payload: createPrdEditorDraftPayload(state, NOW),
      raw,
    });
    expect(storage.values.has(PRD_EDITOR_STORAGE_KEY)).toBe(true);
    expect(loadPrdEditorDraft(storage)).toEqual({
      status: 'valid',
      payload: createPrdEditorDraftPayload(state, NOW),
      raw,
    });
  });

  it('distinguishes an empty store and clears a saved draft', () => {
    const storage = memoryStorage();

    expect(loadPrdEditorDraft(storage)).toEqual({ status: 'empty', raw: null });
    savePrdEditorDraft(storage, filledState(), null, NOW);
    expect(clearPrdEditorDraft(storage, storage.getItem(PRD_EDITOR_STORAGE_KEY))).toEqual({ status: 'cleared' });
    expect(loadPrdEditorDraft(storage)).toEqual({ status: 'empty', raw: null });
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
    expect(savePrdEditorDraft(failingStorage, filledState(), null, NOW)).toEqual({
      status: 'storage-error',
      error,
    });
    expect(clearPrdEditorDraft(failingStorage, null)).toEqual({
      status: 'storage-error',
      error,
    });
    failingStorage.getItem = () => null;
    expect(savePrdEditorDraft(failingStorage, filledState(), null, NOW)).toEqual({
      status: 'storage-error', error,
    });
    expect(clearPrdEditorDraft(failingStorage, null)).toEqual({
      status: 'storage-error', error,
    });
  });
});

describe('PRD saved-value conflict guards', () => {
  it('retains exact restored bytes, including unrecognized fields and malformed data', () => {
    const storage = memoryStorage();
    for (const raw of [
      JSON.stringify({ ...createPrdEditorDraftPayload(filledState(), NOW), extra: 'keep raw baseline' }, null, 2),
      '{broken',
      JSON.stringify({ version: 99 }),
    ]) {
      storage.setItem(PRD_EDITOR_STORAGE_KEY, raw);
      expect(loadPrdEditorDraft(storage)).toHaveProperty('raw', raw);
      expect(checkPrdEditorDraft(storage, raw)).toEqual({ status: 'unchanged', raw });
    }
  });

  it.each([null, '{broken', JSON.stringify({ version: 99 })])(
    'blocks both mutations when another tab changes the stored value to %s',
    (raw) => {
      const storage = memoryStorage();
      const saved = savePrdEditorDraft(storage, filledState(), null, NOW);
      expect(saved.status).toBe('saved');
      const baseline = storage.getItem(PRD_EDITOR_STORAGE_KEY);
      if (raw === null) storage.removeItem(PRD_EDITOR_STORAGE_KEY);
      else storage.setItem(PRD_EDITOR_STORAGE_KEY, raw);
      expect(savePrdEditorDraft(storage, filledState(), baseline, NOW)).toEqual({ status: 'conflict', raw });
      expect(clearPrdEditorDraft(storage, baseline)).toEqual({ status: 'conflict', raw });
      expect(storage.getItem(PRD_EDITOR_STORAGE_KEY)).toBe(raw);
    },
  );

  it('does not mistake an unreadable baseline for an empty store', () => {
    const storage = memoryStorage();
    expect(savePrdEditorDraft(storage, filledState(), undefined, NOW)).toEqual({ status: 'conflict', raw: null });
    expect(clearPrdEditorDraft(storage, undefined)).toEqual({ status: 'conflict', raw: null });
    expect(storage.values.size).toBe(0);
  });

  it('compares bytes even when timestamps and all parsed fields match', () => {
    const storage = memoryStorage();
    const payload = createPrdEditorDraftPayload(filledState(), NOW);
    const baseline = JSON.stringify(payload);
    const raw = JSON.stringify(payload, null, 2);
    storage.setItem(PRD_EDITOR_STORAGE_KEY, raw);
    expect(savePrdEditorDraft(storage, filledState(), baseline, NOW)).toEqual({ status: 'conflict', raw });
    expect(savePrdEditorDraft(storage, filledState(), raw, NOW)).toMatchObject({ status: 'saved' });
  });

  it('never calls a mutation when its preflight read fails', () => {
    let mutations = 0;
    const error = new DOMException('Cannot read', 'SecurityError');
    const storage: PrdEditorStorage = {
      getItem() { throw error; },
      setItem() { mutations += 1; },
      removeItem() { mutations += 1; },
    };
    expect(checkPrdEditorDraft(storage, null)).toEqual({ status: 'storage-error', error });
    expect(savePrdEditorDraft(storage, filledState(), null, NOW)).toEqual({ status: 'storage-error', error });
    expect(clearPrdEditorDraft(storage, null)).toEqual({ status: 'storage-error', error });
    expect(mutations).toBe(0);
  });
});
