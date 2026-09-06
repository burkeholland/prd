import { describe, expect, it, vi } from 'vitest';
import {
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  PRD_EDITOR_BACKUP_MAX_BYTES,
  readPrdEditorBackup,
} from '../../src/lib/prd-editor-state';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';

const backup = () => {
  const blank = createBlankPrdEditorState();
  const state = { ...blank, values: { ...blank.values } };
  state.title = ' \tCaf\u00e9 / \u65e5\u672c\u8a9e \ud83c\udf31 \n ';
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    state.values[section.id] = ` \t${index}: e\u0301 \u00e9 \ud83c\udf31\r\n\n <p>plain text</p> \r `;
  }
  return createPrdEditorDraftPayload(state, new Date('2026-09-01T00:00:00.000Z'));
};

const file = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });

describe('portable draft backups', () => {
  it('reads all 13 strings exactly without trimming, newline conversion, or Unicode normalization', async () => {
    const payload = backup();
    expect(await readPrdEditorBackup(file(payload))).toEqual({ status: 'valid', payload });
  });

  it('keeps the parser policy of ignoring unknown keys', async () => {
    const payload = backup();
    const input = {
      ...payload,
      extra: true,
      state: { ...payload.state, extra: true, values: { ...payload.state.values, extra: 123 } },
    };
    expect(await readPrdEditorBackup(file(input))).toEqual({ status: 'valid', payload });
  });

  it('rejects every missing or non-string canonical field', async () => {
    for (const section of PRD_TEMPLATE_SECTIONS) {
      for (const invalid of [undefined, null, 1, true, {}, []]) {
        const payload = backup();
        const input = {
          ...payload,
          state: { ...payload.state, values: { ...payload.state.values, [section.id]: invalid } },
        };
        expect(await readPrdEditorBackup(file(input))).toEqual({
          status: 'corrupt', reason: 'fields',
        });
      }
    }
    for (const title of [undefined, null, 1, true, {}, []]) {
      const payload = backup();
      expect(await readPrdEditorBackup(file({
        ...payload, state: { ...payload.state, title },
      }))).toEqual({ status: 'corrupt', reason: 'fields' });
    }
  });

  it('distinguishes malformed JSON, damaged payloads, and unsupported versions', async () => {
    expect(await readPrdEditorBackup(new Blob(['{broken']))).toEqual({
      status: 'corrupt', reason: 'json',
    });
    for (const input of [null, [], {}, { ...backup(), savedAt: 'yesterday' }]) {
      expect(await readPrdEditorBackup(file(input))).toEqual({
        status: 'corrupt', reason: 'payload',
      });
    }
    expect(await readPrdEditorBackup(file({ ...backup(), version: 2 }))).toEqual({
      status: 'unsupported-version', version: 2,
    });
  });

  it('allows exactly 5 MiB and rejects larger files before attempting a read', async () => {
    expect(PRD_EDITOR_BACKUP_MAX_BYTES).toBe(5_242_880);
    const payload = backup();
    const raw = JSON.stringify(payload);
    const padding = PRD_EDITOR_BACKUP_MAX_BYTES - new Blob([raw]).size;
    const atLimit = new Blob([raw, ' '.repeat(padding)]);
    expect(atLimit.size).toBe(PRD_EDITOR_BACKUP_MAX_BYTES);
    expect(await readPrdEditorBackup(atLimit)).toEqual({ status: 'valid', payload });
    const text = vi.fn().mockRejectedValue(new Error('Must not read'));
    expect(await readPrdEditorBackup({ size: atLimit.size + 1, text })).toEqual({
      status: 'too-large',
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('reports a failed file read without exposing file content or throwing', async () => {
    expect(await readPrdEditorBackup({
      size: 100,
      text: async () => { throw new DOMException('Unreadable file', 'NotReadableError'); },
    })).toEqual({ status: 'unreadable' });
  });
});
