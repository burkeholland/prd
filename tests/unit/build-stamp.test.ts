import { describe, expect, it } from 'vitest';
import { buildStamp } from '../../src/lib/build-stamp';

const NOW = new Date('2026-08-31T19:27:00.000Z');
const SHA = 'e60420c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7';

describe('buildStamp', () => {
  it('stamps "local" when GITHUB_SHA is unset', () => {
    expect(buildStamp({}, NOW).sha).toBe('local');
  });

  it('stamps the 40-hex GITHUB_SHA when it is set', () => {
    expect(buildStamp({ GITHUB_SHA: SHA }, NOW).sha).toBe(SHA);
  });

  it('stamps builtAt as the ISO form of the clock it is given', () => {
    expect(buildStamp({}, NOW).builtAt).toBe(NOW.toISOString());
    expect(buildStamp({}, NOW).builtAt).toBe('2026-08-31T19:27:00.000Z');
  });
});
