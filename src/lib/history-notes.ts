/**
 * Hand-written one-sentence notes for /history, keyed by a revision's gist commit sha
 * (`history.json` → `revisions[].version`). The sha is the stable key: the daily refresh
 * rewrites `history.json` but never this file, and a revision without a note renders without one.
 */
import raw from '../../content/gist/history-notes.json';

export const NOTES: Readonly<Record<string, string>> = raw.notes;

/** The note for a revision's `version` sha, or `undefined` when none was written. */
export function noteFor(version: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(NOTES, version) ? NOTES[version] : undefined;
}
