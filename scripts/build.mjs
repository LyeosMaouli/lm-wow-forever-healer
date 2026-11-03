import { cp, mkdir, readdir, lstat, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'public');
const destination = resolve(root, 'dist');
async function validateDirectory(dir) {
  for (const name of await readdir(dir)) {
    if (name.startsWith('.')) throw new Error('Hidden file in public/: ' + name);
    const path = join(dir, name), info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Symlinks are not allowed in public/: ' + path);
    if (info.isDirectory()) await validateDirectory(path);
  }
}
await validateDirectory(source);
for (const name of ['index.html', 'app.js', 'data.js', 'style.css']) await readFile(join(source, name));
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log('Build complete: public/ copied to dist/. No external assets are downloaded.');
