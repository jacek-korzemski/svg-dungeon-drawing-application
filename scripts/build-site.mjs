import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copy } from "../page/copy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const origin = (process.env.SITE_URL || "https://domena.pl").replace(/\/+$/, "");
// Pages project sites live under /<repo>. SITE_URL already includes that prefix.
const base = siteBase(process.env.BASE_PATH || "");
const template = fs.readFileSync(path.join(root, "page", "template.html"), "utf8");

function siteBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function applyBasePath(html) {
  if (!base) return html;
  return html.replace(/(\s(?:href|src)=")\//g, `$1${base}/`);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function listHtml(page) {
  const features = page.features
    .map(
      (item) =>
        `<article><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></article>`
    )
    .join("");
  const steps = page.steps
    .map(
      (item, index) =>
        `<li><span>${index + 1}</span><div><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div></li>`
    )
    .join("");
  const tips = page.tips.map((item) => `<li>${esc(item)}</li>`).join("");
  const exportsHtml = page.exports
    .map(
      (item) =>
        `<article><span class="kicker">${esc(item.kicker)}</span><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></article>`
    )
    .join("");
  return { features, steps, tips, exports: exportsHtml };
}

function render(page) {
  const blocks = listHtml(page);
  const values = {
    lang: page.lang,
    title: esc(page.title),
    description: esc(page.description),
    canonical: esc(`${origin}${page.path}`),
    urlPl: esc(`${origin}/`),
    urlEn: esc(`${origin}/en/`),
    ogImage: esc(`${origin}/img/crypt.webp`),
    ogLocale: esc(page.ogLocale),
    ogLocaleAlt: esc(page.ogLocaleAlt),
    homePath: esc(page.path),
    navHome: esc(page.navHome),
    cta: esc(page.cta),
    ctaSecondary: esc(page.ctaSecondary),
    close: esc(page.close),
    zoom: esc(page.zoom),
    eyebrow: esc(page.eyebrow),
    heroTitle: esc(page.heroTitle),
    heroLead: esc(page.heroLead),
    heroCaption: esc(page.heroCaption),
    heroAlt: esc(page.heroAlt),
    featuresTitle: esc(page.featuresTitle),
    featuresLead: esc(page.featuresLead),
    features: blocks.features,
    settlementCaption: esc(page.settlementCaption),
    settlementAlt: esc(page.settlementAlt),
    stepsTitle: esc(page.stepsTitle),
    steps: blocks.steps,
    tipsTitle: esc(page.tipsTitle),
    tips: blocks.tips,
    exportTitle: esc(page.exportTitle),
    exportLead: esc(page.exportLead),
    exportAlt: esc(page.exportAlt),
    exportCaption: esc(page.exportCaption),
    exports: blocks.exports,
    footer: esc(page.footer),
    plCurrent: page.lang === "pl" ? 'aria-current="page"' : "",
    enCurrent: page.lang === "en" ? 'aria-current="page"' : "",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.mkdirSync(path.join(dist, "en"), { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), applyBasePath(render(copy.pl)));
fs.writeFileSync(path.join(dist, "en", "index.html"), applyBasePath(render(copy.en)));
copyFile(path.join(root, "page", "styles.css"), path.join(dist, "styles.css"));
copyFile(path.join(root, "page", "main.js"), path.join(dist, "main.js"));

const imgDir = path.join(root, "page", "img");
if (fs.existsSync(imgDir)) {
  for (const name of fs.readdirSync(imgDir)) {
    copyFile(path.join(imgDir, name), path.join(dist, "img", name));
  }
}

console.log(`Landing: ${origin}/`);
console.log(`English: ${origin}/en/`);
console.log(`Editor:  ${origin}/build/`);
