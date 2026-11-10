/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { DiffEditorWidget } from '../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ITextModel, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarker, IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { EditorHandle, EditorOptions, Engine, HostDiagnostic } from './codeCanvasEngine.js';

/** The block editor of the file canvas and the flow canvas: Monaco on the block's own file. */
export class CodeCanvasBlockEditors {

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
	) { }

	/**
	 * Blocks are edited in Monaco on the file's own document, with every line outside the block hidden.
	 * So IntelliSense, hovers and error squiggles work as in the text editor, and undo is the file's.
	 */
	create(engine: Engine, model: ITextModel, { parent, start, end, selection, onClose, diffBase }: EditorOptions): EditorHandle {
		const disposables = new DisposableStore();
		const editor = diffBase === undefined
			? this.createCodeEditor(parent, model, disposables)
			: this.createDiffEditor(parent, model, start, end, diffBase, disposables);

		// Grows with typing at its edges, so the block's new lines stay visible.
		const [blockDecorationId] = model.deltaDecorations([], [{
			range: Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end)),
			options: { description: 'code-canvas-block', stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges },
		}]);
		disposables.add(toDisposable(() => model.deltaDecorations([blockDecorationId], [])));
		const showOnlyBlockLines = () => {
			const blockRange = model.getDecorationRange(blockDecorationId);
			if (!blockRange) {
				return;
			}
			const lastLine = model.getLineCount();
			const linesOutsideBlock: Range[] = [];
			if (blockRange.startLineNumber > 1) {
				linesOutsideBlock.push(new Range(1, 1, blockRange.startLineNumber - 1, 1));
			}
			if (blockRange.endLineNumber < lastLine) {
				linesOutsideBlock.push(new Range(blockRange.endLineNumber + 1, 1, lastLine, 1));
			}
			editor.setHiddenAreas(linesOutsideBlock, CodeCanvasBlockEditors);
		};
		showOnlyBlockLines();
		disposables.add(model.onDidChangeContent(showOnlyBlockLines));
		// Keys like Cmd+Up would otherwise move the cursor into the hidden lines, outside the block.
		disposables.add(editor.onDidChangeCursorSelection(e => {
			const blockRange = model.getDecorationRange(blockDecorationId);
			if (!blockRange || blockRange.containsRange(e.selection)) {
				return;
			}
			const intoBlock = (position: Position) => position.isBefore(blockRange.getStartPosition()) ? blockRange.getStartPosition() : blockRange.getEndPosition().isBefore(position) ? blockRange.getEndPosition() : position;
			editor.setSelection(Selection.fromPositions(intoBlock(e.selection.getSelectionStart()), intoBlock(e.selection.getPosition())));
		}));

		const [selectionStart, selectionEnd] = selection ?? [0, 0];
		editor.setSelection(Range.fromPositions(model.getPositionAt(start + selectionStart), model.getPositionAt(start + selectionEnd)));
		editor.revealRangeInCenterIfOutsideViewport(editor.getSelection()!);

		// Enter on the blank line after the block's closing brace: the block is done.
		const isFinishingBlock = () => {
			const blockRange = model.getDecorationRange(blockDecorationId);
			const cursor = editor.getPosition();
			if (!blockRange || !cursor) {
				return false;
			}
			const blockStart = model.getOffsetAt(blockRange.getStartPosition());
			return engine.isFinishingBlock(model.getValueInRange(blockRange), model.getOffsetAt(cursor) - blockStart);
		};
		// The other lines are only hidden: Backspace at the block's start (or Delete at its end) would reach into them.
		const deletesOutsideBlock = (e: IKeyboardEvent) => {
			const blockRange = model.getDecorationRange(blockDecorationId);
			const selection = editor.getSelection();
			if (!blockRange || !selection?.isEmpty()) {
				return false;
			}
			const cursor = selection.getPosition();
			const isBackspaceAtStart = e.keyCode === KeyCode.Backspace && cursor.equals(blockRange.getStartPosition());
			const isDeleteAtEnd = e.keyCode === KeyCode.Delete && cursor.equals(blockRange.getEndPosition());
			return isBackspaceAtStart || isDeleteAtEnd;
		};
		disposables.add(editor.onKeyDown(e => {
			if (deletesOutsideBlock(e)) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			const isSuggestOpen = editor.invokeWithinContext(accessor => accessor.get(IContextKeyService).getContextKeyValue<boolean>('suggestWidgetVisible'));
			const isPlainEnter = e.keyCode === KeyCode.Enter && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
			const isClose = (e.keyCode === KeyCode.Escape && !isSuggestOpen) || (e.keyCode === KeyCode.Enter && (e.metaKey || e.ctrlKey)) || (isPlainEnter && !isSuggestOpen && isFinishingBlock());
			if (isClose) {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		}));
		return {
			focus: () => editor.focus(),
			destroy: () => disposables.dispose(),
			editsFile: true,
		};
	}

	private createCodeEditor(parent: HTMLElement, model: ITextModel, disposables: DisposableStore): ICodeEditor {
		const editor = disposables.add(this.instantiationService.createInstance(CodeEditorWidget, parent, BLOCK_EDITOR_OPTIONS, { contributions: EditorExtensionsRegistry.getEditorContributions() }));
		editor.setModel(model);
		return editor;
	}

	/**
	 * While changes are shown: an inline diff of the block. Its edited side is still the file itself; its
	 * original side is the file with just this block put back as committed, so the only differences
	 * are in the block. Returns the edited side.
	 */
	private createDiffEditor(parent: HTMLElement, model: ITextModel, start: number, end: number, committedBlock: string, disposables: DisposableStore): ICodeEditor {
		const text = model.getValue();
		const original = this.modelService.createModel(text.slice(0, start) + committedBlock + text.slice(end), this.languageService.createById(model.getLanguageId()));
		const diffEditor = disposables.add(this.instantiationService.createInstance(DiffEditorWidget, parent, {
			...BLOCK_EDITOR_OPTIONS,
			renderSideBySide: false,
			useInlineViewWhenSpaceIsLimited: false,
			renderIndicators: true,
			originalEditable: false,
			renderOverviewRuler: false,
			renderMarginRevertIcon: false,
			renderGutterMenu: false,
			hideUnchangedRegions: { enabled: false },
			diffCodeLens: false,
		}, { originalEditor: { contributions: [] }, modifiedEditor: { contributions: EditorExtensionsRegistry.getEditorContributions() } }));
		diffEditor.setModel({ original, modified: model });
		// The inline diff still shows the original side's line numbers: hide its lines outside the block too.
		const originalFirstLine = original.getPositionAt(start).lineNumber;
		const originalLastLine = original.getPositionAt(start + committedBlock.length).lineNumber;
		const originalLinesOutsideBlock = [new Range(1, 1, originalFirstLine - 1, 1), new Range(originalLastLine + 1, 1, original.getLineCount(), 1)]
			.filter(range => range.startLineNumber <= range.endLineNumber && range.endLineNumber >= 1);
		diffEditor.getOriginalEditor().setHiddenAreas(originalLinesOutsideBlock, CodeCanvasBlockEditors);
		// After the diff editor, which still shows it until it's disposed.
		disposables.add(toDisposable(() => original.dispose()));
		return diffEditor.getModifiedEditor();
	}
}

const BLOCK_EDITOR_OPTIONS = {
	automaticLayout: true,
	minimap: { enabled: false },
	scrollBeyondLastLine: false,
	lineNumbersMinChars: 3,
	fixedOverflowWidgets: true,
};

export function problemsOf(markerService: IMarkerService, model: ITextModel): HostDiagnostic[] {
	const markers = markerService.read({ resource: model.uri, severities: MarkerSeverity.Error | MarkerSeverity.Warning });
	return markers.map((marker: IMarker): HostDiagnostic => {
		const start = model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn });
		const end = model.getOffsetAt({ lineNumber: marker.endLineNumber, column: marker.endColumn });
		return {
			start,
			length: end - start,
			line: marker.startLineNumber,
			message: marker.message,
			source: 'type',
			severity: marker.severity === MarkerSeverity.Error ? 'error' : 'warning',
		};
	});
}


/** Replace the document's text with `text` as one undo step, touching only the part that changed. */
export function replaceText(model: ITextModel, text: string) {
	const before = model.getValue();
	if (before === text) {
		return;
	}
	const change = changedRegion(before, text);
	model.pushStackElement();
	model.pushEditOperations(null, [{ range: rangeOfOffsets(before, change.start, change.end, model), text: change.text }], () => null);
	model.pushStackElement();
}

export function changedRegion(before: string, after: string): { start: number; end: number; text: string } {
	let start = 0;
	const shorter = Math.min(before.length, after.length);
	while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) {
		start++;
	}
	let fromEnd = 0;
	while (fromEnd < shorter - start && before.charCodeAt(before.length - 1 - fromEnd) === after.charCodeAt(after.length - 1 - fromEnd)) {
		fromEnd++;
	}
	return { start, end: before.length - fromEnd, text: after.slice(start, after.length - fromEnd) };
}

export function rangeOfOffsets(text: string, start: number, end: number, model?: ITextModel): Range {
	if (model) {
		return Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end));
	}
	const positionAt = (offset: number) => {
		const before = text.slice(0, offset);
		const lineNumber = before.split('\n').length;
		return { lineNumber, column: offset - before.lastIndexOf('\n') };
	};
	return Range.fromPositions(positionAt(start), positionAt(end));
}
