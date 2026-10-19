import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const sourceDir = join(rootDir, 'client-sdk');
const distDir = join(rootDir, 'dist');
const distClientSdkDir = join(distDir, 'client-sdk');
const sourceBrandingDir = join(sourceDir, 'branding');
const distBrandingDir = join(distClientSdkDir, 'branding');

if (!existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

mkdirSync(distClientSdkDir, { recursive: true });

const files = [
  'admin-panel-message.wav',
  'phab-admin-panel.js',
  'phab-community-results-templates.js',
  'phab-gift-certificates-admin.js',
  'phab-referral-links-admin.js',
  'phab-community-feed.js',
  'phab-communities-showcase.js',
  'phab-client-messenger.js',
  'phab-tournaments-showcase.js',
  'phab-messenger-push-sw.js'
];
for (const file of files) {
  const sourceFile = join(sourceDir, file);
  cpSync(sourceFile, join(distDir, file));
  cpSync(sourceFile, join(distClientSdkDir, file));
}

if (existsSync(sourceBrandingDir)) {
  mkdirSync(distBrandingDir, { recursive: true });
  cpSync(sourceBrandingDir, distBrandingDir, { recursive: true });
}

// The supplied font binaries remain build inputs, not arbitrary runtime binaries.
// Ship one self-contained, locally rendered asset pack, with no Claude/CDN calls.
const templatesDir = join(rootDir, 'assets', 'community-results-templates');
const assets = { version: 'vnd-results-templates-v1', html: {}, resources: {} };
for (const name of readdirSync(join(templatesDir, 'html')).sort()) {
  if (!/^(01_klassika|02_temnaya_arena|03_podium|04_tablo|05_oblozhka)_(start|rokot|smash)\.html$/.test(name)) {
    throw new Error('Unexpected community results template: ' + name);
  }
  const html = readFileSync(join(templatesDir, 'html', name), 'utf8');
  if (/<script|\son\w+=|https?:\/\//i.test(html)) throw new Error('Template must be static and local: ' + name);
  assets.html[name.replace('.html', '')] = html;
}
if (Object.keys(assets.html).length !== 15) throw new Error('Expected fifteen community results templates');
for (const [directory, extension, mime] of [['fonts', '.ttf', 'font/ttf'], ['img', '.svg', 'image/svg+xml']]) {
  for (const name of readdirSync(join(templatesDir, directory)).sort()) {
    if (!name.endsWith(extension)) throw new Error('Unexpected community results asset: ' + name);
    assets.resources[directory + '/' + name] = 'data:' + mime + ';base64,' + readFileSync(join(templatesDir, directory, name)).toString('base64');
  }
}
writeFileSync(join(distClientSdkDir, 'community-results-assets.json'), JSON.stringify(assets));

console.log('Client SDK and community results templates copied to dist/');
