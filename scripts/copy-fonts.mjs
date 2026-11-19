import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = path.join(root, 'public', 'fonts');

const families = [
  { pkg: '@fontsource/architects-daughter', weights: [400], embed: true },
  { pkg: '@fontsource/jetbrains-mono', weights: [400, 700], embed: true },
  { pkg: '@fontsource/inter', weights: [400, 500, 600, 700], embed: false },
  { pkg: '@fontsource/space-grotesk', weights: [500, 600, 700], embed: false },
];
const subsets = ['latin', 'latin-ext'];

const manifest = [];
mkdirSync(outDir, { recursive: true });

for (const family of families) {
  const pkgDir = path.dirname(require.resolve(`${family.pkg}/package.json`));
  const unicode = JSON.parse(readFileSync(path.join(pkgDir, 'unicode.json'), 'utf8'));
  for (const weight of family.weights) {
    for (const subset of subsets) {
      const css = readFileSync(path.join(pkgDir, `${subset}-${weight}.css`), 'utf8');
      const face = css.match(/font-family:\s*'([^']+)'/)?.[1];
      const file = css.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
      const range = unicode[subset];
      if (!face || !file || !range) {
        throw new Error(`Nie udało się odczytać ${family.pkg} ${subset}-${weight}.css`);
      }
      copyFileSync(path.join(pkgDir, 'files', file), path.join(outDir, file));
      manifest.push({
        family: face,
        weight,
        style: 'normal',
        file,
        unicodeRange: range,
        embed: family.embed,
      });
    }
  }
}

const json = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(path.join(outDir, 'manifest.json'), json);
writeFileSync(path.join(root, 'src', 'fontManifest.json'), json);
copyFileSync(path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), 'LICENSE'), path.join(outDir, 'OFL.txt'));
writeFileSync(
  path.join(outDir, 'NOTICE.txt'),
  'Architects Daughter, JetBrains Mono, Inter and Space Grotesk are licensed under the SIL Open Font License 1.1. See OFL.txt.\n'
);
