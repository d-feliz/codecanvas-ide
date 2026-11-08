/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codeCanvasBlockLane.css';
import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IOverlayWidget } from '../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { localize } from '../../../../nls.js';
import { BlockLines, Engine, loadEngine } from './codeCanvasEngine.js';

/** `labels`: chips show the glyph and the name; `glyphs`: only the glyph, for a narrow code panel. */
export type BlockLaneStyle = 'labels' | 'glyphs';

const LANE_WIDTH: Record<BlockLaneStyle, number> = { labels: 196, glyphs: 30 };
const MOST_LINE_NUMBER_DIGITS_SHOWN = 3;
const REPARSE_DELAY = 250;
const CHIP_HEIGHT = 20;

/**
 * The Code view's block lane: left of the line numbers, a chip (glyph and name) at each block's
 * declaration and a bar in the kind color along its lines. The selected block's lines are tinted.
 *
 * Monaco has no column left of the line numbers. Line numbers are right-aligned in a column at least
 * `lineNumbersMinChars` wide, so the lane widens that column and draws over its empty left part.
 */
export class CodeCanvasBlockLane extends Disposable implements IOverlayWidget {

	private static nextId = 0;
	private readonly id = `codeCanvas.blockLane.${CodeCanvasBlockLane.nextId++}`;
	private readonly laneElement = $('.code-canvas-block-lane');
	private readonly modelDisposables = this._register(new DisposableStore());
	private readonly selectedLineDecorations = this.editor.createDecorationsCollection();
	private blocks: BlockLines[] = [];
	private engine: Engine | undefined;
	private selectedBlockId: string | null = null;
	private readonly lineNumbersMinCharsBefore: number;

	private readonly _onDidPickBlock = this._register(new Emitter<string>());
	/** A chip was clicked. */
	readonly onDidPickBlock = this._onDidPickBlock.event;
	private readonly _onDidChangeBlocks = this._register(new Emitter<void>());
	readonly onDidChangeBlocks = this._onDidChangeBlocks.event;

	constructor(private readonly editor: ICodeEditor, private style: BlockLaneStyle) {
		super();
		this.laneElement.classList.add(`code-canvas-block-lane-${style}`);
		this.lineNumbersMinCharsBefore = editor.getOption(EditorOption.lineNumbersMinChars);
		editor.addOverlayWidget(this);
		this._register({
			dispose: () => {
				editor.removeOverlayWidget(this);
				this.selectedLineDecorations.clear();
				editor.updateOptions({ lineNumbersMinChars: this.lineNumbersMinCharsBefore });
			}
		});

		this.reserveLaneWidth();
		// The text editor applies the user's settings again when they change, which resets the column.
		this._register(editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(EditorOption.lineNumbersMinChars) || e.hasChanged(EditorOption.fontInfo)) {
				this.reserveLaneWidth();
			}
			this.render();
		}));
		this._register(editor.onDidScrollChange(() => this.render()));
		this._register(editor.onDidLayoutChange(() => this.render()));
		this._register(editor.onDidChangeModel(() => this.watchModel()));
		this._register(addDisposableListener(this.laneElement, EventType.MOUSE_DOWN, e => this.pickChipAt(e)));
		this.watchModel();
	}

	setStyle(style: BlockLaneStyle): void {
		if (style === this.style) {
			return;
		}
		this.laneElement.classList.replace(`code-canvas-block-lane-${this.style}`, `code-canvas-block-lane-${style}`);
		this.style = style;
		this.reserveLaneWidth();
		this.render();
	}

	getBlocks(): readonly BlockLines[] {
		return this.blocks;
	}

	/** The innermost block whose lines include the line. */
	blockAtLine(lineNumber: number): BlockLines | null {
		return this.engine?.blockAtLine(this.blocks, lineNumber) ?? null;
	}

	setSelectedBlock(id: string | null): void {
		this.selectedBlockId = id;
		this.renderSelectedLines();
		this.render();
	}

	getId(): string {
		return this.id;
	}

	getDomNode(): HTMLElement {
		return this.laneElement;
	}

	getPosition(): null {
		return null;
	}

	private watchModel() {
		this.modelDisposables.clear();
		this.blocks = [];
		const model = this.editor.getModel();
		if (!model) {
			this.render();
			return;
		}
		const reparse = this.modelDisposables.add(new RunOnceScheduler(() => void this.parse(model), REPARSE_DELAY));
		this.modelDisposables.add(model.onDidChangeContent(() => reparse.schedule()));
		void this.parse(model);
	}

	private async parse(model: ITextModel) {
		const engine = this.engine = await loadEngine();
		if (this.editor.getModel() !== model || model.isDisposed()) {
			return;
		}
		this.blocks = engine.blockLines(engine.parseFile(model.uri.path, model.getValue()));
		this.reserveLaneWidth();
		this.renderSelectedLines();
		this.render();
		this._onDidChangeBlocks.fire();
	}

	private reserveLaneWidth() {
		const digitWidth = this.editor.getOption(EditorOption.fontInfo).maxDigitWidth;
		const lineCountDigits = String(this.editor.getModel()?.getLineCount() ?? 1).length;
		const lineNumberChars = Math.max(lineCountDigits, MOST_LINE_NUMBER_DIGITS_SHOWN) + 1;
		const lineNumbersMinChars = Math.ceil(LANE_WIDTH[this.style] / digitWidth) + lineNumberChars;
		if (this.editor.getOption(EditorOption.lineNumbersMinChars) !== lineNumbersMinChars) {
			this.editor.updateOptions({ lineNumbersMinChars });
		}
	}

	private renderSelectedLines() {
		const selectedBlock = this.blocks.find(block => block.id === this.selectedBlockId);
		if (!selectedBlock) {
			this.selectedLineDecorations.clear();
			return;
		}
		this.selectedLineDecorations.set([{
			range: { startLineNumber: selectedBlock.startLine, startColumn: 1, endLineNumber: selectedBlock.endLine, endColumn: 1 },
			options: {
				description: 'code-canvas-selected-block',
				isWholeLine: true,
				className: 'code-canvas-selected-block-line',
				lineNumberClassName: 'code-canvas-selected-block-line-number',
			},
		}]);
	}

	private render() {
		const layoutInfo = this.editor.getLayoutInfo();
		const laneWidth = LANE_WIDTH[this.style];
		this.laneElement.style.left = `${layoutInfo.lineNumbersLeft}px`;
		this.laneElement.style.width = `${laneWidth}px`;
		this.laneElement.style.height = `${layoutInfo.height}px`;
		clearNode(this.laneElement);

		const visibleRanges = this.editor.getVisibleRanges();
		const firstVisibleLine = visibleRanges[0]?.startLineNumber ?? 1;
		const lastVisibleLine = visibleRanges[visibleRanges.length - 1]?.endLineNumber ?? 0;
		const scrollTop = this.editor.getScrollTop();
		const lineHeight = this.editor.getOption(EditorOption.lineHeight);
		const topOf = (lineNumber: number) => this.editor.getTopForLineNumber(lineNumber) - scrollTop;

		// Bars of nested blocks are drawn over their parent's, so each line shows its innermost block.
		for (const block of this.blocks) {
			const isVisible = block.endLine >= firstVisibleLine && block.startLine <= lastVisibleLine;
			if (!isVisible) {
				continue;
			}
			const isSelected = block.id === this.selectedBlockId;
			const kindColor = `var(--vscode-studio-kind${block.kind[0].toUpperCase()}${block.kind.slice(1)})`;
			const bar = append(this.laneElement, $('.code-canvas-lane-bar'));
			bar.classList.toggle('code-canvas-lane-selected', isSelected);
			bar.style.top = `${topOf(block.startLine)}px`;
			bar.style.height = `${topOf(block.endLine) + lineHeight - topOf(block.startLine)}px`;
			bar.style.setProperty('--code-canvas-kind', kindColor);

			const chipIsVisible = block.declarationLine >= firstVisibleLine && block.declarationLine <= lastVisibleLine;
			if (chipIsVisible) {
				this.renderChip(block, kindColor, topOf(block.declarationLine), lineHeight, isSelected);
			}
		}
	}

	private pickChipAt(e: MouseEvent) {
		const chip = (e.target as HTMLElement).closest<HTMLElement>('.code-canvas-lane-chip');
		const blockId = chip?.dataset.blockId;
		if (!blockId) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		this.setSelectedBlock(blockId);
		this._onDidPickBlock.fire(blockId);
	}

	private renderChip(block: BlockLines, kindColor: string, top: number, lineHeight: number, isSelected: boolean) {
		const chip = append(this.laneElement, $<HTMLButtonElement>('button.code-canvas-lane-chip'));
		chip.classList.toggle('code-canvas-lane-selected', isSelected);
		const chipHeight = Math.min(CHIP_HEIGHT, lineHeight - 2);
		chip.style.top = `${top + (lineHeight - chipHeight) / 2}px`;
		chip.style.height = `${chipHeight}px`;
		chip.style.setProperty('--code-canvas-kind', kindColor);
		chip.setAttribute('aria-label', localize('codeCanvas.selectBlock', "Select {0}", block.name));
		chip.title = block.name;
		chip.dataset.blockId = block.id;
		append(chip, $('span.code-canvas-lane-glyph')).textContent = block.glyph;
		if (this.style === 'labels') {
			append(chip, $('span.code-canvas-lane-name')).textContent = block.name;
		}
	}
}
