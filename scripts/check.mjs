import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const file of ['server.mjs', 'scripts/build.mjs', 'scripts/healthcheck.mjs', 'scripts/smoke.mjs', 'scripts/publish-image.mjs', 'public/app.js', 'public/data.js', 'test/server.test.mjs']) execFileSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'inherit' });
const source = await readFile(resolve(root, 'public/data.js'), 'utf8');
const data = JSON.parse(source.replace(/^window\.GUIDE\s*=\s*/, '').replace(/;\s*$/, ''));
if (data.specs.length !== 6) throw new Error('The guide must contain six healer profiles');
for (const spell of Object.values(data.spells)) {
  if (!spell.description || !spell.original) throw new Error('Incomplete tooltip: ' + spell.name);
  await access(resolve(root, 'public/assets', spell.icon + '.jpg'));
}
for (const spec of data.specs) {
  for (const id of spec.healIds.concat(spec.utilityIds)) if (!data.spells[id]) throw new Error('Missing spell: ' + id);
  for (const icon of spec.treeicons) await access(resolve(root, 'public/assets', icon + '.jpg'));
}
await access(resolve(root, 'public/assets/forever.jpg'));
console.log(`Syntax and content OK: ${data.specs.length} profiles, ${Object.keys(data.spells).length} spell identities.`);
