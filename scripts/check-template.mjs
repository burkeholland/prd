// Checks that content/template.md (annotated page) and public/prd-template.md
// (clean download) describe the same 14-section skeleton.
// Run: node --test scripts/check-template.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SECTION_COUNT = 14;
const LABELS = ['**Write:**', '**Example:**', '**Template:**'];
const OLD_LABELS = ['**Write here:**', '**Example from the sample:**', '**Skeleton:**'];
const PLACEHOLDER = /\{[^{}\n]+\}/g;

const read = (rel) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const annotated = read('content/template.md');
const clean = read('public/prd-template.md');

const isFence = (line) => /^(`{3,}|~{3,})/.test(line);

/** Splits markdown into `## ` sections, ignoring headings inside fenced code blocks. */
function h2Sections(markdown) {
  const lines = markdown.split('\n');
  const sections = [];
  let inFence = false;
  let current = null;
  for (const line of lines) {
    if (isFence(line)) inFence = !inFence;
    const m = !inFence && /^## (.+?)\s*$/.exec(line);
    if (m) {
      current = { title: m[1], body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return sections.map((s) => ({ title: s.title, body: s.body.join('\n') }));
}

/** Text inside the first ```md fence of a section body, or null. */
function mdBlock(body) {
  const m = /^```md\n([\s\S]*?)\n```$/m.exec(body);
  return m ? m[1] : null;
}

/** Position of each label in the body (first occurrence at line start). */
function labelIndex(body, label) {
  const re = new RegExp(`^${label.replace(/[*]/g, '\\*')}`, 'm');
  return body.search(re);
}

const annotatedBody = annotated.replace(/^---\n[\s\S]*?\n---\n/, '');
const annotatedSections = h2Sections(annotatedBody);
const cleanSections = h2Sections(clean);
const firstH2 = annotatedBody.search(/^## /m);
const opening = annotatedBody.slice(0, firstH2);

test(`annotated page has exactly ${SECTION_COUNT} section h2s`, () => {
  assert.equal(annotatedSections.length, SECTION_COUNT, annotatedSections.map((s) => s.title).join(' | '));
});

test('each annotated section has the three labels, once each, in order', () => {
  for (const s of annotatedSections) {
    const positions = LABELS.map((label) => labelIndex(s.body, label));
    for (const [i, label] of LABELS.entries()) {
      assert.ok(positions[i] >= 0, `"${s.title}" lacks ${label}`);
      const count = s.body.split(label).length - 1;
      assert.equal(count, 1, `"${s.title}" has ${label} ${count} times`);
    }
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2], `"${s.title}" labels out of order`);
  }
});

test('annotated page uses none of the old section labels', () => {
  for (const label of OLD_LABELS) {
    assert.equal(annotatedBody.split(label).length - 1, 0, `found old label ${label}`);
  }
});

test('opening is concise and links only to the example and clean download', () => {
  assert.ok(firstH2 > 0, 'missing first h2');
  const visible = opening.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const words = visible.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [];
  assert.ok(words.length <= 90, `opening has ${words.length} words`);
  const links = [...opening.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(links, ['/sample', '/prd-template.md']);
});

test('annotated page uses generic voice and has no removed cross-sell links', () => {
  const forbidden = [/\bBurke\b/i, /\bone[- ]shot\b/i, /\bone pass\b/i, /\/walkthrough/i, /\/history/i];
  for (const pattern of forbidden) assert.doesNotMatch(annotatedBody, pattern);
});

test('each annotated section quotes the sample in a blockquote and has one ```md skeleton', () => {
  for (const s of annotatedSections) {
    const example = s.body.slice(labelIndex(s.body, LABELS[1]), labelIndex(s.body, LABELS[2]));
    assert.match(example, /^> \S/m, `"${s.title}" has no blockquote under the example label`);
    const skeleton = s.body.slice(labelIndex(s.body, LABELS[2]));
    assert.equal((skeleton.match(/^```md$/gm) ?? []).length, 1, `"${s.title}" needs exactly one \`\`\`md block`);
    assert.ok(mdBlock(skeleton)?.trim(), `"${s.title}" skeleton is empty`);
  }
});

test(`clean template has exactly ${SECTION_COUNT} h2s with the same titles, in order`, () => {
  assert.equal(cleanSections.length, SECTION_COUNT, cleanSections.map((s) => s.title).join(' | '));
  assert.deepEqual(
    cleanSections.map((s) => s.title),
    annotatedSections.map((s) => s.title),
  );
});

test('each clean section is one instruction comment plus the skeleton from the annotated page', () => {
  for (const [i, section] of cleanSections.entries()) {
    const comments = section.body.match(/<!--[\s\S]*?-->/g) ?? [];
    assert.equal(comments.length, 1, `"${section.title}" should have exactly one <!-- --> comment`);
    assert.ok(comments[0].trim().length > 12, `"${section.title}" comment is empty`);
    const skeleton = section.body.replace(/<!--[\s\S]*?-->/g, '').trim();
    const expected = mdBlock(annotatedSections[i].body).trim();
    assert.equal(skeleton, expected, `skeleton mismatch in "${section.title}"`);
  }
});

test('clean template starts with the title, has no frontmatter, and shows the checkbox format', () => {
  const lines = clean.split('\n');
  assert.equal(lines[0], '# Build {Product Name}');
  assert.notEqual(lines[0], '---');
  assert.ok(clean.includes('- [ ] Requirement — Verify: method'));
  assert.equal((clean.match(/^# /gm) ?? []).length, 1, 'exactly one h1');
});

test('clean template has a routes table with a `/{vanity}` example row and 120–220 lines', () => {
  assert.match(clean, /^\| Route \| Behavior \|$/m);
  assert.match(clean, /^\| `\/\{vanity\}` \|/m);
  const lineCount = clean.trimEnd().split('\n').length;
  assert.ok(lineCount >= 120 && lineCount <= 220, `line count ${lineCount}`);
});

test('every {placeholder} in the clean template is documented on the annotated page', () => {
  const tokens = new Set(clean.match(PLACEHOLDER) ?? []);
  assert.ok(tokens.size > 0, 'no placeholders found');
  const missing = [...tokens].filter((t) => !annotated.includes(t));
  assert.deepEqual(missing, [], `placeholders missing from content/template.md`);
});
