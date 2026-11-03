import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const image = process.env.IMAGE;
const sha = process.env.GITHUB_SHA;
if (!/^ghcr\.io\/[a-z0-9._/-]+$/.test(image ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
  throw new Error('Missing valid GHCR image repository or full source commit SHA');
}
const tags = [...new Set((process.env.TAGS ?? '').split(/\r?\n/).filter(Boolean))];
const shaTag = `${image}:sha-${sha}`;
if (!tags.includes(shaTag) || tags.some(tag => !tag.startsWith(image + ':') || !/^[a-zA-Z0-9_.-]+$/.test(tag.slice(image.length + 1)))) {
  throw new Error('Only approved-repository tags including the full commit SHA may be published');
}
const inspect = ref => JSON.parse(execFileSync('docker', ['image', 'inspect', ref], { encoding: 'utf8' }))[0];
const tested = inspect('forever-healing:smoke');
if (tested.Config.Labels?.['org.opencontainers.image.revision'] !== sha) {
  throw new Error('The tested image does not match this source commit');
}
for (const tag of tags) {
  execFileSync('docker', ['tag', tested.Id, tag], { stdio: 'inherit' });
  execFileSync('docker', ['push', tag], { stdio: 'inherit' });
}
const published = inspect(shaTag);
if (published.Id !== tested.Id) throw new Error('Published image differs from the tested image');
const reference = published.RepoDigests?.find(ref => ref.startsWith(image + '@sha256:'));
if (!reference || !/^[a-f0-9]{64}$/.test(reference.split('@sha256:')[1])) {
  throw new Error('Registry did not return an immutable image digest');
}
appendFileSync(process.env.GITHUB_OUTPUT, `digest=${reference.split('@')[1]}\n`);
console.log(`Published tested image: ${reference}`);
