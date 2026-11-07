/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// End-to-end check of the canvas editor in a running CodeCanvas window, on the project that
// run.ts prepares (the CodeCanvas sample, plus a tsconfig.json path alias). Run it through run.ts.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium } from 'playwright';

const screenshots = process.argv[2] ?? os.tmpdir();
const projectFolder = process.argv[3];
const cartLayoutFile = projectFolder && path.join(projectFolder, '.codecanvas', 'cart.ts.json');
const assert = (condition, message) => {
	console.log(condition ? 'ok:' : 'FAIL:', message);
	if (!condition) {
		process.exitCode = 1;
	}
};

(async () => {
	const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
	const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('workbench'));
	const errors = [];
	page.on('pageerror', e => errors.push(e.message));
	page.on('console', m => m.type() === 'error' && !m.text().includes('AgentHost') && errors.push(m.text().slice(0, 300)));
	await page.waitForSelector('.monaco-workbench', { timeout: 60000 });

	const canvas = '.code-canvas-editor';
	const block = id => page.locator(`${canvas} .cc-block[data-id="${id}"]`);
	const isSelected = id => block(id).evaluate(e => e.classList.contains('cc-sel'));
	const activeTab = () => page.locator('.tabs-container .tab.active');
	const isActiveTabDirty = () => activeTab().evaluate(e => e.classList.contains('dirty'));
	const runCommand = async text => {
		await page.keyboard.press('Meta+Shift+P');
		await page.waitForSelector('.quick-input-widget input');
		await page.keyboard.type(text);
		await page.waitForSelector(`.quick-input-list .monaco-list-row.focused:has-text("${text}")`, { timeout: 5000 }).catch(() => { });
		await page.keyboard.press('Enter');
	};
	const openFile = async name => {
		await page.keyboard.press('Meta+P');
		await page.waitForSelector('.quick-input-widget input');
		await page.keyboard.type(name);
		await page.waitForSelector(`.quick-input-list .monaco-list-row.focused[aria-label*="${name}"]`, { timeout: 15000 }).catch(() => { });
		await page.keyboard.press('Enter');
	};
	const acceptDialogIfShown = async () => {
		const dialog = page.locator('.monaco-dialog-box');
		if (await dialog.count()) {
			await dialog.locator('.monaco-button').first().click();
			await page.waitForTimeout(300);
		}
	};

	// Files open at 100%, so the block may be out of view: zoom out to the whole file first.
	const selectBlock = async id => {
		if (!(await isSelected(id))) {
			await page.locator(`${canvas} .cc-dock button:text-is("Fit")`).click();
			await page.waitForTimeout(400);
			await block(id).locator('.cc-head').click();
		}
	};
	// Start from no open editors, dropping changes a previous run left unsaved.
	await runCommand('Revert and Close Editor');
	for (let i = 0; i < 5 && await page.locator('.tabs-container .tab').count(); i++) {
		await runCommand('Revert and Close Editor');
		await page.waitForTimeout(300);
	}

	// TypeScript files open as a canvas
	await openFile('cart.ts');
	const isCanvasShown = await page.waitForSelector(`${canvas} .cc-block`, { timeout: 10000 }).then(() => true, () => false);
	assert(isCanvasShown, 'TypeScript files open as a canvas by default');
	if (isCanvasShown) {
		await page.click('.editor-actions [aria-label*="Open as Text"]');
	}
	await page.waitForSelector('.monaco-editor .view-lines');

	// Go to Definition from the text opens the other file as a canvas, at that block
	await page.locator('.editor-instance .monaco-editor .view-lines').first().click();
	await page.keyboard.press('Control+g');
	await page.keyboard.type('37:24');
	await page.keyboard.press('Enter');
	await page.waitForTimeout(300);
	await page.keyboard.press('F12');
	const isDefinitionSelected = await page.waitForSelector(`${canvas} .cc-block[data-id="applyDiscount"].cc-sel`, { timeout: 20000 }).then(() => true, () => false);
	assert(isDefinitionSelected && (await activeTab().innerText()).includes('pricing.ts'), 'Go to Definition opens the canvas with the definition selected');

	// open as canvas from the text editor (Quick Open reopens cart.ts as text, the way it was last shown)
	await openFile('cart.ts');
	await page.waitForSelector('.monaco-editor .view-lines');
	const hasCanvasButton = await page.waitForSelector('.editor-actions [aria-label*="Open as Canvas"]', { timeout: 10000 }).then(() => true, () => false);
	assert(hasCanvasButton, 'text editor shows the Open as Canvas button');
	await page.click('.editor-actions [aria-label*="Open as Canvas"]');
	await page.waitForSelector(`${canvas} .cc-block`, { timeout: 30000 });
	await page.waitForTimeout(1500);
	assert(await page.locator(`${canvas} .cc-block`).count() >= 10, 'canvas shows the file as blocks');
	assert(await page.locator(`${canvas} .cc-edge`).count() > 0, 'and usage lines');
	assert(await page.locator('.editor-actions [aria-label*="Open as Text"]').count() === 1, 'canvas shows the Open as Text button');
	await page.waitForTimeout(800);
	assert(!fs.existsSync(path.join(projectFolder, '.codecanvas')), 'opening a canvas adds no files to the repo');
	const isEmptyBox = await block('isEmpty').boundingBox();
	await page.mouse.move(isEmptyBox.x + 30, isEmptyBox.y + 10);
	await page.mouse.down();
	for (let step = 1; step <= 8; step++) {
		await page.mouse.move(isEmptyBox.x + 30 + step * 10, isEmptyBox.y + 10 + step * 8);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();
	await page.waitForTimeout(1000);
	const savedLayout = fs.existsSync(cartLayoutFile) ? JSON.parse(fs.readFileSync(cartLayoutFile, 'utf8')) : undefined;
	assert(savedLayout?.blocks?.isEmpty, 'moving a block saves the layout to .codecanvas/');
	await page.screenshot({ path: path.join(screenshots, 'canvas-opened.png') });
	const debugTargets = await (await fetch('http://127.0.0.1:9333/json')).json();
	assert(debugTargets.some(target => target.type === 'worker' && target.title === 'CodeCanvasProjectWorker'), 'usage links are resolved in a worker');

	// edit a block in Monaco
	await block('Cart/total').locator('.cc-head').click();
	assert(await isSelected('Cart/total'), 'click selects a block');
	await block('Cart/total').locator('.cc-head').click();
	await page.waitForSelector(`${canvas} .cc-editor .monaco-editor .view-lines`, { timeout: 10000 });
	assert(true, 'clicking the selected block opens it in Monaco');
	const blockEditor = `${canvas} .cc-editor .monaco-editor`;
	const totalPreviewBefore = await block('Cart/total').locator('.cc-prev').innerText();
	const shownLineNumbers = await page.locator(`${blockEditor} .line-numbers`).allInnerTexts();
	assert(shownLineNumbers[0] === '36' && shownLineNumbers.length <= 6, `the block editor shows only the block's lines of the file (${shownLineNumbers.join(',')})`);
	await page.locator(`${blockEditor} .view-lines`).click();
	await page.keyboard.press('Meta+ArrowUp');
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('const marker = 1;');
	await page.waitForTimeout(100);
	assert((await block('Cart/total').locator('.cc-prev').innerText()).startsWith('const marker = 1;'), 'Cmd+Up stays inside the block');
	await page.keyboard.press('Enter');
	await page.keyboard.type('const wrong: string = this.');
	// A method icon means TypeScript answered, not word-based completion (the word is in the file too).
	const suggestsSubtotal = await page.waitForSelector(`.suggest-widget .monaco-list-row[aria-label*="subtotal"] .codicon-symbol-method`, { timeout: 30000 }).then(() => true, () => false);
	assert(suggestsSubtotal, 'IntelliSense in the block editor suggests Cart members (from TypeScript)');
	await page.keyboard.press('Escape');
	await page.keyboard.type('subtotal();');
	const hasSquiggle = await page.waitForSelector(`${blockEditor} .squiggly-error`, { timeout: 30000 }).then(() => true, () => false);
	assert(hasSquiggle, 'type errors are underlined in the block editor');
	const hasBadge = await page.waitForSelector(`${canvas} .cc-block[data-id="Cart/total"] .cc-err`, { timeout: 10000 }).then(() => true, () => false);
	assert(hasBadge, 'and marked on the block, from VS Code\'s Problems');
	await page.waitForTimeout(300);
	assert(!(await page.locator(`${canvas} .cc-bar`).isVisible()), 'the canvas toolbar hides while a block is edited');
	await page.screenshot({ path: path.join(screenshots, 'canvas-block-editor.png') });
	await page.keyboard.press('Escape');
	await page.waitForTimeout(200);
	assert(!(await page.locator(`${canvas} .cc-editor`).count()), 'Escape closes the block editor');
	assert(await isSelected('Cart/total'), 'and keeps the block selected');
	assert((await block('Cart/total').locator('.cc-prev').innerText()).includes('const marker = 1;'), 'the edit shows in the block preview');
	assert(await isActiveTabDirty(), 'the edit made the file dirty (same document as the text editor)');

	// undo goes through the document
	await page.locator(`${canvas} .cc-root`).focus();
	for (let i = 0; i < 80 && (await block('Cart/total').locator('.cc-prev').innerText()) !== totalPreviewBefore; i++) {
		await page.keyboard.press('Meta+z');
		await page.waitForTimeout(60);
	}
	assert((await block('Cart/total').locator('.cc-prev').innerText()) === totalPreviewBefore, 'undo on the canvas reverts the edit');
	const badgeCleared = await page.waitForSelector(`${canvas} .cc-block[data-id="Cart/total"] .cc-err`, { state: 'detached', timeout: 15000 }).then(() => true, () => false);
	assert(badgeCleared, 'and the error marker goes away');

	// jump to a block in another file
	await selectBlock('Cart/total');
	await page.locator(`${canvas} .cc-selbar .cc-refs-toggle`).click();
	await page.waitForTimeout(300);
	const refs = await page.locator(`${canvas} .cc-refs`).innerText();
	assert(refs.includes('pricing.ts ›') && refs.includes('applyDiscount'), 'refs list shows blocks in other files');
	await page.locator(`${canvas} .cc-refs button:has-text("applyDiscount")`).click();
	await page.waitForSelector(`${canvas} .cc-block[data-id="applyDiscount"].cc-sel`, { timeout: 15000 });
	assert((await activeTab().innerText()).includes('pricing.ts'), 'clicking it opens that file as a canvas, with the block selected');
	await page.locator(`${canvas} .cc-selbar .cc-refs-toggle`).click();
	const pricingRefs = await page.locator(`${canvas} .cc-refs`).innerText();
	assert(pricingRefs.includes('checkout.ts ›'), 'imports through a tsconfig.json path alias are linked');

	// a workspace package, imported by name and re-exported through its index.ts with its own alias
	await openFile('receiptFormat.ts');
	await page.waitForSelector(`${canvas} .cc-block[data-id="formatReceipt"]`, { timeout: 15000 });
	await selectBlock('formatReceipt');
	await page.locator(`${canvas} .cc-selbar .cc-refs-toggle`).click();
	const packageRefsLinked = await page.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes('checkout.ts'), `${canvas} .cc-refs`, { timeout: 10000 }).then(() => true, () => false);
	assert(packageRefsLinked, 'a block of a workspace package lists its usages in the files that import the package by name');

	// JavaScript files open as a canvas too, linked to the TypeScript files they import
	await openFile('shipping.js');
	const shippingOpensAsCanvas = await page.waitForSelector(`${canvas} .cc-block[data-id="shippingCost"]`, { timeout: 15000 }).then(() => true, () => false);
	assert(shippingOpensAsCanvas, 'a JavaScript file opens as a canvas');
	await selectBlock('shippingCost');
	await page.locator(`${canvas} .cc-selbar .cc-refs-toggle`).click();
	const javaScriptRefsLinked = await page.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes('math.ts'), `${canvas} .cc-refs`, { timeout: 10000 }).then(() => true, () => false);
	assert(javaScriptRefsLinked, 'and its usages link to blocks in TypeScript files');

	// React files: the language label, component and state blocks
	await openFile('CartPage.tsx');
	const reactOpensWithComponents = await page.waitForSelector(`${canvas} .cc-block.k-component[data-id="CartPage"]`, { timeout: 15000 }).then(() => true, () => false);
	assert(reactOpensWithComponents, 'a React file shows its components as component blocks');
	assert(await page.locator(`${canvas} .cc-block.k-state[data-id="CartPage/coupon"]`).count() === 1, 'and its useState as a state block');
	assert((await page.locator(`${canvas} .cc-bar .cc-language`).innerText()) === 'React TSX', 'the canvas toolbar says React TSX');
	await page.screenshot({ path: path.join(screenshots, 'canvas-react.png') });

	await openFile('pricing.ts');
	await page.waitForSelector(`${canvas} .cc-block[data-id="applyDiscount"]`, { timeout: 15000 });
	await selectBlock('applyDiscount');

	// rename across files
	await page.keyboard.press('F2');
	await page.waitForSelector(`${canvas} .cc-rename`);
	await page.keyboard.type('discountedAmount');
	await page.keyboard.press('Enter');
	await page.waitForSelector(`${canvas} .cc-block[data-id="discountedAmount"]`, { timeout: 10000 });
	assert(true, 'F2 renames the block');
	await page.screenshot({ path: path.join(screenshots, 'canvas-renamed.png') });
	await openFile('cart.ts');
	await page.waitForSelector(`${canvas} .cc-block[data-id="Cart/total"]`);
	await page.waitForTimeout(500);
	assert((await block('Cart/total').locator('.cc-prev').innerText()).includes('discountedAmount('), 'and its usages in other files');

	// undo of the rename covers both files
	await page.locator(`${canvas} .cc-root`).focus();
	await page.keyboard.press('Meta+z');
	await page.waitForTimeout(400);
	await acceptDialogIfShown();
	await page.waitForTimeout(400);
	assert((await block('Cart/total').locator('.cc-prev').innerText()).includes('applyDiscount('), 'undo reverts the rename here');
	await openFile('pricing.ts');
	await page.waitForTimeout(600);
	assert(await block('applyDiscount').count() === 1, 'and in the other file');

	// save
	await page.keyboard.press('Meta+s');
	await page.waitForTimeout(500);
	assert(!(await isActiveTabDirty()), 'Cmd+S saves the file from the canvas');

	// changes since the last commit
	await openFile('cart.ts');
	await page.waitForSelector(`${canvas} .cc-block[data-id="Cart/total"]`);
	await page.waitForTimeout(500);
	await selectBlock('Cart/total');
	await block('Cart/total').locator('.cc-head').click();
	await page.waitForSelector(`${canvas} .cc-editor .monaco-editor .view-lines`);
	await page.locator(`${canvas} .cc-editor .monaco-editor .view-lines`).click();
	await page.keyboard.press('Meta+ArrowUp');
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('const tax = 0;');
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);
	await selectBlock('isEmpty');
	await page.keyboard.press('Delete');
	await page.waitForTimeout(300);
	await page.click('.editor-actions [aria-label*="Show Changes"]');
	await page.waitForSelector(`${canvas} .cc-diff-changed`, { timeout: 10000 }).catch(() => { });
	const hasDiffClass = (id: string, name: string) => block(id).evaluate((element, className) => element.classList.contains(className), name);
	assert(await hasDiffClass('Cart/total', 'cc-diff-changed') && await block('Cart/total').locator('.cc-diff-chip.changed').count() === 1, 'Show Changes marks the edited block as changed');
	assert(await hasDiffClass('Cart/add', 'cc-diff-unchanged'), 'and untouched blocks as unchanged');
	assert(/\+\s+const tax = 0;/.test(await block('Cart/total').locator('.cc-diff-prev').innerText()), 'the changed block previews its new line');
	assert(await page.locator(`${canvas} .cc-diff-removed[title^="isEmpty"]`).count() === 1, 'a deleted block shows as removed');
	await page.screenshot({ path: path.join(screenshots, 'canvas-changes.png') });
	await selectBlock('Cart/total');
	await block('Cart/total').locator('.cc-head').click();
	await page.waitForSelector(`${canvas} .cc-editor .monaco-diff-editor`, { timeout: 10000 }).catch(() => { });
	const insertedLines = await page.locator(`${canvas} .cc-editor .monaco-diff-editor .line-insert`).count();
	assert(insertedLines > 0, 'the block editor shows an inline diff against the commit');
	await page.screenshot({ path: path.join(screenshots, 'canvas-changes-editor.png') });
	await page.keyboard.press('Escape');
	await page.click('.editor-actions [aria-label*="Hide Changes"], .editor-actions [aria-label*="Show Changes"]');
	await page.waitForTimeout(300);
	assert(await page.locator(`${canvas} [class*="cc-diff-"]`).count() === 0, 'hiding changes restores the normal view');

	// a merge conflict (run.ts merged two branches that both changed discounts.ts)
	await openFile('discounts.ts');
	await page.waitForSelector(`${canvas} .cc-block[data-id="seasonalDiscount"]`, { timeout: 20000 });
	await page.waitForTimeout(500);
	assert((await page.locator(`${canvas} .cc-banner:not([hidden])`).innerText()).includes('merge conflict'), 'a file with merge conflicts shows them instead of pausing');
	assert(await block('seasonalDiscount').locator('.cc-conflict-chip').count() === 1, 'the conflicted block is marked !');
	assert(await page.locator(`${canvas} .cc-err`).count() === 0, 'errors about the conflict markers themselves are not shown');
	await page.screenshot({ path: path.join(screenshots, 'canvas-conflict.png') });
	await selectBlock('seasonalDiscount');
	await page.locator(`${canvas} .cc-selbar button:has-text("Edit")`).click();
	await page.waitForSelector(`${canvas} .cc-editor .monaco-editor .view-lines`);
	// Monaco draws spaces as no-break spaces.
	const conflictEditorText = (await page.locator(`${canvas} .cc-editor .view-lines`).innerText()).replace(/\u00a0/g, ' ');
	assert(conflictEditorText.includes('<<<<<<<') && conflictEditorText.includes('>>>>>>> sale'), 'Edit shows the conflict markers');
	const hasAcceptLenses = await page.waitForSelector(`${canvas} .cc-editor .codelens-decoration a:has-text("Accept")`, { timeout: 15000 }).then(() => true, () => false);
	assert(hasAcceptLenses, 'the block editor shows the Accept Current / Incoming links of VS Code');
	await page.screenshot({ path: path.join(screenshots, 'canvas-conflict-editor.png') });
	await page.keyboard.press('Escape');
	await page.waitForTimeout(200);
	await selectBlock('seasonalDiscount');
	await page.locator(`${canvas} .cc-selbar button:has-text("Keep incoming")`).click();
	await page.waitForTimeout(500);
	assert(await page.locator(`${canvas} .cc-banner[hidden]`).count() === 1 && await page.locator(`${canvas} .cc-conflict`).count() === 0, 'Keep incoming resolves the conflict');
	assert(/amount \* 0\.8/.test(await block('seasonalDiscount').locator('.cc-prev').innerText()), 'the block now has the code of the incoming side');

	console.log('page errors', JSON.stringify(errors));
	await browser.close().catch(() => { });
})();
