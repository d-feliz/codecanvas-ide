/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { localize } from '../../../../nls.js';
import { isJsonContainer, JsonValue, StudioJsonDocument } from '../common/studioJsonDocument.js';

const LONGEST_PREVIEW = 40;

export interface StudioJsonPathBarActions {
	reveal(value: JsonValue): void;
	copyPath(): void;
}

/** The bar above the JSON text: the file name and the keys down to the selected value, the selected value's type and a preview, and Copy path. */
export class StudioJsonPathBar extends Disposable implements IOverlayWidget {

	private readonly domNode = $('.studio-json-path-bar-strip');
	private readonly bar = append(this.domNode, $('.studio-json-path-bar'));
	private readonly crumbs = append(this.bar, $('.studio-json-crumbs'));
	private readonly typeChip = append(this.bar, $('span.studio-json-type-chip'));
	private readonly preview = append(this.bar, $('span.studio-json-preview'));

	constructor(private readonly editor: ICodeEditor, private readonly actions: StudioJsonPathBarActions) {
		super();
		append(this.bar, $('span.studio-json-path-bar-space'));
		const copyButton = append(this.bar, $('button.studio-json-copy-path', { type: 'button' }));
		copyButton.textContent = localize('studioJson.copyPath', "Copy path");
		copyButton.addEventListener('click', () => this.actions.copyPath());
		editor.addOverlayWidget(this);
		this._register(toDisposable(() => editor.removeOverlayWidget(this)));
		this._register(editor.onDidLayoutChange(() => this.layout()));
		this.layout();
	}

	getId(): string {
		return 'studio.json.pathBar';
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getPosition(): IOverlayWidgetPosition {
		return { preference: { top: 0, left: 0 } };
	}

	render(fileName: string, document: StudioJsonDocument, selected: JsonValue | undefined): void {
		clearNode(this.crumbs);
		const ancestors: JsonValue[] = [];
		for (let value = selected; value?.parent; value = value.parent) {
			ancestors.unshift(value);
		}
		const isFileSelected = ancestors.length === 0;
		this.crumb(fileName, isFileSelected, () => document.root && this.actions.reveal(document.root));
		ancestors.forEach((value, index) => {
			// allow-any-unicode-next-line
			append(this.crumbs, $('span.studio-json-crumb-separator')).textContent = '›';
			const label = typeof value.key === 'number' ? `[${value.key}]` : `${value.key}`;
			this.crumb(label, index === ancestors.length - 1, () => this.actions.reveal(value));
		});

		const shown = selected ?? document.root;
		this.typeChip.style.display = shown ? '' : 'none';
		this.preview.style.display = shown ? '' : 'none';
		if (shown) {
			const typeClass = isJsonContainer(shown) ? 'container' : shown.type;
			this.typeChip.className = `studio-json-type-chip studio-json-chip-${typeClass}`;
			this.typeChip.textContent = shown.type;
			this.preview.className = `studio-json-preview studio-json-value-${typeClass}`;
			this.preview.textContent = document.preview(shown, LONGEST_PREVIEW);
		}
	}

	private crumb(label: string, isCurrent: boolean, reveal: () => void): void {
		const crumb = append(this.crumbs, $('button.studio-json-crumb', { type: 'button' }));
		crumb.classList.toggle('studio-json-current-crumb', isCurrent);
		crumb.textContent = label;
		crumb.addEventListener('click', reveal);
	}

	private layout(): void {
		const layoutInfo = this.editor.getLayoutInfo();
		this.domNode.style.width = `${layoutInfo.width - layoutInfo.minimap.minimapWidth - layoutInfo.verticalScrollbarWidth}px`;
	}
}
