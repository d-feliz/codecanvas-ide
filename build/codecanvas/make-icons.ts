/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Draws every CodeCanvas logo file from the mark below: the app icons (macOS, Windows, Linux), the
// web favicon and icons, the Windows tiles, the title bar icon and the empty-editor watermarks.
// The macOS .icns needs the macOS tool iconutil.
//   node build/codecanvas/make-icons.ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser } from 'playwright';

const repoRoot = path.join(import.meta.dirname, '..', '..');

type MarkColors = { blocks: string; accent: string };
const DARK = { blocks: '#F2F2F3', accent: '#E8C27A', background: '#16171A' };
const MONO_LIGHT: MarkColors = { blocks: '#121316', accent: '#121316' };
const HIGH_CONTRAST_DARK: MarkColors = { blocks: '#FFFFFF', accent: '#FFFFFF' };
const HIGH_CONTRAST_LIGHT: MarkColors = { blocks: '#000000', accent: '#000000' };

const MARK_VIEW_BOX_SIZE = 48;
const MARK_WIDTH_IN_ICON = 0.56;
const ICON_CORNER_RADIUS = 0.225;
// Apple's icon grid: the tile is 824 of the 1024 px canvas, so the system can draw its shadow around it.
const MACOS_TILE_INSET = 100 / 1024;
const WATERMARK_OPACITY = 0.3;

/** The mark's shapes in its 48 × 48 grid: three blocks, wires between them, one accent block (the output). */
function markShapes(colors: MarkColors): string {
	return [
		`<path d="M20 14h8M13 21v4a4 4 0 0 0 4 4M35 21v4a4 4 0 0 1-4 4" stroke="${colors.blocks}" stroke-width="3" stroke-linecap="round"/>`,
		`<rect x="6" y="7" width="14" height="14" rx="3.5" fill="${colors.blocks}"/>`,
		`<rect x="28" y="7" width="14" height="14" rx="3.5" fill="${colors.blocks}"/>`,
		`<rect x="17" y="27" width="14" height="14" rx="3.5" fill="${colors.accent}"/>`,
	].join('\n\t');
}

function markSvg(colors: MarkColors, attributes = ''): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_VIEW_BOX_SIZE} ${MARK_VIEW_BOX_SIZE}" fill="none"${attributes}>\n\t${markShapes(colors)}\n</svg>\n`;
}

function markAt(size: number, markSize: number): string {
	const markOffset = (size - markSize) / 2;
	return `<g transform="translate(${markOffset} ${markOffset}) scale(${markSize / MARK_VIEW_BOX_SIZE})">\n\t${markShapes(DARK)}\n\t</g>`;
}

/** The rounded dark square with the mark centered on it; `tileInset` leaves room around the square. */
function appIconSvg(size: number, tileInset: number): string {
	const tileOffset = size * tileInset;
	const tileSize = size - 2 * tileOffset;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="none">
	<rect x="${tileOffset}" y="${tileOffset}" width="${tileSize}" height="${tileSize}" rx="${tileSize * ICON_CORNER_RADIUS}" fill="${DARK.background}"/>
	${markAt(size, tileSize * MARK_WIDTH_IN_ICON)}
</svg>
`;
}

/** The mark alone: the Windows tiles get their background colour from VisualElementsManifest.xml. */
function markOnlyIconSvg(size: number): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="none">
	${markAt(size, size * MARK_WIDTH_IN_ICON)}
</svg>
`;
}

/** Each size is drawn at its own pixel size, so small icons stay sharp instead of being scaled down. */
async function renderPng(browser: Browser, svg: string, size: number): Promise<Buffer> {
	const page = await browser.newPage({ viewport: { width: size, height: size } });
	try {
		await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
		return await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
	} finally {
		await page.close();
	}
}

async function pngsAtSizes(browser: Browser, sizes: number[], svgAtSize: (size: number) => string) {
	return Promise.all(sizes.map(async size => ({ size, data: await renderPng(browser, svgAtSize(size), size) })));
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

const writtenFiles: string[] = [];
function writeRepoFile(relativePath: string, content: string | Buffer): void {
	fs.writeFileSync(path.join(repoRoot, relativePath), content);
	writtenFiles.push(relativePath);
}

const browser = await chromium.launch();
try {
	writeRepoFile('build/codecanvas/logo-mark.svg', markSvg(DARK));
	writeRepoFile('src/vs/workbench/browser/media/code-icon.svg', appIconSvg(MARK_VIEW_BOX_SIZE, 0));

	const watermark = (colors: MarkColors) => markSvg(colors, ` width="260" height="260" opacity="${WATERMARK_OPACITY}"`);
	const watermarkFolder = 'src/vs/workbench/browser/parts/editor/media';
	writeRepoFile(`${watermarkFolder}/letterpress-dark.svg`, watermark(DARK));
	// The light-coloured mark would vanish on a light editor.
	writeRepoFile(`${watermarkFolder}/letterpress-light.svg`, watermark(MONO_LIGHT));
	writeRepoFile(`${watermarkFolder}/letterpress-hcDark.svg`, watermark(HIGH_CONTRAST_DARK));
	writeRepoFile(`${watermarkFolder}/letterpress-hcLight.svg`, watermark(HIGH_CONTRAST_LIGHT));

	const macosIcon = (size: number) => appIconSvg(size, MACOS_TILE_INSET);
	const workFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'codecanvas-icons-'));
	const iconset = path.join(workFolder, 'CodeCanvas.iconset');
	fs.mkdirSync(iconset);
	for (const { size, data } of await pngsAtSizes(browser, [16, 32, 64, 128, 256, 512, 1024], macosIcon)) {
		if (size <= 512) {
			fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), data);
		}
		if (size >= 32) {
			fs.writeFileSync(path.join(iconset, `icon_${size / 2}x${size / 2}@2x.png`), data);
		}
	}
	execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(repoRoot, 'resources', 'darwin', 'code.icns')]);
	writtenFiles.push('resources/darwin/code.icns');
	fs.rmSync(workFolder, { recursive: true, force: true });

	writeRepoFile('resources/linux/code.png', await renderPng(browser, macosIcon(1024), 1024));

	const fullTileIcon = (size: number) => appIconSvg(size, 0);
	writeRepoFile('resources/win32/code.ico', icoFromPngs(await pngsAtSizes(browser, [16, 24, 32, 48, 64, 128, 256], fullTileIcon)));
	writeRepoFile('resources/win32/code_70x70.png', await renderPng(browser, markOnlyIconSvg(70), 70));
	writeRepoFile('resources/win32/code_150x150.png', await renderPng(browser, markOnlyIconSvg(150), 150));

	writeRepoFile('resources/server/favicon.ico', icoFromPngs(await pngsAtSizes(browser, [16, 32, 48], fullTileIcon)));
	writeRepoFile('resources/server/code-192.png', await renderPng(browser, fullTileIcon(192), 192));
	writeRepoFile('resources/server/code-512.png', await renderPng(browser, fullTileIcon(512), 512));
} finally {
	await browser.close();
}
console.log(`wrote:\n${writtenFiles.join('\n')}`);
