/** What `/build.json` says about the build that produced the site (src/pages/build.json.ts). */
export interface BuildStamp {
  /** The 40-hex commit from `GITHUB_SHA` in Actions; `"local"` for any other build. */
  readonly sha: string;
  /** When the build ran, ISO 8601. */
  readonly builtAt: string;
}

/**
 * The build stamp, from the environment and the clock passed in so it is pure and testable.
 * After every `main` deploy the `deploy` job polls the live `/build.json` until `sha` equals the
 * commit it just published (deploy.yml, "Verify the live site serves this commit"), which is
 * how a green run comes to mean "the site serves this build" and not just "the upload worked".
 *
 *   buildStamp({}, now)                          → { sha: 'local', builtAt: now.toISOString() }
 *   buildStamp({ GITHUB_SHA: 'e60420c…' }, now)  → { sha: 'e60420c…', builtAt: now.toISOString() }
 */
export function buildStamp(env: NodeJS.ProcessEnv, now: Date): BuildStamp {
  const sha = env.GITHUB_SHA?.trim();
  return { sha: sha ? sha : 'local', builtAt: now.toISOString() };
}
