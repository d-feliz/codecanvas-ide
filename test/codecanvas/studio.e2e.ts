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
	} finally {
		fs.writeFileSync(userSettingsFile, settingsBefore);
	}
	await browser.close();
})();
