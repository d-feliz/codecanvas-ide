/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { isJsonContainer, JsonValue, JsonValueType, StudioJsonDocument } from '../common/studioJsonDocument.js';
import { getActiveJsonEditor, onDidChangeActiveJsonEditor } from './studioJsonEditors.js';

export const STUDIO_JSON_STRUCTURE_VIEW_ID = 'studio.json.structure';
export const STUDIO_JSON_STRUCTURE_VIEW_TITLE = localize2('studioJson.structure', "Structure");

const TYPE_GLYPHS: Record<JsonValueType, string> = {
	string: '"',
	number: '#',
	// allow-any-unicode-next-line
	boolean: '◐',
	// allow-any-unicode-next-line
	null: '∅',
	object: '{}',
	array: '[]',
};

/** One row per top-level key of the active JSON file, with the number of values under it. */
export class StudioJsonStructureView extends ViewPane {

	private list: HTMLElement | undefined;
	private readonly activeEditorListener = this._register(new MutableDisposable());

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(onDidChangeActiveJsonEditor(() => this.followActiveEditor()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.list = append(container, $('.studio-json-structure'));
		this.followActiveEditor();
	}

	private followActiveEditor(): void {
		this.activeEditorListener.value = getActiveJsonEditor()?.onDidChange(() => this.renderRows());
		this.renderRows();
	}

	private renderRows(): void {
		if (!this.list) {
			return;
		}
		clearNode(this.list);
		const jsonEditor = getActiveJsonEditor();
		const document = jsonEditor?.getDocument();
		const listed = document ? listedContainer(document) : undefined;
		this.updateTitleDescription(listed?.parent ? `${listed.key}` : undefined);
		if (!jsonEditor || !listed) {
			return;
		}
		const selectedPath = jsonEditor.getSelectedValue()?.path ?? [];
		const listedDepth = listed.path.length;
		for (const value of listed.children) {
			const isSelected = selectedPath.length > listedDepth && selectedPath[listedDepth] === value.key && listed.path.every((segment, index) => selectedPath[index] === segment);
			const row = append(this.list, $('button.studio-json-structure-row', { type: 'button' }));
			row.classList.toggle('studio-json-structure-selected', isSelected);
			const glyph = append(row, $(`span.studio-json-structure-glyph.studio-json-value-${isJsonContainer(value) ? 'container' : value.type}`));
			glyph.textContent = TYPE_GLYPHS[value.type];
			append(row, $('span.studio-json-structure-key')).textContent = typeof value.key === 'number' ? `[${value.key}]` : `${value.key}`;
			append(row, $('span.studio-json-structure-count')).textContent = isJsonContainer(value) ? `${plainValueCount(value)}` : '';
			row.addEventListener('click', () => jsonEditor.reveal(value));
		}
	}
}

/** The root, or the one object inside it when the file wraps everything in a single key (like Expo's `"expo"`). */
function listedContainer(document: StudioJsonDocument): JsonValue | undefined {
	const root = document.root;
	if (!root || !isJsonContainer(root)) {
		return undefined;
	}
	const onlyChild = root.type === 'object' && root.children.length === 1 ? root.children[0] : undefined;
	return onlyChild?.type === 'object' ? onlyChild : root;
}

function plainValueCount(value: JsonValue): number {
	return isJsonContainer(value) ? value.children.reduce((count, child) => count + plainValueCount(child), 0) : 1;
}
