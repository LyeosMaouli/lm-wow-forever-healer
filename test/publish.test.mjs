import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'ghcr.io/example/forever-healing';
const sha = 'a'.repeat(40), digest = 'b'.repeat(64);

function run(mode = 'success', tags = `${repository}:sha-${sha}\n${repository}:edge`) {
  const directory = mkdtempSync(join(tmpdir(), 'forever-publish-'));
  try {
    const bin = join(directory, 'bin'); mkdirSync(bin);
    const log = join(directory, 'calls.jsonl'), output = join(directory, 'output');
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'image' && args[1] === 'inspect') {
  console.log(JSON.stringify([{ Id: 'sha256:tested-image', Config: {Labels: {
    'org.opencontainers.image.revision': process.env.TEST_MODE === 'wrong-revision' ? 'c'.repeat(40) : process.env.GITHUB_SHA
  }}, RepoDigests: [process.env.IMAGE + '@sha256:${digest}'] }]));
} else if (args[0] === 'push') {
  if (process.env.TEST_MODE === 'push-fails') process.exit(1);
} else if (args[0] !== 'tag' || args[1] !== 'sha256:tested-image') {
  throw new Error('Only tagging the tested image ID and pushing are allowed');
}
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ['scripts/publish-image.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bin + delimiter + process.env.PATH,
        IMAGE: repository, TAGS: tags, GITHUB_SHA: sha, GITHUB_OUTPUT: output,
        TEST_LOG: log, TEST_MODE: mode },
    });
    return { ...result, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [],
      output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const options = { skip: process.platform === 'win32' ? 'POSIX executable fixture; covered in Linux CI' : false };
test('publication pushes the tested image ID without a second build', options, () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter(args => args[0] === 'push').length, 2);
  assert.equal(result.calls.filter(args => args[0] === 'tag').length, 2);
  assert(result.calls.every(args => args[0] !== 'build' && args[0] !== 'buildx'));
  assert.equal(result.output, `digest=sha256:${digest}\n`);
});
test('a failed push never records a ready-for-deployment digest', options, () => {
  const result = run('push-fails');
  assert.notEqual(result.status, 0);
  assert(result.calls.some(args => args[0] === 'push'));
  assert.equal(result.output, '');
});
test('a wrong source revision is rejected before any publication', options, () => {
  const result = run('wrong-revision');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tested image does not match this source commit/);
  assert.equal(result.calls.filter(args => args[0] === 'push').length, 0);
});
test('tags outside the selected registry repository are rejected', options, () => {
  const result = run('success', `${repository}:sha-${sha}\nghcr.io/other/site:edge`);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});
