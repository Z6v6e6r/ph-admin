import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const sourceDir = join(rootDir, 'client-sdk');
const distDir = join(rootDir, 'dist');
const distClientSdkDir = join(distDir, 'client-sdk');

if (!existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

mkdirSync(distClientSdkDir, { recursive: true });

const files = ['phab-admin-panel.js', 'phab-client-messenger.js'];
for (const file of files) {
  const sourceFile = join(sourceDir, file);
  cpSync(sourceFile, join(distDir, file));
  cpSync(sourceFile, join(distClientSdkDir, file));
}

console.log('Client SDK copied to dist/');
