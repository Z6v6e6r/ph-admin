import { cpSync, existsSync, mkdirSync } from 'node:fs';
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
  'phab-admin-panel.js',
  'phab-community-feed.js',
  'phab-communities-showcase.js',
  'phab-client-messenger.js',
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

console.log('Client SDK copied to dist/');
