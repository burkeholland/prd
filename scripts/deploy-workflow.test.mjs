import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/deploy.yml', 'utf8'));

test('Pages retries select one attempt-specific wrapper of the tested dist', () => {
  const { build, e2e, deploy } = workflow.jobs;
  const actionStep = (job, action) => {
    const steps = job.steps.filter(({ uses }) => uses?.startsWith(`${action}@`));
    assert.equal(steps.length, 1, `expected one ${action} step`);
    return steps[0];
  };

  const pagesUpload = actionStep(deploy, 'actions/upload-pages-artifact');
  const pagesDeploy = actionStep(deploy, 'actions/deploy-pages');
  const wrapperName = pagesUpload.with?.name;
  assert.equal(typeof wrapperName, 'string', 'Pages upload needs an explicit wrapper name');
  assert.equal(pagesDeploy.with?.artifact_name, wrapperName, 'Pages must deploy the named wrapper');
  const attemptExpression = /\$\{\{\s*github\.run_attempt\s*\}\}/g;
  assert.match(wrapperName, attemptExpression, 'wrapper names must include the workflow attempt');
  assert.deepEqual(
    [1, 2].map((attempt) => wrapperName.replace(attemptExpression, String(attempt))),
    ['github-pages-1', 'github-pages-2'],
  );

  for (const [job, action] of [
    [build, 'actions/upload-artifact'],
    [e2e, 'actions/download-artifact'],
    [deploy, 'actions/download-artifact'],
  ]) {
    const { name, path } = actionStep(job, action).with;
    assert.deepEqual({ name, path }, { name: 'dist', path: 'dist' });
  }
  assert.equal(pagesUpload.with.path, 'dist');
  assert.equal(e2e.needs, 'build');
  assert.deepEqual(e2e.strategy.matrix.project, ['chromium', 'webkit', 'firefox']);
  assert.equal(deploy.needs, 'e2e');
  const browserStep = e2e.steps.find(({ run }) => run?.startsWith('npx playwright test'));
  assert.equal(browserStep.env.PLAYWRIGHT_PREBUILT, '1');
  assert.equal(browserStep.env.PW_ENGINES, 'all');
  assert.equal(build.steps.filter(({ run }) => run === 'npm run build').length, 1);
  for (const job of [e2e, deploy]) {
    assert.ok(
      job.steps.every(({ run }) => !/\b(?:npm run build|astro build)\b/.test(run ?? '')),
      'downstream jobs must reuse the tested build, not rebuild it',
    );
  }
});
