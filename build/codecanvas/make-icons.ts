/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders build/codecanvas/icon.svg into the app icons: resources/darwin/code.icns (with the macOS
// tools sips and iconutil), resources/linux/code.png and resources/win32/code.ico.
//   node build/codecanvas/make-icons.ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium } from 'playwright';

const repoRoot = path.join(import.meta.dirname, '..', '..');
const workFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'codecanvas-icons-'));

async function renderPng(size: number): Promise<Buffer> {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: size, height: size } });
		const svg = fs.readFileSync(path.join(import.meta.dirname, 'icon.svg'), 'utf8');
		await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`);
		return await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
	} finally {
		await browser.close();
	}
}

/** An .ico file whose images are PNGs (supported since Windows Vista). */
function icoFromPngs(pngs: { size: number; data: Buffer }[]): Buffer {
	const header = Buffer.alloc(6 + 16 * pngs.length);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(pngs.length, 4);
	let offset = header.length;
	pngs.forEach(({ size, data }, index) => {
		const entry = 6 + 16 * index;
		header.writeUInt8(size >= 256 ? 0 : size, entry);
		header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
		header.writeUInt16LE(1, entry + 4);
		header.writeUInt16LE(32, entry + 6);
		header.writeUInt32LE(data.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += data.length;
	});
	return Buffer.concat([header, ...pngs.map(png => png.data)]);
}

const large = await renderPng(1024);
fs.writeFileSync(path.join(repoRoot, 'resources', 'linux', 'code.png'), large);

const iconset = path.join(workFolder, 'CodeCanvas.iconset');
fs.mkdirSync(iconset);
const source = path.join(workFolder, 'icon-1024.png');
fs.writeFileSync(source, large);
for (const size of [16, 32, 128, 256, 512]) {
	execFileSync('sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
	execFileSync('sips', ['-z', String(size * 2), String(size * 2), source, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(repoRoot, 'resources', 'darwin', 'code.icns')]);

// Small sizes are rendered at their size (not scaled down), so their edges stay sharp.
const windowsPngs = await Promise.all([16, 32, 128, 256].map(async size => ({ size, data: await renderPng(size) })));
fs.writeFileSync(path.join(repoRoot, 'resources', 'win32', 'code.ico'), icoFromPngs(windowsPngs));

fs.rmSync(workFolder, { recursive: true, force: true });
console.log('wrote resources/darwin/code.icns, resources/linux/code.png, resources/win32/code.ico');
