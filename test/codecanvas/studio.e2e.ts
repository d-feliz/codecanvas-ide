/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// End-to-end check of Studio, CodeCanvas's own look, in a running CodeCanvas window. Run it
// through run.ts, after canvas.e2e.ts. It changes the user settings and puts them back at the end.
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';

const screenshots = process.argv[2];
const userSettingsFile = process.argv[3];
const assert = (condition, message) => {
	console.log(condition ? 'ok:' : 'FAIL:', message);
	if (!condition) {
		process.exitCode = 1;
	}
};

(async () => {
	const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
	const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('workbench'));
	await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
	const settingsBefore = fs.readFileSync(userSettingsFile, 'utf8');
	const setUserSettings = async (settings: Record<string, unknown>) => {
		fs.writeFileSync(userSettingsFile, JSON.stringify({ ...JSON.parse(settingsBefore), ...settings }, null, '\t'));
		await page.waitForTimeout(1500);
	};
	const runCommand = async (text: string) => {
		await page.keyboard.press('Meta+Shift+P');
		await page.waitForSelector('.quick-input-widget input');
		await page.keyboard.type(text);
		await page.waitForSelector(`.quick-input-list .monaco-list-row.focused:has-text("${text}")`, { timeout: 5000 }).catch(() => { });
		await page.keyboard.press('Enter');
	};
	const openFile = async (name: string) => {
		await page.keyboard.press('Meta+P');
		await page.waitForSelector('.quick-input-widget input');
		await page.keyboard.type(name);
		await page.waitForSelector(`.quick-input-list .monaco-list-row.focused[aria-label*="${name}"]`, { timeout: 15000 }).catch(() => { });
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1500);
	};
	const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
	const isShown = (selector: string) => page.locator(selector).first().isVisible();

	// The layout style is read when the window opens, so this switches it and reloads the window.
	const checkStudioLayout = async () => {
		await setUserSettings({ 'workbench.colorTheme': 'Studio Dark', 'workbench.layoutStyle': 'studio' });
		await runCommand('Developer: Reload Window');
		await page.waitForSelector('.monaco-workbench.studio-layout .studio-shell', { timeout: 60000 });
		await page.waitForTimeout(4000);
		const window = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
		assert(await isShown('.studio-shell'), 'Studio layout: the window uses the Studio shell');

		await openFile('cart.ts');
		await page.waitForSelector('.code-canvas-editor .cc-block', { timeout: 30000 });
		const sideBar = await box('.studio-shell > .part.sidebar');
		const activityBar = await box('.studio-shell > .part.activitybar');
		assert(Math.round(activityBar.x) === 12 && Math.round(sideBar.x) === Math.round(activityBar.x + activityBar.width), 'the left panel floats 12px from the window edge');
		const editor = await box('.studio-shell > .part.editor');
		assert(Math.round(editor.x) === 0 && Math.round(editor.width) === window.width, 'a canvas lies under the floating panels');
		const dock = await box('.code-canvas-editor .cc-dock');
		const freeRight = await isShown('.studio-shell > .part.auxiliarybar') ? (await box('.studio-shell > .part.auxiliarybar')).x : window.width;
		const freeCenter = (sideBar.x + sideBar.width + freeRight) / 2;
		assert(Math.abs(dock.x + dock.width / 2 - freeCenter) < 2, 'the canvas dock is centered in the area the panels leave free');
		const leftPill = await box('.studio-shell > .part.statusbar > .left-items');
		const rightPill = await box('.studio-shell > .part.statusbar > .right-items');
		assert(Math.round(leftPill.x) === 12 && Math.round(rightPill.x + rightPill.width) === window.width - 12 && leftPill.x + leftPill.width < rightPill.x, 'the status bar is two pills in the bottom corners');
		await page.screenshot({ path: path.join(screenshots, 'studio-layout-canvas.png') });

		await openFile('tsconfig.json');
		const textEditor = await box('.studio-shell > .part.editor');
		assert(Math.round(textEditor.x) === Math.round(sideBar.x + sideBar.width + 8), 'other editors sit between the panels');

		await page.keyboard.press('Control+`');
		await page.waitForSelector('.studio-shell > .part.panel', { state: 'visible', timeout: 10000 });
		const drawer = await box('.studio-shell > .part.panel');
		const editorWithDrawer = await box('.studio-shell > .part.editor');
		assert(Math.round(drawer.x) === Math.round(textEditor.x) && drawer.y >= editorWithDrawer.y + editorWithDrawer.height, 'Control+` opens the terminal as a drawer below the editor');
		await page.screenshot({ path: path.join(screenshots, 'studio-layout-drawer.png') });
		await runCommand('View: Toggle Panel Visibility');
		await page.waitForTimeout(500);
		assert(!await isShown('.studio-shell > .part.panel'), 'and the drawer hides again');
	};
	const workbenchColor = (name: string) => page.evaluate(variable => getComputedStyle(document.querySelector('.monaco-workbench')!).getPropertyValue(variable).trim().toLowerCase(), `--vscode-${name.replace('.', '-')}`);

	try {
		await setUserSettings({ 'workbench.colorTheme': 'Studio Dark' });
		assert(await workbenchColor('studio.accent') === '#e8c27a', 'Studio Dark sets the studio.* colors');
		assert(await workbenchColor('editor.background') === '#141518', 'and the workbench colors from the Studio tokens');
		const loadedFonts = await page.evaluate(async () => {
			const inter = await document.fonts.load('13px Inter', 'Studio');
			const mono = await document.fonts.load('12px "JetBrains Mono"', 'Studio');
			return { inter: inter.length, mono: mono.length };
		});
		assert(loadedFonts.inter > 0 && loadedFonts.mono > 0, 'the bundled Inter and JetBrains Mono fonts load');
		await page.screenshot({ path: path.join(screenshots, 'studio-dark.png') });

		await setUserSettings({ 'workbench.colorTheme': 'Studio Light' });
		assert(await workbenchColor('studio.ink') === '#8a5d0e', 'Studio Light uses the darker accent for text');
		assert(await workbenchColor('editor.background') === '#ffffff', 'and its own workbench colors');
		await page.screenshot({ path: path.join(screenshots, 'studio-light.png') });

		await checkStudioLayout();
	} finally {
		fs.writeFileSync(userSettingsFile, settingsBefore);
	}
	await browser.close();
})();
