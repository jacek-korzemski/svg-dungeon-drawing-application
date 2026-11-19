import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import type { DungeonDocument } from '../src/types/dungeon';
import type { JinklineExportView } from '../src/jinklineExport';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface RenderedMap {
  svg?: string;
  png?: Buffer;
}

let viteChild: ChildProcess | null = null;
let viteReady: Promise<string> | null = null;
let browser: Browser | null = null;
let page: Page | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForVite(url: string, child: ChildProcess, logs: () => string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 45000) {
    if (child.exitCode !== null) {
      throw new Error(`Vite zakończył się kodem ${child.exitCode}.\n${logs().slice(-2000)}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The dev server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite nie wystartował.\n${logs().slice(-2000)}`);
}

function startVite(): Promise<string> {
  return (async () => {
    const port = await freePort();
    const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    let log = '';
    const child = spawn(
      process.execPath,
      [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        windowsHide: true,
      }
    );
    viteChild = child;
    child.stdout?.on('data', (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.once('exit', () => {
      if (viteChild === child) {
        viteChild = null;
        viteReady = null;
      }
    });
    const url = `http://127.0.0.1:${port}/`;
    try {
      await waitForVite(url, child, () => log);
    } catch (error) {
      if (!child.killed) child.kill();
      if (viteChild === child) viteChild = null;
      throw error;
    }
    return url;
  })().catch((error) => {
    viteReady = null;
    throw error;
  });
}

function ensureVite(): Promise<string> {
  if (!viteReady) viteReady = startVite();
  return viteReady;
}

async function ensurePage(): Promise<Page> {
  const url = await ensureVite();
  if (!browser) {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Nie udało się uruchomić Chromium do eksportu. Zainstaluj przeglądarkę: npx playwright install chromium.\n${message}`
      );
    }
  }
  if (!page || page.isClosed()) {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => typeof window.__jinkline?.loadDocument === 'function', null, {
      timeout: 90000,
    });
  }
  return page;
}

export async function exportDocument(
  doc: DungeonDocument,
  view: Required<JinklineExportView>,
  format: 'svg' | 'png' | 'both'
): Promise<RenderedMap> {
  const active = await ensurePage();
  let rendered: { svg?: string; png?: string };
  try {
    rendered = await renderInPage(active, doc, view, format);
  } catch (error) {
    await active.goto(await ensureVite(), { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => undefined);
    await active
      .waitForFunction(() => typeof window.__jinkline?.loadDocument === 'function', null, { timeout: 90000 })
      .catch(() => undefined);
    try {
      rendered = await renderInPage(active, doc, view, format);
    } catch (retryError) {
      throw retryError instanceof Error ? retryError : error;
    }
  }
  return {
    ...(rendered.svg ? { svg: rendered.svg } : {}),
    ...(rendered.png ? { png: dataUrlToBuffer(rendered.png) } : {}),
  };
}

async function renderInPage(
  active: Page,
  doc: DungeonDocument,
  view: Required<JinklineExportView>,
  format: 'svg' | 'png' | 'both'
): Promise<{ svg?: string; png?: string }> {
  return active.evaluate(
    async ({ doc: next, view: nextView, format: nextFormat }) => {
      const api = window.__jinkline;
      if (!api) throw new Error('Aplikacja nie wystawiła eksportu.');
      await api.loadDocument(next, nextView);
      const out: { svg?: string; png?: string } = {};
      if (nextFormat === 'svg' || nextFormat === 'both') out.svg = await api.exportSvg();
      if (nextFormat === 'png' || nextFormat === 'both') out.png = await api.exportPng();
      return out;
    },
    { doc, view, format }
  );
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Eksport PNG nie zwrócił danych obrazu.');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

export async function shutdownExportHost(): Promise<void> {
  await page?.close().catch(() => undefined);
  page = null;
  await browser?.close().catch(() => undefined);
  browser = null;
  if (viteChild && !viteChild.killed) viteChild.kill();
  viteChild = null;
  viteReady = null;
}

process.once('exit', () => {
  if (viteChild && !viteChild.killed) viteChild.kill();
});
