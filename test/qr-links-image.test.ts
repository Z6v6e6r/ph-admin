import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { QrCodeImageService } from '../src/qr-links/qr-code-image.service';
import { QrTargetUrlPolicy } from '../src/qr-links/qr-target-url-policy';

const PNG_SIZE = 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const policy = new QrTargetUrlPolicy({
  QR_LINKS_PUBLIC_BASE_URL: 'https://padlhub.su',
  QR_LINKS_ALLOWED_TARGET_HOSTS: 'padlhub.su,padlhub.ru',
  QR_LINKS_ALLOWED_TARGET_PORTS: '443'
} as NodeJS.ProcessEnv);

interface DecodedQr {
  width: number;
  height: number;
  text: string | null;
}

function decodePng(buffer: Buffer): DecodedQr {
  const png = PNG.sync.read(buffer);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return { width: png.width, height: png.height, text: decoded?.data ?? null };
}

function assertBlackOnWhiteOnly(buffer: Buffer): void {
  const png = PNG.sync.read(buffer);
  let darkPixels = 0;
  let whitePixels = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    assert.equal(alpha, 255, 'QR PNG must be fully opaque');
    const isBlack = red === 0 && green === 0 && blue === 0;
    const isWhite = red === 255 && green === 255 && blue === 255;
    assert.ok(isBlack || isWhite, `unexpected pixel colour rgb(${red},${green},${blue})`);
    if (isBlack) darkPixels += 1;
    else whitePixels += 1;
  }
  assert.ok(darkPixels > 0, 'QR PNG must contain dark modules');
  assert.ok(whitePixels > 0, 'QR PNG must contain a white quiet zone');
  // A quiet zone plus mostly-white canvas must dominate a plain QR code.
  assert.ok(whitePixels > darkPixels, 'QR PNG must remain a black-on-white image');
  const cornerIndexes = [
    0,
    (png.width - 1) * 4,
    (png.height - 1) * png.width * 4,
    ((png.height * png.width) - 1) * 4
  ];
  for (const index of cornerIndexes) {
    assert.equal(png.data[index], 255, 'QR PNG corners must be white quiet zone');
    assert.equal(png.data[index + 1], 255, 'QR PNG corners must be white quiet zone');
    assert.equal(png.data[index + 2], 255, 'QR PNG corners must be white quiet zone');
  }
}

async function main(): Promise<void> {
  const imageService = new QrCodeImageService();
  const shortUrls = [
    policy.shortUrl('abcd234567'),
    policy.shortUrl('zyxw987654')
  ];

  for (const shortUrl of shortUrls) {
    const png = await imageService.renderPng(shortUrl);
    assert.ok(Buffer.isBuffer(png), 'renderPng must resolve to a Buffer');
    assert.ok(png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC), 'renderPng must emit a real PNG');
    assert.equal(png.toString('latin1').includes(shortUrl), false, 'PNG must not embed the plain short URL');

    const decoded = decodePng(png);
    assert.equal(decoded.width, PNG_SIZE, 'QR PNG width must be 1024');
    assert.equal(decoded.height, PNG_SIZE, 'QR PNG height must be 1024');
    assert.equal(decoded.text, shortUrl, 'decoded PNG payload must equal the permanent short URL');
    assertBlackOnWhiteOnly(png);
  }

  const first = decodePng(await imageService.renderPng(shortUrls[0]));
  const second = decodePng(await imageService.renderPng(shortUrls[1]));
  assert.notEqual(first.text, second.text, 'different short URLs must encode different payloads');

  const svg = await imageService.renderSvg(shortUrls[0]);
  assert.equal(typeof svg, 'string');
  assert.ok(svg.startsWith('<svg '), 'renderSvg must emit an inline SVG document');
  assert.ok(svg.trimEnd().endsWith('</svg>'), 'renderSvg must emit a complete SVG document');
  assert.match(svg, /width="1024"/, 'SVG must be 1024 wide');
  assert.match(svg, /height="1024"/, 'SVG must be 1024 tall');
  assert.match(svg, /viewBox="0 0 \d+ \d+"/, 'SVG must be vector-scalable via viewBox');
  assert.match(svg, /shape-rendering="crispEdges"/, 'SVG must render crisp modules');
  assert.match(svg, /#[0-9a-fA-F]{6}/, 'SVG must declare explicit colours');
  const svgColors = new Set(svg.match(/#[0-9a-fA-F]{6}/g) ?? []);
  assert.deepEqual([...svgColors].sort(), ['#000000', '#ffffff'], 'SVG must be strictly black on white');
  assert.equal(svg.includes(shortUrls[0]), false, 'SVG must not embed the plain short URL text');
  assert.doesNotMatch(svg, /<image/i, 'SVG must not embed raster images');
  assert.doesNotMatch(svg, /<script/i, 'SVG must not contain scripts');
  assert.doesNotMatch(svg, /href=/i, 'SVG must not reference external resources');
  assert.doesNotMatch(svg, /data:/i, 'SVG must not embed data URIs');

  console.log('QR code image tests passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
