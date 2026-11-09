/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { IModelDeltaDecoration, ITextModel } from '../../../../editor/common/model.js';
import { FoldingController } from '../../../../editor/contrib/folding/browser/folding.js';
import { FoldingModel } from '../../../../editor/contrib/folding/browser/foldingModel.js';
import { localize } from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { dottedPath, isJsonContainer, JsonValue, StudioJsonDocument } from '../common/studioJsonDocument.js';
import { StudioJsonDock } from './studioJsonDock.js';
import { StudioJsonPathBar } from './studioJsonPathBar.js';

export const JSON_LANGUAGE_IDS = ['json', 'jsonc'];

/** Parsing waits until typing pauses, so it never slows typing down. */
const PARSE_DELAY_MS = 150;
const PATH_BAR_ROOM = 48;
const DOCK_ROOM = 64;
const JSON_EDITOR_CLASS_NAME = 'studio-json-editor';
const FOLD_CHIP_CLASS_NAME = 'studio-json-fold-chip';

export function isJsonModel(model: ITextModel | null): model is ITextModel {
	return !!model && JSON_LANGUAGE_IDS.includes(model.getLanguageId());
}

/**
 * The annotated-text view of a JSON file: the text editor stays as it is, and this adds marks on top
 * of it: the selected line and its type, a count after folded objects, the path bar, the bottom bar
 * with the filter, and coloured `null`s (the JSON grammar gives null and booleans the same scope).
 */
export class StudioJsonEditor extends Disposable {

	private document: StudioJsonDocument;
	private selectedValue: JsonValue | undefined;
	private filterQuery = '';

	private readonly onDidChangeEmitter = this._register(new Emitter<void>());
	/** After a parse or a cursor move: the status bar and the Structure view follow. */
	readonly onDidChange = this.onDidChangeEmitter.event;

	private readonly selectionDecorations = this.editor.createDecorationsCollection();
	private readonly nullDecorations = this.editor.createDecorationsCollection();
	private readonly foldChipDecorations = this.editor.createDecorationsCollection();
	private readonly filterDecorations = this.editor.createDecorationsCollection();
	private readonly parseScheduler = this._register(new RunOnceScheduler(() => this.parse(), PARSE_DELAY_MS));
	private foldingModel: FoldingModel | undefined;
	private readonly pathBar: StudioJsonPathBar;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly model: ITextModel,
		@IClipboardService private readonly clipboardService: IClipboardService,
	) {
		super();
		this.document = this.parseModel();
		this.pathBar = this._register(new StudioJsonPathBar(editor, {
			reveal: value => this.reveal(value),
			copyPath: () => this.copyPath(),
		}));
		this._register(new StudioJsonDock(editor, {
			filter: query => this.setFilter(query),
		}));

		const paddingBefore = editor.getOption(EditorOption.padding);
		const stickyScrollEnabledBefore = editor.getOption(EditorOption.stickyScroll).enabled;
		const extraClassNameBefore = editor.getOption(EditorOption.extraEditorClassName);
		this.makeRoomForBars();
		this._register(toDisposable(() => editor.updateOptions({ padding: paddingBefore, stickyScroll: { enabled: stickyScrollEnabledBefore }, extraEditorClassName: extraClassNameBefore })));
		this._register(toDisposable(() => {
			this.selectionDecorations.clear();
			this.nullDecorations.clear();
			this.foldChipDecorations.clear();
			this.filterDecorations.clear();
		}));

		this._register(model.onDidChangeContent(() => this.parseScheduler.schedule()));
		this._register(editor.onMouseDown(event => {
			const clickedFoldChip = event.target.element?.classList.contains(FOLD_CHIP_CLASS_NAME) && event.target.position;
			if (clickedFoldChip) {
				// It stands in for folding's own `⋯`, which unfolds on a click.
				void editor.getAction('editor.unfold')?.run({ selectionLines: [event.target.position.lineNumber - 1] });
			}
		}));
		this._register(editor.onDidChangeCursorPosition(() => this.updateSelection()));
		this._register(editor.onDidChangeConfiguration(event => {
			if (event.hasChanged(EditorOption.padding) || event.hasChanged(EditorOption.stickyScroll) || event.hasChanged(EditorOption.extraEditorClassName)) {
				this.makeRoomForBars();
			}
		}));
		this.watchFolding();
		this.renderAll();
	}

	getDocument(): StudioJsonDocument {
		return this.document;
	}

	getSelectedValue(): JsonValue | undefined {
		return this.selectedValue;
	}

	/** Puts the cursor at the value's key and shows it. */
	reveal(value: JsonValue): void {
		const column = this.model.getLineFirstNonWhitespaceColumn(value.startLine) || 1;
		this.editor.setPosition({ lineNumber: value.startLine, column });
		this.editor.revealLineInCenterIfOutsideViewport(value.startLine);
		this.editor.focus();
	}

	async copyPath(): Promise<void> {
		await this.clipboardService.writeText(dottedPath(this.selectedValue?.path ?? []));
	}

	private parseModel(): StudioJsonDocument {
		const allowComments = this.model.getLanguageId() === 'jsonc';
		return new StudioJsonDocument(this.model.getValue(), allowComments, offset => this.model.getPositionAt(offset).lineNumber);
	}

	private parse(): void {
		this.document = this.parseModel();
		this.renderAll();
	}

	private renderAll(): void {
		this.renderNulls();
		this.renderFoldChips();
		this.renderFilter();
		this.updateSelection();
	}

	/**
	 * The path bar and the bottom bar float over the editor; the padding keeps the first and last lines clear of them.
	 * Sticky scroll would sit under the path bar, which shows the same path. The class name is an option because the
	 * editor rewrites its element's classes when its options change.
	 */
	private makeRoomForBars(): void {
		const padding = this.editor.getOption(EditorOption.padding);
		const stickyScrollEnabled = this.editor.getOption(EditorOption.stickyScroll).enabled;
		const hasJsonClass = this.editor.getOption(EditorOption.extraEditorClassName).split(' ').includes(JSON_EDITOR_CLASS_NAME);
		const isReady = padding.top === PATH_BAR_ROOM && padding.bottom === DOCK_ROOM && !stickyScrollEnabled && hasJsonClass;
		if (!isReady) {
			const extraEditorClassName = hasJsonClass ? this.editor.getOption(EditorOption.extraEditorClassName) : `${this.editor.getOption(EditorOption.extraEditorClassName)} ${JSON_EDITOR_CLASS_NAME}`.trim();
			this.editor.updateOptions({ padding: { top: PATH_BAR_ROOM, bottom: DOCK_ROOM }, stickyScroll: { enabled: false }, extraEditorClassName });
		}
	}

	private updateSelection(): void {
		const lineNumber = this.editor.getPosition()?.lineNumber ?? 1;
		const valueOnLine = this.document.valueStartingOnLine(lineNumber);
		this.selectedValue = valueOnLine ?? this.document.containerAroundLine(lineNumber);
		this.renderSelection(valueOnLine);
		this.pathBar.render(basename(this.model.uri), this.document, this.selectedValue);
		this.onDidChangeEmitter.fire();
	}

	private renderSelection(valueOnLine: JsonValue | undefined): void {
		const selected = this.selectedValue;
		const isRoot = !selected?.parent;
		if (!selected || isRoot) {
			this.selectionDecorations.clear();
			return;
		}
		const decorations: IModelDeltaDecoration[] = [];
		if (valueOnLine) {
			decorations.push({
				range: { startLineNumber: valueOnLine.startLine, startColumn: 1, endLineNumber: valueOnLine.startLine, endColumn: 1 },
				options: {
					description: 'studio-json-selected-line',
					isWholeLine: true,
					className: `studio-json-selected-line studio-json-type-${valueOnLine.type}`,
					lineNumberClassName: 'studio-json-selected-line-number',
				},
			});
		}
		if (isJsonContainer(selected)) {
			const firstContainerLine = valueOnLine === selected ? selected.startLine + 1 : selected.startLine;
			if (firstContainerLine <= selected.endLine) {
				decorations.push({
					range: { startLineNumber: firstContainerLine, startColumn: 1, endLineNumber: selected.endLine, endColumn: 1 },
					options: { description: 'studio-json-selected-container', isWholeLine: true, className: 'studio-json-selected-container-line' },
				});
			}
		}
		this.selectionDecorations.set(decorations);
	}

	private renderNulls(): void {
		const nullValues = this.document.allValues().filter(value => value.type === 'null');
		this.nullDecorations.set(nullValues.map(value => ({
			range: this.rangeOf(value.valueOffset, value.valueLength),
			options: { description: 'studio-json-null', inlineClassName: 'studio-json-null' },
		})));
	}

	/** Folding makes its model for a file after this view starts, and every fold or unfold changes the hidden lines. */
	private watchFolding(): void {
		this._register(this.editor.onDidChangeHiddenAreas(() => this.updateFoldingModel()));
		void this.updateFoldingModel();
	}

	private async updateFoldingModel(): Promise<void> {
		const foldingModel = await FoldingController.get(this.editor)?.getFoldingModel();
		if (this._store.isDisposed) {
			return;
		}
		this.foldingModel = foldingModel ?? undefined;
		this.renderFoldChips();
	}

	/** The count after a folded object or array; its CSS draws the `…` before it, in place of folding's own. */
	private renderFoldChips(): void {
		const regions = this.foldingModel?.regions;
		if (!regions) {
			return;
		}
		const decorations: IModelDeltaDecoration[] = [];
		for (let index = 0; index < regions.length; index++) {
			const foldedContainer = regions.isCollapsed(index) ? this.document.containerOpeningOnLine(regions.getStartLineNumber(index)) : undefined;
			if (foldedContainer) {
				const lineNumber = regions.getStartLineNumber(index);
				const endColumn = this.model.getLineMaxColumn(lineNumber);
				decorations.push({
					range: { startLineNumber: lineNumber, startColumn: Math.max(1, endColumn - 1), endLineNumber: lineNumber, endColumn },
					options: { description: 'studio-json-fold-chip', after: { content: countLabel(foldedContainer), inlineClassName: FOLD_CHIP_CLASS_NAME } },
				});
			}
		}
		this.foldChipDecorations.set(decorations);
	}

	private setFilter(query: string): void {
		this.filterQuery = query.trim();
		this.renderFilter();
	}

	/** The filter dims what does not match instead of hiding it, so every line keeps its place. */
	private renderFilter(): void {
		if (!this.filterQuery) {
			this.filterDecorations.clear();
			return;
		}
		const { brightLines, matchedRanges } = this.document.filter(this.filterQuery);
		const decorations: IModelDeltaDecoration[] = [];
		for (let lineNumber = 1; lineNumber <= this.model.getLineCount(); lineNumber++) {
			if (!brightLines.has(lineNumber)) {
				decorations.push({
					range: { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: this.model.getLineMaxColumn(lineNumber) },
					options: { description: 'studio-json-filtered-out', inlineClassName: 'studio-json-filtered-out' },
				});
			}
		}
		for (const matchedRange of matchedRanges) {
			decorations.push({
				range: this.rangeOf(matchedRange.offset, matchedRange.length),
				options: { description: 'studio-json-filter-match', inlineClassName: 'studio-json-filter-match' },
			});
		}
		this.filterDecorations.set(decorations);
	}

	private rangeOf(offset: number, length: number) {
		const start = this.model.getPositionAt(offset);
		const end = this.model.getPositionAt(offset + length);
		return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
	}
}

/** "3 keys", "1 key", "2 items", "1 item". */
export function countLabel(container: JsonValue): string {
	const count = container.children.length;
	if (container.type === 'object') {
		return count === 1 ? localize('studioJson.oneKey', "1 key") : localize('studioJson.keys', "{0} keys", count);
	}
	return count === 1 ? localize('studioJson.oneItem', "1 item") : localize('studioJson.items', "{0} items", count);
}
