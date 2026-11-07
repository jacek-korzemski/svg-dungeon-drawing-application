import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve('src/assets');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.toLowerCase().endsWith('.png')) files.push(full);
  }
  return files;
}

const files = await walk(root);
let rewritten = 0;
let skipped = 0;
let savedBytes = 0;

for (const file of files) {
  const input = await readFile(file);
  const before = await sharp(input).metadata();
  const output = await sharp(input)
    .png({
      compressionLevel: 9,
      effort: 10,
      palette: true,
      quality: 92,
      colors: 256,
      dither: 1,
    })
    .toBuffer();
  const after = await sharp(output).metadata();

  if (after.width !== before.width || after.height !== before.height) {
    console.error(`Skipped, dimensions changed: ${file}`);
    skipped += 1;
    continue;
  }
  if (!after.hasAlpha && before.hasAlpha) {
    console.error(`Skipped, alpha dropped: ${file}`);
    skipped += 1;
    continue;
  }
  if (output.length >= input.length) {
    skipped += 1;
    continue;
  }

  await writeFile(file, output);
  rewritten += 1;
  savedBytes += input.length - output.length;
}

const savedMb = (savedBytes / (1024 * 1024)).toFixed(2);
console.log(`Rewritten ${rewritten}, skipped ${skipped}, saved ${savedMb} MB`);
