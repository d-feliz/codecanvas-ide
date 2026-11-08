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

	const workbenchColor = (name: string) => page.evaluate(variable => getComputedStyle(document.querySelector('.monaco-workbench')!).getPropertyValue(variable).trim().toLowerCase(), `--vscode-${name.replace('.', '-')}`);

	// The layout style is read when the window opens, so this switches it and reloads the window.
	const checkStudioLayout = async () => {
		// No layout or theme setting: the defaults.
		await setUserSettings({ 'workbench.colorTheme': undefined, 'workbench.layoutStyle': undefined });
		await runCommand('Developer: Reload Window');
		await page.waitForSelector('.monaco-workbench.studio-layout .studio-shell', { timeout: 60000 });
		await page.waitForTimeout(4000);
		const window = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
		assert(await isShown('.studio-shell'), 'Studio layout: by default the window uses the Studio shell');
		assert(await workbenchColor('editor.background') === '#141518', 'and the Studio Dark theme');

		// A file the canvas checks never opened, so nothing brings back an earlier position in it.
		await openFile('catalog.ts');
		await page.waitForSelector('.code-canvas-editor .cc-block', { timeout: 30000 });
		const leftPanel = await box('.studio-shell > .part.sidebar');
		const frame = await box('.code-canvas-editor .cc-frame');
		const openingZoom = await page.locator('.code-canvas-editor .cc-zoom').innerText();
		assert(openingZoom === '100%' && frame.x >= leftPanel.x + leftPanel.width, `a file opens at 100%, beside the left panel, not under it (${openingZoom}, file at x ${Math.round(frame.x)})`);

		await openFile('cart.ts');
		await page.waitForSelector('.code-canvas-editor .cc-block[data-id="Cart"]', { timeout: 30000 });
		const sideBar = await box('.studio-shell > .part.sidebar');
		assert(Math.round(sideBar.x) === 12 && Math.round(sideBar.y) === 60, 'the left panel floats 12px from the window edge, below the top bar');
		assert(!await isShown('.studio-shell > .part.titlebar') && !await isShown('.studio-shell > .part.activitybar') && !await isShown('.part.editor .tabs-container'), 'VS Code\'s title bar, activity bar and editor tabs are hidden');
		assert(await isShown('.studio-shell > .part.sidebar .composite-bar-container'), 'the view icons are on top of the left panel');
		const footer = await box('.studio-shell > .studio-left-panel-footer');
		assert(Math.round(footer.x) === 12 && Math.round(footer.y) === Math.round(sideBar.y + sideBar.height), 'the left panel ends in a footer');
		assert(await isShown('.studio-left-panel-footer .codicon-settings-view-bar-icon') && await isShown('.studio-left-panel-footer .codicon-accounts-view-bar-icon'), 'with the account and the Manage menu');

		const topBarText = (selector: string) => page.locator(`.studio-top-bar ${selector}`).first().innerText();
		assert(await topBarText('.studio-project-name') === 'sample-project', 'the top bar shows the project');
		assert((await topBarText('.studio-branch')).trim() === 'main', 'and its branch');
		assert(await isShown('.studio-top-bar .studio-go-to-anything'), 'and Go to anything');
		assert((await topBarText('.studio-open-file.studio-active')).includes('cart.ts') && await page.locator('.studio-top-bar .studio-open-file').count() > 1, 'the open files are pills, the active one marked');
		assert((await topBarText('.studio-segment.studio-active')) === 'Canvas', 'the view switch shows Canvas for a canvas');
		const projectButton = await box('.studio-top-bar .studio-project');
		assert(Math.round(projectButton.y) === 12 && Math.round(projectButton.height) === 36, 'the top bar buttons are 36px high, 12px from the top');

		await page.keyboard.press('Meta+k');
		await page.waitForSelector('.quick-input-widget .quick-input-list-separator', { timeout: 5000 });
		const groupHeaders = (await page.locator('.quick-input-widget .quick-input-list-separator').allInnerTexts()).map(text => text.toLowerCase());
		// Only the rows in view are rendered, so the Actions group further down isn't checked here.
		assert(groupHeaders.includes('nodes in this file') && groupHeaders.includes('files'), '⌘K opens Go to anything, with the file\'s nodes and files');
		assert(Math.round((await box('.quick-input-widget')).y) === 96, 'below the top bar');
		await page.keyboard.type('useCoupon');
		await page.waitForTimeout(500);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(800);
		assert(await page.locator('.code-canvas-editor .cc-block[data-id="Cart/useCoupon"]').evaluate(e => e.classList.contains('cc-sel')), 'picking a node selects it on the canvas');
		await page.keyboard.press('Meta+k');
		await page.waitForSelector('.quick-input-widget .quick-input-list-separator', { timeout: 5000 });
		await page.keyboard.type('>');
		await page.waitForTimeout(800);
		const commandRows = await page.locator('.quick-input-widget .quick-input-list .monaco-list-row').count();
		assert((await page.locator('.quick-input-widget input').inputValue()) === '>' && commandRows > 10, 'typing > there lists all commands');
		await page.keyboard.press('Escape');

		await page.keyboard.press('Meta+Quote');
		await page.keyboard.press('Meta+s');
		const shortcutsOpened = await page.waitForSelector('.keybindings-editor', { timeout: 10000 }).then(() => true, () => false);
		assert(shortcutsOpened, 'VS Code\'s ⌘K chords start with ⌘\' instead: ⌘\' ⌘S opens Keyboard Shortcuts');
		await page.keyboard.press('Meta+w');
		await page.waitForTimeout(800);
		const editor = await box('.studio-shell > .part.editor');
		assert(Math.round(editor.x) === 0 && Math.round(editor.width) === window.width, 'a canvas lies under the floating panels');
		const functionGlyph = await page.locator('.code-canvas-editor .cc-block.k-function .cc-glyph').first().evaluate(e => getComputedStyle(e).backgroundColor);
		assert(functionGlyph === 'rgb(169, 139, 240)', 'blocks take their kind color from the Studio theme');
		const dock = await box('.code-canvas-editor .cc-dock');
		const freeRight = await isShown('.studio-shell > .part.auxiliarybar') ? (await box('.studio-shell > .part.auxiliarybar')).x : window.width;
		const freeCenter = (sideBar.x + sideBar.width + freeRight) / 2;
		assert(Math.abs(dock.x + dock.width / 2 - freeCenter) < 2, 'the canvas dock is centered in the area the panels leave free');
		const leftPill = await box('.studio-shell > .part.statusbar > .left-items');
		const rightPill = await box('.studio-shell > .part.statusbar > .right-items');
		assert(Math.round(leftPill.x) === 12 && Math.round(rightPill.x + rightPill.width) === window.width - 12 && leftPill.x + leftPill.width < rightPill.x, 'the status bar is two pills in the bottom corners');
		await page.locator('.code-canvas-editor .cc-root').focus();
		const canvasOutline = await page.locator('.code-canvas-editor .cc-root').evaluate(e => getComputedStyle(e).outlineStyle);
		assert(canvasOutline === 'none', 'the focused canvas draws no focus outline around the window');
		await page.screenshot({ path: path.join(screenshots, 'studio-layout-canvas.png') });

		await page.locator('.studio-top-bar .studio-segment:text-is("Code")').click();
		await page.waitForSelector('.part.editor .monaco-editor .view-lines', { timeout: 10000 });
		assert((await topBarText('.studio-segment.studio-active')) === 'Code' && !await isShown('.code-canvas-editor'), 'Code switches the file to the text editor');
		// Reopening cart.ts brings back its scroll position, so this takes the first chip in view.
		const laneChip = page.locator('.part.editor .code-canvas-block-lane .code-canvas-lane-chip').first();
		await laneChip.waitFor({ timeout: 15000 }).catch(() => { });
		const chipBox = await laneChip.boundingBox();
		const chipBlockName = (await laneChip.getAttribute('data-block-id') ?? '').split('/').pop()!;
		const codeText = await box('.part.editor .monaco-editor .view-lines');
		assert(!!chipBox && !!chipBlockName && (await laneChip.innerText()).includes(chipBlockName) && chipBox.x + chipBox.width < codeText.x, 'the Code view has a block lane: a chip with the glyph and name at each block, left of the code');
		await laneChip.click();
		await page.waitForTimeout(300);
		assert(await page.locator('.part.editor .monaco-editor .code-canvas-selected-block-line').count() > 0, 'a click on a chip tints the block\'s lines');

		await page.locator('.studio-top-bar .studio-segment:text-is("Canvas")').click();
		await page.waitForSelector('.code-canvas-editor .cc-block', { timeout: 10000 });
		const selectSubtotalOnCanvas = async () => {
			await page.keyboard.press('Meta+k');
			await page.waitForSelector('.quick-input-widget .quick-input-list-separator', { timeout: 5000 });
			await page.keyboard.type('subtotal');
			await page.waitForTimeout(500);
			await page.keyboard.press('Enter');
			await page.waitForTimeout(800);
		};
		await selectSubtotalOnCanvas();
		await page.locator('.code-canvas-editor .cc-selbar button:text-is("Open code")').click();
		const subtotalChip = page.locator('.part.editor .code-canvas-lane-chip.code-canvas-lane-selected[data-block-id="Cart/subtotal"]');
		await subtotalChip.waitFor({ timeout: 15000 }).catch(() => { });
		const subtotalChipBox = await subtotalChip.boundingBox();
		const cursorLine = await page.locator('.part.editor .monaco-editor .view-overlays .current-line').first().boundingBox();
		const cursorIsOnSubtotal = !!subtotalChipBox && !!cursorLine && Math.abs(subtotalChipBox.y + subtotalChipBox.height / 2 - (cursorLine.y + cursorLine.height / 2)) < cursorLine.height / 2;
		assert((await topBarText('.studio-segment.studio-active')) === 'Code' && cursorIsOnSubtotal, 'Open code on a block opens the Code view with the cursor at the block, its lines tinted');
		await page.screenshot({ path: path.join(screenshots, 'studio-layout-code.png') });
		await page.locator('.studio-top-bar .studio-segment:text-is("Canvas")').click();
		await page.waitForSelector('.code-canvas-editor .cc-block', { timeout: 10000 });

		await page.keyboard.press('Meta+k');
		await page.waitForSelector('.quick-input-widget .quick-input-list-separator', { timeout: 5000 });
		await page.keyboard.type('add function');
		await page.waitForTimeout(500);
		assert(await page.locator('.quick-input-widget .monaco-list-row:has-text("Add function")').count() === 1, 'and Add function');
		await page.keyboard.press('Escape');

		await selectSubtotalOnCanvas();
		await page.locator('.code-canvas-editor .cc-selbar button:text-is("Ask")').click();
		await page.waitForSelector('.studio-shell > .part.auxiliarybar .interactive-input-part', { state: 'visible', timeout: 10000 }).catch(() => { });
		const chatInput = await page.locator('.studio-shell > .part.auxiliarybar .interactive-input-part .view-lines').first().innerText().catch(() => '');
		// Monaco shows spaces as no-break spaces.
		assert(chatInput.replace(/\u00a0/g, ' ').includes('Explain subtotal'), 'Ask on a block opens the Assistant about it');

		await page.locator('.studio-top-bar .studio-segment:text-is("Code")').click();
		await page.waitForSelector('.part.editor .monaco-editor .view-lines', { timeout: 10000 });
		await page.locator('.studio-top-bar .studio-segment:text-is("Canvas")').click();
		await page.waitForSelector('.code-canvas-editor .cc-block', { timeout: 10000 });
		assert((await topBarText('.studio-segment.studio-active')) === 'Canvas', 'and Canvas back to the canvas');

		if (!await isShown('.studio-shell > .part.auxiliarybar')) {
			await page.locator('.studio-top-bar button[aria-label="Toggle Assistant"]').click();
			await page.waitForTimeout(1000);
		}
		assert(await isShown('.studio-shell > .part.auxiliarybar') && (await page.locator('.studio-assistant-header .studio-assistant-title').innerText()) === 'Assistant', 'the assistant button opens the Assistant, with its own header');
		await page.locator('.studio-assistant-header button[aria-label="Close Assistant"]').click();
		await page.waitForTimeout(500);
		assert(!await isShown('.studio-shell > .part.auxiliarybar'), 'and its × closes it');
		await page.locator('.studio-top-bar button[aria-label="Toggle Assistant"]').click();
		await page.waitForTimeout(500);

		await page.locator('.studio-top-bar button[aria-label="Switch between the light and dark theme"]').click();
		await page.waitForTimeout(1500);
		assert(await workbenchColor('studio.ink') === '#8a5d0e', 'the theme button switches to Studio Light');
		await page.screenshot({ path: path.join(screenshots, 'studio-layout-light.png') });
		await page.locator('.studio-top-bar button[aria-label="Switch between the light and dark theme"]').click();
		await page.waitForTimeout(1500);
		assert(await workbenchColor('studio.ink') === '#e8c27a', 'and back to Studio Dark');

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
