/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// End-to-end check of the canvas editor in a running CodeCanvas window. Start the app first:
//   ./scripts/code.sh --user-data-dir .build/dev/user --extensions-dir .build/dev/ext \
//     --remote-debugging-port=9333 --skip-welcome --disable-workspace-trust .build/dev/sample-project
// where .build/dev/sample-project is a copy of codecanvas/apps/playground/src/sample. Then:
//   node test/codecanvas/canvas.e2e.cjs [screenshot folder]
const { chromium } = require('playwright');
const os = require('os');
const path = require('path');

const screenshots = process.argv[2] ?? os.tmpdir();
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
		await page.waitForTimeout(600);
		await page.keyboard.press('Enter');
	};
	const acceptDialogIfShown = async () => {
		const dialog = page.locator('.monaco-dialog-box');
		if (await dialog.count()) {
			await dialog.locator('.monaco-button').first().click();
			await page.waitForTimeout(300);
		}
	};

	const selectBlock = async id => {
		if (!(await isSelected(id))) {
			await block(id).locator('.cc-head').click();
		}
	};
	// Start from no open editors, dropping changes a previous run left unsaved.
	await runCommand('Revert and Close Editor');
	for (let i = 0; i < 5 && await page.locator('.tabs-container .tab').count(); i++) {
		await runCommand('Revert and Close Editor');
		await page.waitForTimeout(300);
	}

	// open as canvas from the text editor
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
	await page.screenshot({ path: path.join(screenshots, 'canvas-opened.png') });

	// edit a block in Monaco
	await block('Cart/total').locator('.cc-head').click();
	assert(await isSelected('Cart/total'), 'click selects a block');
	await block('Cart/total').locator('.cc-head').click();
	await page.waitForSelector(`${canvas} .cc-editor .monaco-editor .view-lines`, { timeout: 10000 });
	assert(true, 'clicking the selected block opens it in Monaco');
	await page.locator(`${canvas} .cc-editor .monaco-editor .view-lines`).click();
	await page.keyboard.press('Meta+ArrowUp');
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('const marker = 1;');
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
	for (let i = 0; i < 30 && (await block('Cart/total').locator('.cc-prev').innerText()).includes('marker'); i++) {
		await page.keyboard.press('Meta+z');
		await page.waitForTimeout(60);
	}
	assert(!(await block('Cart/total').locator('.cc-prev').innerText()).includes('marker'), 'undo on the canvas reverts the edit');

	// jump to a block in another file
	await selectBlock('Cart/total');
	await page.locator(`${canvas} .cc-bar button:has-text("Refs")`).click();
	await page.waitForTimeout(300);
	const refs = await page.locator(`${canvas} .cc-refs`).innerText();
	assert(refs.includes('pricing.ts ›') && refs.includes('applyDiscount'), 'refs list shows blocks in other files');
	await page.locator(`${canvas} .cc-refs button:has-text("applyDiscount")`).click();
	await page.waitForSelector(`${canvas} .cc-block[data-id="applyDiscount"].cc-sel`, { timeout: 15000 });
	assert((await activeTab().innerText()).includes('pricing.ts'), 'clicking it opens that file as a canvas, with the block selected');

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

	console.log('page errors', JSON.stringify(errors));
	await browser.close().catch(() => { });
})();
