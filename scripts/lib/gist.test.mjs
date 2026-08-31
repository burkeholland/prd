import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMeta,
  extractImages,
  gistHtmlUrl,
  gistRawUrl,
  imageFileName,
  imagePublicPath,
  isPng,
  pickGistFile,
  rewriteImageSources,
  slugify,
} from './gist.mjs';

const ASSET = 'https://gist.github.com/user-attachments/assets';
const FIXTURE = [
  '# Build The Urlist',
  '',
  '## Mocks',
  '',
  '#### Home Page',
  '',
  `<img width="1452" height="1580" alt="Screenshot 080518" src="${ASSET}/aaa-111" />`,
  '',
  '#### New List: Validation States',
  `<img width="700" height="900" alt="Validation" src="${ASSET}/bbb-222" />`,
  '',
  '##### Not a level-four heading',
  '',
  '#### My Lists (Logged In)',
  '',
  'Some text, then a third-party image that must never be touched:',
  '<img alt="logo" src="https://example.com/logo.png">',
  '',
  `<img width="1452" height="1580" alt="My lists" src="${ASSET}/ccc-333" />`,
  '',
  '## Technical specification',
  'Trailing text after the last image.',
].join('\r\n');

test('slugify: lowercase, alnum runs joined by "-", no leading/trailing dash', () => {
  assert.equal(slugify('My Lists (Logged In)'), 'my-lists-logged-in');
  assert.equal(slugify('New List: Validation States'), 'new-list-validation-states');
  assert.equal(slugify('  Published  List:  QR Code  '), 'published-list-qr-code');
  assert.equal(slugify('---'), '');
});

test('extractImages: user-attachment images in order, slug from nearest #### heading', () => {
  const images = extractImages(FIXTURE);
  assert.equal(images.length, 3, 'only the three user-attachment images are extracted');
  assert.deepEqual(images.map((i) => i.n), [1, 2, 3]);
  assert.deepEqual(
    images.map((i) => i.slug),
    ['home-page', 'new-list-validation-states', 'my-lists-logged-in'],
  );
  assert.deepEqual(images.map((i) => i.heading), ['Home Page', 'New List: Validation States', 'My Lists (Logged In)']);
  assert.equal(images[1].width, 700, 'width parsed as a number');
  assert.equal(images[1].height, 900);
  assert.equal(images[0].alt, 'Screenshot 080518');
  assert.equal(images[2].source, `${ASSET}/ccc-333`);
  assert.equal(imageFileName(images[0]), '01-home-page.png');
  assert.equal(imagePublicPath(images[2]), '/mocks/03-my-lists-logged-in.png');
});

test('extractImages: no images → empty array; image before any heading falls back to alt', () => {
  assert.deepEqual(extractImages('# Nothing here\n\nJust text.'), []);
  const [img] = extractImages(`<img alt="Cover Shot" src="${ASSET}/zzz" />`);
  assert.equal(img.slug, 'cover-shot');
  assert.equal(img.heading, null);
  assert.equal(img.width, null);
});

test('rewriteImageSources: identity when images is empty', () => {
  assert.equal(rewriteImageSources(FIXTURE, []), FIXTURE);
  assert.equal(rewriteImageSources(FIXTURE, undefined), FIXTURE);
});

test('rewriteImageSources: rewrites only the listed sources, every other byte identical', () => {
  const images = extractImages(FIXTURE);
  const out = rewriteImageSources(FIXTURE, images.slice(0, 2));

  const withoutSrc = (s) => s.replace(/src="[^"]*"/g, 'src=""');
  assert.equal(withoutSrc(out), withoutSrc(FIXTURE), 'everything except src values is unchanged');
  assert.ok(out.includes(`src="${imagePublicPath(images[0])}"`), 'first source rewritten');
  assert.ok(out.includes('src="/mocks/02-new-list-validation-states.png"'), 'second source rewritten');
  assert.ok(out.includes(`src="${ASSET}/ccc-333"`), 'third (unlisted) source untouched');
  assert.ok(out.includes('<img alt="logo" src="https://example.com/logo.png">'), 'non-user-attachments <img> untouched');
  assert.equal(out.split('\r\n').length, FIXTURE.split('\r\n').length, 'same line count and endings');
  assert.ok(out.startsWith('# Build The Urlist\r\n'), 'text before is intact');
  assert.ok(out.endsWith('Trailing text after the last image.'), 'text after is intact');

  const all = rewriteImageSources(FIXTURE, images);
  assert.equal((all.match(/src="\/mocks\//g) ?? []).length, 3);
  assert.equal(all.includes('user-attachments'), false);
});

test('isPng: true for the PNG signature, false otherwise', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  assert.equal(isPng(png), true);
  assert.equal(isPng(new Uint8Array(png)), true);
  assert.equal(isPng(Buffer.from('%PDF-1.7 binary')), false);
  assert.equal(isPng(Buffer.from([0x89, 0x50, 0x4e])), false, 'too short');
  assert.equal(isPng(Buffer.alloc(0)), false);
});

const GIT_FIXTURE = {
  id: 'f71d1156812fd91e4369308358892817',
  description: 'Build The Urlist - standalone Autopilot instruction',
  owner: 'burkeholland',
  filename: 'build-the-urlist.md',
  revision: '8ef29d7eecb97ecbbd5a89ff4a7375482364704f',
  updated_at: '2026-08-31T13:11:39Z',
  blob_sha: '82f6f039e6bbbc8d9799b1447c6eb2f427c064d7',
};

test('buildMeta: maps what the clone knows, derives html_url/raw_url, uses the given fetched_at', () => {
  const images = extractImages(FIXTURE);
  const meta = buildMeta(GIT_FIXTURE, images, '2026-08-31T15:00:00.000Z');
  assert.equal(meta.id, GIT_FIXTURE.id);
  assert.equal(meta.description, GIT_FIXTURE.description);
  assert.equal(meta.owner, 'burkeholland');
  assert.equal(meta.html_url, `https://gist.github.com/burkeholland/${GIT_FIXTURE.id}`);
  assert.equal(
    meta.raw_url,
    `https://gist.githubusercontent.com/burkeholland/${GIT_FIXTURE.id}/raw/${GIT_FIXTURE.blob_sha}/build-the-urlist.md`,
  );
  assert.equal(meta.filename, 'build-the-urlist.md');
  assert.equal(meta.revision, '8ef29d7eecb97ecbbd5a89ff4a7375482364704f');
  assert.equal(meta.updated_at, '2026-08-31T13:11:39Z');
  assert.equal(meta.fetched_at, '2026-08-31T15:00:00.000Z');
  assert.equal(meta.images.length, 3);
  assert.deepEqual(meta.images[0], {
    n: 1,
    slug: 'home-page',
    file: '/mocks/01-home-page.png',
    alt: 'Screenshot 080518',
    width: 1452,
    height: 1580,
    source: `${ASSET}/aaa-111`,
  });
  assert.deepEqual(Object.keys(meta), [
    'id', 'description', 'owner', 'html_url', 'raw_url', 'filename', 'revision', 'updated_at', 'fetched_at', 'images',
  ]);
  assert.equal(buildMeta(GIT_FIXTURE, [], new Date('2026-01-02T03:04:05Z')).fetched_at, '2026-01-02T03:04:05.000Z');

  const anonymous = buildMeta({ ...GIT_FIXTURE, owner: null, description: null }, [], 'x');
  assert.equal(anonymous.owner, null);
  assert.equal(anonymous.description, null);
  assert.equal(anonymous.html_url, `https://gist.github.com/${GIT_FIXTURE.id}`);
  assert.equal(anonymous.raw_url, `https://gist.githubusercontent.com/${GIT_FIXTURE.id}/raw/${GIT_FIXTURE.blob_sha}/build-the-urlist.md`);
  assert.equal(buildMeta({}, [], 'x').revision, null, 'nothing known → null fields');
  assert.equal(buildMeta({}, [], 'x').raw_url, null);
  assert.equal(gistHtmlUrl('burkeholland', 'abc'), 'https://gist.github.com/burkeholland/abc');
  assert.equal(gistRawUrl('o', 'abc', null, 'f.md'), 'https://gist.githubusercontent.com/o/abc/raw/f.md', 'no blob sha → latest raw');
});

test('pickGistFile: single file, then markdown, then by name — from the tree\'s file names', () => {
  assert.equal(pickGistFile(['build-the-urlist.md']), 'build-the-urlist.md');
  assert.equal(pickGistFile(['a.txt', 'b.md']), 'b.md');
  assert.equal(pickGistFile(['a.txt', 'b.MARKDOWN']), 'b.MARKDOWN');
  assert.equal(pickGistFile(['a.txt', 'b.json']), 'a.txt', 'no markdown → first file');
  assert.equal(pickGistFile(['a.txt', 'b.md'], 'a.txt'), 'a.txt');
  assert.equal(pickGistFile(['a.txt', 'b.md'], 'nope.md'), null);
  assert.equal(pickGistFile([]), null);
  assert.equal(pickGistFile(undefined), null);
});

// ---------------------------------------------------------------------------
// Integration: checks the committed snapshot produced by `node scripts/fetch-gist.mjs`.
// Skips cleanly when the outputs have not been generated.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPECTED_MOCKS = [
  '01-home-page.png',
  '02-new-list.png',
  '03-new-list-validation-states.png',
  '04-login-modal.png',
  '05-my-lists-logged-in.png',
  '06-published-list.png',
  '07-published-list-qr-code.png',
];

test('integration: committed snapshot is complete and consistent', async (t) => {
  const metaFile = path.join(ROOT, 'content', 'gist', 'meta.json');
  const rawFile = path.join(ROOT, 'public', 'raw', 'build-the-urlist.md');
  const contentFile = path.join(ROOT, 'content', 'gist', 'build-the-urlist.md');
  const mocksDir = path.join(ROOT, 'public', 'mocks');
  const exists = async (p) => stat(p).then(() => true, () => false);
  if (!(await exists(metaFile)) || !(await exists(rawFile)) || !(await exists(contentFile)) || !(await exists(mocksDir))) {
    t.skip('snapshot not generated yet — run `node scripts/fetch-gist.mjs`');
    return;
  }

  const mocks = (await readdir(mocksDir)).filter((f) => f.endsWith('.png')).sort();
  assert.deepEqual(mocks, EXPECTED_MOCKS, 'exactly the 7 expected mock files');
  for (const f of mocks) {
    const bytes = await readFile(path.join(mocksDir, f));
    assert.ok(isPng(bytes), `${f} is a PNG`);
    assert.ok(bytes.length > 10_000, `${f} is > 10 000 bytes (${bytes.length})`);
  }

  const count = (s, re) => (s.match(re) ?? []).length;
  const raw = await readFile(rawFile, 'utf8');
  const content = await readFile(contentFile, 'utf8');
  assert.equal(count(content, /src="\/mocks\//g), 7, 'content copy has 7 local sources');
  assert.equal(count(content, /user-attachments/g), 0, 'content copy has no remote sources');
  assert.equal(count(raw, /src="https:\/\/gist\.github\.com\/user-attachments\//g), 7, 'raw copy has 7 remote sources');
  assert.equal(count(raw, /\/mocks\//g), 0, 'raw copy has no local sources');
  assert.equal(content.split('\n').length, raw.split('\n').length, 'same line count');
  assert.equal(rewriteImageSources(raw, extractImages(raw)), content, 'content copy == rewrite(raw)');

  const meta = JSON.parse(await readFile(metaFile, 'utf8'));
  assert.equal(meta.images.length, 7);
  assert.match(meta.revision, /^[0-9a-f]{40}$/);
  assert.equal(meta.filename, 'build-the-urlist.md');
  assert.deepEqual(meta.images.map((i) => i.file), EXPECTED_MOCKS.map((f) => `/mocks/${f}`));
  assert.ok(!Number.isNaN(Date.parse(meta.fetched_at)), 'fetched_at is a date');
});
