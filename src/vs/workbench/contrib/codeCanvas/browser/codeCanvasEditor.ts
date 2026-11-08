/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codeCanvasEditor.css';
import { $, addDisposableListener, append, Dimension, EventType } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { IBulkEditService, ResourceTextEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { DiffEditorWidget } from '../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { ITextModel, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { IEditorOptions as ICodeEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickDiffService } from '../../scm/common/quickDiff.js';
import { IEditorOptions, ITextEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarker, IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { getStudioEditorFreeArea, onDidChangeStudioEditorFreeArea } from '../../../browser/studio/studioShell.js';
import { IEditorControl, IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CODE_CANVAS_EDITOR_ID, CODE_CANVAS_LAYOUT_FOLDER, CODE_CANVAS_SHOWS_CHANGES } from '../common/codeCanvas.js';
import { CodeCanvas, EditorHandle, EditorOptions, Engine, FileLayout, HostDiagnostic, loadEngine, OtherFileChange } from './codeCanvasEngine.js';
import { CodeCanvasEditorInput } from './codeCanvasEditorInput.js';
import { CodeCanvasBlockLane } from './codeCanvasBlockLane.js';
import { ICodeCanvasProjectService } from './codeCanvasProjects.js';

/** Blocks to select once a canvas opens, when the user jumped to a block in another file. */
const blockToRevealByResource = new Map<string, string>();

/** `split`: the canvas on the left, the file's code on the right. Each file remembers its own. */
export type CodeCanvasViewMode = 'canvas' | 'split';
const viewModeChangeEmitter = new Emitter<void>();
/** A canvas editor switched between the canvas alone and Split. */
export const onDidChangeCodeCanvasViewMode = viewModeChangeEmitter.event;

export function codeCanvasViewModeStorageKey(resource: URI): string {
	return `codeCanvas.viewMode:${resource.toString()}`;
}

const SPLIT_GAP = 12;
const SMALLEST_SPLIT_MARGIN = 8;

interface CodePanel {
	editor: CodeEditorWidget;
	lane: CodeCanvasBlockLane;
	element: HTMLElement;
	selectedBlockLabel: HTMLElement;
}

/**
 * Shows a TypeScript or JavaScript file as the CodeCanvas diagram. Text stays the source of truth: the canvas
 * edits the file's text document, and every change to the document re-renders the canvas.
 */
export interface CodeCanvasBlockSummary {
	id: string;
	name: string;
	kind: string;
	/** As in the block's header on the canvas. */
	glyph: string;
	detail: string;
	depth: number;
}

export class CodeCanvasEditor extends EditorPane {

	static readonly ID = CODE_CANVAS_EDITOR_ID;

	private container: HTMLElement | undefined;
	private canvas: CodeCanvas | undefined;
	private readonly inputDisposables = this._register(new DisposableStore());
	/** Kept across files: once on, every file this pane shows is compared with its last commit. */
	private showsChanges = false;
	private readonly showsChangesContext: IContextKey<boolean>;
	private shownFile: { canvas: CodeCanvas; model: ITextModel; layoutResource: URI; path: string } | undefined;
	private readonly committedVersionDisposables = this._register(new DisposableStore());
	private engine: Engine | undefined;
	private viewMode: CodeCanvasViewMode = 'canvas';
	private codePanel: CodePanel | undefined;
	private readonly codePanelDisposables = this._register(new DisposableStore());
	private selectedBlockId: string | null = null;
	private isSelectingFromCode = false;
	private dimension: Dimension | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ICodeCanvasProjectService private readonly projectService: ICodeCanvasProjectService,
		@IBulkEditService private readonly bulkEditService: IBulkEditService,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IQuickDiffService private readonly quickDiffService: IQuickDiffService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(CodeCanvasEditor.ID, group, telemetryService, themeService, storageService);
		this.showsChangesContext = CODE_CANVAS_SHOWS_CHANGES.bindTo(group.scopedContextKeyService);
	}

	/** Show or hide the changes since the file's last commit. */
	async toggleChanges(): Promise<void> {
		this.showsChanges = !this.showsChanges;
		this.showsChangesContext.set(this.showsChanges);
		await this.showChangesIfOn();
	}

	private async showChangesIfOn() {
		this.committedVersionDisposables.clear();
		const shownFile = this.shownFile;
		if (!shownFile) {
			return;
		}
		if (!this.showsChanges) {
			return shownFile.canvas.setDiffBase(null);
		}
		const committed = await this.readCommittedVersion(shownFile.model.uri);
		if (this.shownFile !== shownFile || !this.showsChanges) {
			return;
		}
		if (!committed) {
			this.notificationService.info(localize('codeCanvas.noCommittedVersion', "This file has no committed version to compare with."));
			this.showsChanges = false;
			this.showsChangesContext.set(false);
			return;
		}
		const committedLayout = await this.readCommittedVersion(shownFile.layoutResource);
		const showCommitted = () => {
			let layout: FileLayout | null = null;
			try {
				layout = committedLayout ? JSON.parse(committedLayout.model.getValue()) as FileLayout : null;
			} catch {
				// A layout that doesn't parse: removed blocks are placed like new ones.
			}
			shownFile.canvas.setDiffBase({ text: committed.model.getValue(), layout });
		};
		showCommitted();
		// The committed version changes after a commit (or a checkout).
		this.committedVersionDisposables.add(committed.model.onDidChangeContent(showCommitted));
		this.committedVersionDisposables.add(committed.reference);
		if (committedLayout) {
			this.committedVersionDisposables.add(committedLayout.reference);
		}
	}

	/** The file as source control has it (git: HEAD or the staged version), like the gutter's change bars. */
	private async readCommittedVersion(resource: URI): Promise<{ model: ITextModel; reference: { dispose(): void } } | undefined> {
		try {
			const quickDiffs = await this.quickDiffService.getQuickDiffs(resource);
			const sourceControl = quickDiffs.find(quickDiff => quickDiff.kind === 'primary') ?? quickDiffs[0];
			if (!sourceControl) {
				return undefined;
			}
			const reference = await this.textModelService.createModelReference(sourceControl.originalResource);
			return { model: reference.object.textEditorModel, reference };
		} catch {
			return undefined;
		}
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('.code-canvas-editor'));
		this.applyEditorFont();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.fontFamily')) {
				this.applyEditorFont();
			}
		}));
		// The canvas handles its own shortcuts (undo, delete, F2…). Keys it handled must not also run
		// the workbench command bound to them.
		this._register(addDisposableListener(this.container, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.defaultPrevented) {
				e.stopPropagation();
			}
		}));
	}

	override async setInput(input: CodeCanvasEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.inputDisposables.clear();
		this.committedVersionDisposables.clear();
		this.shownFile = undefined;
		await super.setInput(input, options, context, token);

		const folder = this.workspaceContextService.getWorkspaceFolder(input.resource)?.uri ?? dirname(input.resource);
		const [engine, modelReference, folderProject] = await Promise.all([
			loadEngine(),
			this.textModelService.createModelReference(input.resource),
			this.projectService.getFolderProject(folder),
		]);
		if (token.isCancellationRequested || !this.container) {
			modelReference.dispose();
			return;
		}
		this.inputDisposables.add(modelReference);
		this.engine = engine;
		const model = modelReference.object.textEditorModel;
		const path = folderProject.projectPath(input.resource) ?? input.getName();
		const layoutResource = joinPath(folder, CODE_CANVAS_LAYOUT_FOLDER, `${path}.json`);

		const savedLayout = await this.readLayout(layoutResource);
		// Opening a file must not add files to the repo: positions the canvas picks by itself stay in
		// VS Code's workspace storage until the user arranges something, or a layout file exists already.
		let isLayoutInRepo = savedLayout.isInRepo;
		let isApplyingCanvasEdit = false;
		let layoutToSave: FileLayout | undefined;
		const layoutSaver = this.inputDisposables.add(new RunOnceScheduler(() => {
			if (layoutToSave) {
				void this.saveLayout(engine, layoutResource, layoutToSave, canvas, isLayoutInRepo);
			}
		}, 400));

		const canvas: CodeCanvas = this.canvas = new engine.CodeCanvas(this.container, {
			project: folderProject.project,
			theme: isDark(this.themeService.getColorTheme().type) ? 'dark' : 'light',
			createEditor: options => this.createBlockEditor(model, options),
			onTextChange: (text, otherFiles) => {
				isApplyingCanvasEdit = true;
				try {
					if (otherFiles) {
						void this.applyRenameAcrossFiles(model, text, folder, otherFiles);
					} else {
						replaceText(model, text);
					}
				} finally {
					isApplyingCanvasEdit = false;
				}
			},
			onLayoutChange: (layout, reason) => {
				if (reason === 'user') {
					isLayoutInRepo = true;
				}
				layoutToSave = layout;
				layoutSaver.schedule();
			},
			onUndo: () => void model.undo(),
			onRedo: () => void model.redo(),
			onSelect: block => this.showSelectionInCode(block?.id ?? null),
			onOpenCode: block => this.openCodeAt(block.id),
			onAsk: block => this.askAbout(model, block),
			onOpenBlock: (otherPath, blockId) => {
				const resource = joinPath(folder, otherPath);
				blockToRevealByResource.set(resource.toString(), blockId);
				void this.editorService.openEditor({ resource, options: { override: CODE_CANVAS_EDITOR_ID } }, this.group);
			},
		});
		this.inputDisposables.add(toDisposable(() => {
			layoutSaver.flush();
			canvas.destroy();
			if (this.canvas === canvas) {
				this.canvas = undefined;
			}
		}));

		this.shownFile = { canvas, model, layoutResource, path };
		this.inputDisposables.add(toDisposable(() => {
			this.shownFile = undefined;
			this.selectedBlockId = null;
			this.closeCodePanel();
		}));
		this.viewMode = this.storageService.get(codeCanvasViewModeStorageKey(input.resource), StorageScope.WORKSPACE) === 'split' ? 'split' : 'canvas';
		this.renderViewMode();
		viewModeChangeEmitter.fire();
		// In Studio the canvas lies under the floating panels; it keeps the file and Fit clear of them (and of the code in Split).
		this.inputDisposables.add(onDidChangeStudioEditorFreeArea(() => this.placeCodePanelAndCanvas()));
		canvas.openFile(path, model.getValue(), savedLayout.layout);
		void this.showChangesIfOn();
		// Errors come from VS Code's Problems (the TypeScript extension), not from the engine.
		const showProblems = () => canvas.setDiagnostics(this.problemsOf(model));
		showProblems();
		this.inputDisposables.add(this.markerService.onMarkerChanged(resources => {
			if (resources.some(resource => isEqual(resource, model.uri))) {
				showProblems();
			}
		}));
		this.inputDisposables.add(model.onDidChangeContent(() => {
			if (!isApplyingCanvasEdit) {
				canvas.setText(model.getValue());
			}
		}));
		this.inputDisposables.add(folderProject.onDidChangeOtherFiles(() => canvas.refreshProject()));
		this.inputDisposables.add(this.themeService.onDidColorThemeChange(theme => canvas.setTheme(isDark(theme.type) ? 'dark' : 'light')));

		const blockToReveal = blockToRevealByResource.get(input.resource.toString());
		if (blockToReveal) {
			blockToRevealByResource.delete(input.resource.toString());
			canvas.reveal(blockToReveal);
		}
		this.revealSelection(engine, options);
	}

	override setOptions(options: IEditorOptions | undefined): void {
		super.setOptions(options);
		void loadEngine().then(engine => this.revealSelection(engine, options));
	}

	/** The blocks of the file on the canvas, in file order, for Studio's Go to anything. */
	getBlocks(): CodeCanvasBlockSummary[] {
		const fileModel = this.shownFile?.canvas.getModel();
		const engine = this.engine;
		if (!fileModel || !engine) {
			return [];
		}
		return [...fileModel.blocks.values()].sort((first, second) => first.start - second.start).map(block => ({ id: block.id, name: block.name, kind: block.kind, glyph: engine.glyphOf(block), detail: block.detail, depth: block.depth }));
	}

	/** Selects the block and moves the canvas to it. */
	revealBlock(id: string): void {
		this.canvas?.reveal(id);
	}

	/** Adds a function in the middle of the view, as the dock's "+ Function". */
	addFunction(): void {
		this.canvas?.addFunction();
	}

	getViewMode(): CodeCanvasViewMode {
		return this.viewMode;
	}

	setViewMode(viewMode: CodeCanvasViewMode): void {
		if (viewMode === this.viewMode) {
			return;
		}
		this.viewMode = viewMode;
		const resource = this.shownFile?.model.uri;
		if (resource) {
			this.storageService.store(codeCanvasViewModeStorageKey(resource), viewMode, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		this.renderViewMode();
		viewModeChangeEmitter.fire();
		// The code panel now covers half of the canvas, or uncovers it: keep the selected block in view.
		if (this.selectedBlockId) {
			this.canvas?.reveal(this.selectedBlockId);
		}
	}

	/** In Split, editor commands (Go to Line, Format, Find…) act on the code side. */
	override getControl(): IEditorControl | undefined {
		return this.codePanel?.editor;
	}

	/** "Open code" on a block: Split, with the code at the block. */
	private openCodeAt(blockId: string) {
		this.setViewMode('split');
		const block = this.shownFile?.canvas.getModel()?.blocks.get(blockId);
		const codePanel = this.codePanel;
		if (!block || !codePanel || !this.shownFile) {
			return;
		}
		const model = this.shownFile.model;
		const declaration = model.getPositionAt(block.nameStart >= 0 ? block.nameStart : block.start);
		this.showSelectionInCode(blockId);
		codePanel.editor.setPosition(declaration);
		codePanel.editor.focus();
	}

	/** "Ask" on a block: the Assistant, with the block's code attached. */
	private askAbout(model: ITextModel, block: { name: string; start: number; end: number }) {
		const range = Range.fromPositions(model.getPositionAt(block.start), model.getPositionAt(block.end));
		void this.commandService.executeCommand('workbench.action.chat.open', {
			query: localize('codeCanvas.askAboutBlock', "Explain {0}: ", block.name),
			isPartialQuery: true,
			attachFiles: [{ uri: model.uri, range }],
		});
	}

	private renderViewMode() {
		const shownFile = this.shownFile;
		const showsCode = this.viewMode === 'split' && !!shownFile;
		if (showsCode && !this.codePanel) {
			this.codePanel = this.createCodePanel(shownFile.model, shownFile.path);
		}
		if (!showsCode) {
			this.closeCodePanel();
		}
		this.container?.classList.toggle('code-canvas-split', showsCode);
		this.placeCodePanelAndCanvas();
	}

	private closeCodePanel() {
		this.codePanelDisposables.clear();
		this.codePanel = undefined;
	}

	private createCodePanel(model: ITextModel, path: string): CodePanel {
		const disposables = this.codePanelDisposables;
		const element = append(this.container!, $('.code-canvas-code-panel'));
		disposables.add(toDisposable(() => element.remove()));

		const header = append(element, $('.code-canvas-code-panel-header'));
		const folderEnd = path.lastIndexOf('/');
		if (folderEnd > 0) {
			append(header, $('span.code-canvas-code-panel-folder')).textContent = `${path.slice(0, folderEnd)} /`;
		}
		append(header, $('span.code-canvas-code-panel-file')).textContent = path.slice(folderEnd + 1);
		const selectedBlockLabel = append(header, $('span.code-canvas-code-panel-block'));
		append(header, $('span.code-canvas-code-panel-spacer'));
		const closeButton = append(header, $<HTMLButtonElement>('button.code-canvas-code-panel-close'));
		// allow-any-unicode-next-line
		closeButton.textContent = '×';
		closeButton.setAttribute('aria-label', localize('codeCanvas.closeCode', "Close Code Panel"));
		closeButton.title = localize('codeCanvas.closeCode', "Close Code Panel");
		disposables.add(addDisposableListener(closeButton, EventType.CLICK, () => this.setViewMode('canvas')));

		const editorElement = append(element, $('.code-canvas-code-panel-editor'));
		const editor = disposables.add(this.instantiationService.createInstance(CodeEditorWidget, editorElement, this.codePanelEditorOptions(model), { contributions: EditorExtensionsRegistry.getEditorContributions() }));
		editor.setModel(model);
		disposables.add(this.textResourceConfigurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(model.uri, 'editor')) {
				editor.updateOptions(this.codePanelEditorOptions(model));
			}
		}));
		const lane = disposables.add(new CodeCanvasBlockLane(editor, 'glyphs'));
		lane.setSelectedBlock(this.selectedBlockId);
		disposables.add(lane.onDidPickBlock(blockId => this.selectBlockFromCode(blockId)));
		disposables.add(editor.onDidChangeCursorPosition(e => {
			const movedByUser = e.source === 'mouse' || e.source === 'keyboard';
			const block = movedByUser ? lane.blockAtLine(e.position.lineNumber) : null;
			if (block && block.id !== this.selectedBlockId) {
				this.selectBlockFromCode(block.id);
			}
		}));

		const codePanel: CodePanel = { editor, lane, element, selectedBlockLabel };
		this.renderSelectedBlockLabel(codePanel);
		return codePanel;
	}

	private codePanelEditorOptions(model: ITextModel): ICodeEditorOptions {
		return {
			...this.textResourceConfigurationService.getValue<ICodeEditorOptions>(model.uri, 'editor'),
			automaticLayout: true,
			minimap: { enabled: false },
			fixedOverflowWidgets: true,
		};
	}

	private selectBlockFromCode(blockId: string) {
		this.isSelectingFromCode = true;
		try {
			this.canvas?.reveal(blockId);
		} finally {
			this.isSelectingFromCode = false;
		}
	}

	/** The canvas's selection, shown in the code: its lines tinted and, unless it came from the code, scrolled to. */
	private showSelectionInCode(blockId: string | null) {
		this.selectedBlockId = blockId;
		const codePanel = this.codePanel;
		const shownFile = this.shownFile;
		if (!codePanel || !shownFile) {
			return;
		}
		codePanel.lane.setSelectedBlock(blockId);
		this.renderSelectedBlockLabel(codePanel);
		const block = blockId ? shownFile.canvas.getModel()?.blocks.get(blockId) : undefined;
		if (block && !this.isSelectingFromCode) {
			const blockRange = Range.fromPositions(shownFile.model.getPositionAt(block.start), shownFile.model.getPositionAt(block.end));
			codePanel.editor.revealRangeNearTopIfOutsideViewport(blockRange, ScrollType.Smooth);
		}
	}

	private renderSelectedBlockLabel(codePanel: CodePanel) {
		const block = this.selectedBlockId ? this.shownFile?.canvas.getModel()?.blocks.get(this.selectedBlockId) : undefined;
		codePanel.selectedBlockLabel.style.display = block ? '' : 'none';
		if (block && this.engine) {
			codePanel.selectedBlockLabel.textContent = `${this.engine.glyphOf(block)} ${block.name}`;
			codePanel.selectedBlockLabel.style.setProperty('--code-canvas-kind', `var(--vscode-studio-kind${block.kind[0].toUpperCase()}${block.kind.slice(1)})`);
		}
	}

	/** In Split the code takes the right half of the free area and the canvas keeps to the left half. */
	private placeCodePanelAndCanvas() {
		const canvas = this.shownFile?.canvas;
		if (!canvas || !this.container) {
			return;
		}
		const freeArea = getStudioEditorFreeArea();
		const codePanel = this.codePanel;
		if (!codePanel) {
			this.container.style.removeProperty('--code-canvas-split-right');
			canvas.setViewInsets(freeArea);
			return;
		}
		// Before the pane's first layout, the container still has the size the group gave it.
		const width = this.dimension?.width ?? this.container.clientWidth;
		const left = Math.max(freeArea.left, SMALLEST_SPLIT_MARGIN);
		const right = Math.max(freeArea.right, SMALLEST_SPLIT_MARGIN);
		const top = Math.max(freeArea.top, SMALLEST_SPLIT_MARGIN);
		const bottom = Math.max(freeArea.bottom, SMALLEST_SPLIT_MARGIN);
		const codePanelLeft = Math.round(left + (width - left - right) / 2 + SPLIT_GAP / 2);
		Object.assign(codePanel.element.style, { left: `${codePanelLeft}px`, right: `${right}px`, top: `${top}px`, bottom: `${bottom}px` });
		const canvasRight = width - codePanelLeft + SPLIT_GAP / 2;
		this.container.style.setProperty('--code-canvas-split-right', `${canvasRight}px`);
		canvas.setViewInsets({ ...freeArea, right: canvasRight });
	}

	/** Opened at a place in the text (Go to Definition, a search result, a problem): select the block there. */
	private revealSelection(engine: Engine, options: IEditorOptions | undefined) {
		const selection = (options as ITextEditorOptions | undefined)?.selection;
		const shownFile = this.shownFile;
		const model = shownFile?.canvas.getModel();
		if (!selection || !shownFile || !model) {
			return;
		}
		const offset = shownFile.model.getOffsetAt({ lineNumber: selection.startLineNumber, column: selection.startColumn ?? 1 });
		const block = engine.blockAt(model, offset);
		if (block) {
			shownFile.canvas.reveal(block.id);
		}
	}

	private problemsOf(model: ITextModel): HostDiagnostic[] {
		const markers = this.markerService.read({ resource: model.uri, severities: MarkerSeverity.Error | MarkerSeverity.Warning });
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

	/** Blocks use the same font as the text editor. */
	private applyEditorFont() {
		const fontFamily = this.configurationService.getValue<string>('editor.fontFamily');
		this.container?.style.setProperty('--cc-font', fontFamily || 'var(--monaco-monospace-font)');
	}

	private async saveLayout(engine: Engine, resource: URI, layout: FileLayout, canvas: CodeCanvas, isLayoutInRepo: boolean) {
		const serialized = engine.serializeLayout(layout, canvas.getModel());
		const storageKey = layoutStorageKey(resource);
		if (!isLayoutInRepo) {
			this.storageService.store(storageKey, serialized, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			return;
		}
		try {
			await this.fileService.writeFile(resource, VSBuffer.fromString(serialized));
			this.storageService.remove(storageKey, StorageScope.WORKSPACE);
		} catch (error) {
			this.logService.error('[codeCanvas] could not save block positions', error);
		}
	}

	/** The layout file in the repo, or else the positions kept in workspace storage. */
	private async readLayout(resource: URI): Promise<{ layout: FileLayout | null; isInRepo: boolean }> {
		try {
			return { layout: JSON.parse((await this.fileService.readFile(resource)).value.toString()) as FileLayout, isInRepo: true };
		} catch {
			const stored = this.storageService.get(layoutStorageKey(resource), StorageScope.WORKSPACE);
			return { layout: stored ? JSON.parse(stored) as FileLayout : null, isInRepo: false };
		}
	}

	/** A rename changes several files: one workspace edit, so undo reverts it in all of them. */
	private async applyRenameAcrossFiles(model: ITextModel, text: string, folder: URI, otherFiles: OtherFileChange[]) {
		const edits = [{ resource: model.uri, before: model.getValue(), after: text }, ...otherFiles.map(change => ({ resource: joinPath(folder, change.path), before: change.before, after: change.after }))]
			.map(({ resource, before, after }) => {
				const change = changedRegion(before, after);
				return new ResourceTextEdit(resource, { range: rangeOfOffsets(before, change.start, change.end), text: change.text });
			});
		try {
			await this.bulkEditService.apply(edits, { label: localize('codeCanvas.rename', "Rename"), quotableLabel: localize('codeCanvas.renameQuoted', "Rename") });
		} catch (error) {
			this.logService.error('[codeCanvas] rename failed', error);
		}
	}

	/**
	 * Blocks are edited in Monaco on the file's own document, with every line outside the block hidden.
	 * So IntelliSense, hovers and error squiggles work as in the text editor, and undo is the file's.
	 */
	private createBlockEditor(model: ITextModel, { parent, start, end, selection, onClose, diffBase }: EditorOptions): EditorHandle {
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
			editor.setHiddenAreas(linesOutsideBlock, CodeCanvasEditor);
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

		disposables.add(editor.onKeyDown(e => {
			const isSuggestOpen = editor.invokeWithinContext(accessor => accessor.get(IContextKeyService).getContextKeyValue<boolean>('suggestWidgetVisible'));
			const isClose = (e.keyCode === KeyCode.Escape && !isSuggestOpen) || (e.keyCode === KeyCode.Enter && (e.metaKey || e.ctrlKey));
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
		diffEditor.getOriginalEditor().setHiddenAreas(originalLinesOutsideBlock, CodeCanvasEditor);
		// After the diff editor, which still shows it until it's disposed.
		disposables.add(toDisposable(() => original.dispose()));
		return diffEditor.getModifiedEditor();
	}

	override clearInput(): void {
		this.inputDisposables.clear();
		super.clearInput();
	}

	override focus(): void {
		super.focus();
		this.canvas?.root.focus({ preventScroll: true });
	}

	override layout(dimension: Dimension): void {
		this.dimension = dimension;
		this.placeCodePanelAndCanvas();
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}
}

const BLOCK_EDITOR_OPTIONS = {
	automaticLayout: true,
	minimap: { enabled: false },
	scrollBeyondLastLine: false,
	lineNumbersMinChars: 3,
	fixedOverflowWidgets: true,
};

function layoutStorageKey(layoutResource: URI): string {
	return `codeCanvas.layout:${layoutResource.toString()}`;
}

/** Replace the document's text with `text` as one undo step, touching only the part that changed. */
function replaceText(model: ITextModel, text: string) {
	const before = model.getValue();
	if (before === text) {
		return;
	}
	const change = changedRegion(before, text);
	model.pushStackElement();
	model.pushEditOperations(null, [{ range: rangeOfOffsets(before, change.start, change.end, model), text: change.text }], () => null);
	model.pushStackElement();
}

function changedRegion(before: string, after: string): { start: number; end: number; text: string } {
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

function rangeOfOffsets(text: string, start: number, end: number, model?: ITextModel): Range {
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
