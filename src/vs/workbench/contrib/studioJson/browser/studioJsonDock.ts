/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { localize } from '../../../../nls.js';
import { studioIcon } from '../../studio/browser/studioIcons.js';

const DOCK_BOTTOM_GAP = 12;
const DOCK_HEIGHT = 42;

export interface StudioJsonDockActions {
	filter(query: string): void;
}

/** The bar at the bottom of the JSON text: the filter, then Fold all, Unfold all and Format (VS Code's own actions). */
export class StudioJsonDock extends Disposable implements IOverlayWidget {

	private readonly domNode = $('.studio-json-dock');
	private readonly filterInput: HTMLInputElement;

	constructor(private readonly editor: ICodeEditor, private readonly actions: StudioJsonDockActions) {
		super();
		const filterLabel = append(this.domNode, $('label.studio-json-filter'));
		filterLabel.append(studioIcon('search', 13));
		this.filterInput = append(filterLabel, $('input.studio-json-filter-input', { type: 'text', spellcheck: 'false' })) as HTMLInputElement;
		this.filterInput.placeholder = localize('studioJson.filter', "Filter keys and values");
		this.filterInput.setAttribute('aria-label', localize('studioJson.filter', "Filter keys and values"));
		this._register(addDisposableListener(this.filterInput, EventType.INPUT, () => this.actions.filter(this.filterInput.value)));
		this._register(addDisposableListener(this.filterInput, EventType.KEY_DOWN, event => {
			const isEscape = new StandardKeyboardEvent(event).equals(KeyCode.Escape);
			if (isEscape) {
				event.preventDefault();
				event.stopPropagation();
				this.clearFilter();
				this.editor.focus();
			}
		}));

		append(this.domNode, $('span.studio-json-dock-divider'));
		this.button(localize('studioJson.foldAll', "Fold all"), 'editor.foldAll');
		this.button(localize('studioJson.unfoldAll', "Unfold all"), 'editor.unfoldAll');
		this.button(localize('studioJson.format', "Format"), 'editor.action.formatDocument');

		editor.addOverlayWidget(this);
		this._register(toDisposable(() => editor.removeOverlayWidget(this)));
		this._register(editor.onDidLayoutChange(() => editor.layoutOverlayWidget(this)));
		editor.layoutOverlayWidget(this);
	}

	getId(): string {
		return 'studio.json.dock';
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getPosition(): IOverlayWidgetPosition {
		const layoutInfo = this.editor.getLayoutInfo();
		const dockWidth = this.domNode.offsetWidth;
		const left = Math.max(0, (layoutInfo.width - layoutInfo.minimap.minimapWidth - layoutInfo.verticalScrollbarWidth - dockWidth) / 2);
		return { preference: { top: layoutInfo.height - DOCK_BOTTOM_GAP - DOCK_HEIGHT, left } };
	}

	clearFilter(): void {
		this.filterInput.value = '';
		this.actions.filter('');
	}

	private button(label: string, editorActionId: string): void {
		const button = append(this.domNode, $('button.studio-json-dock-button', { type: 'button' }));
		button.textContent = label;
		this._register(addDisposableListener(button, EventType.CLICK, () => {
			this.editor.focus();
			void this.editor.getAction(editorActionId)?.run();
		}));
	}
}
