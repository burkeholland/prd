import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/refresh-gist.yml', 'utf8'));

test('refresh workflow keeps both schedules and the manual dry-run input', () => {
  assert.deepEqual(
    workflow.on.schedule.map(({ cron }) => cron),
    ['23 13 * * *', '47 15 * * *'],
  );
  assert.ok(workflow.on.workflow_dispatch);
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.default, false);
});
