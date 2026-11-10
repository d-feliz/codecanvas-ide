/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codeCanvasEditor.css';
import { $, addDisposableListener, append, Dimension, EventType } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IBulkEditService, ResourceTextEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IResourceUndoRedoElement, IUndoRedoService, UndoRedoElementType } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { getDefinitionsAtPosition } from '../../../../editor/contrib/gotoSymbol/browser/goToSymbol.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickDiffService } from '../../scm/common/quickDiff.js';
import { IEditorOptions, ITextEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { getStudioEditorFreeArea, onDidChangeStudioEditorFreeArea } from '../../../browser/studio/studioShell.js';
import { DEFAULT_EDITOR_ASSOCIATION, IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CODE_CANVAS_EDITOR_ID, CODE_CANVAS_LAYOUT_FOLDER, CODE_CANVAS_OPEN_FLOW_COMMAND_ID, CODE_CANVAS_SHOWS_CHANGES } from '../common/codeCanvas.js';
import { CodeCanvas, Engine, FileLayout, LayoutEdit, loadEngine, OtherFileChange } from './codeCanvasEngine.js';
import { CodeCanvasEditorInput } from './codeCanvasEditorInput.js';
import { changedRegion, CodeCanvasBlockEditors, problemsOf, rangeOfOffsets, replaceText } from './codeCanvasBlockEditor.js';
import { selectBlockWhenCodeViewShows } from './codeCanvasCodeViewLanes.js';
import { ICodeCanvasProjectService } from './codeCanvasProjects.js';

/** Blocks to select once a canvas opens, when the user jumped to a block in another file. */
const blockToRevealByResource = new Map<string, string>();

export function revealBlockWhenCanvasOpens(resource: URI, blockId: string): void {
	blockToRevealByResource.set(resource.toString(), blockId);
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
	private shownFile: { canvas: CodeCanvas; model: ITextModel; layoutResource: URI } | undefined;
	private readonly committedVersionDisposables = this._register(new DisposableStore());
	private engine: Engine | undefined;
	private readonly blockEditors: CodeCanvasBlockEditors;

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
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
	) {
		super(CodeCanvasEditor.ID, group, telemetryService, themeService, storageService);
		this.showsChangesContext = CODE_CANVAS_SHOWS_CHANGES.bindTo(group.scopedContextKeyService);
		this.blockEditors = this.instantiationService.createInstance(CodeCanvasBlockEditors);
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
			createEditor: options => this.blockEditors.create(engine, model, options),
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
			// In the file's undo history, so undo and redo move blocks in order with the text edits.
			onLayoutEdit: edit => this.undoRedoService.pushElement(new CodeCanvasLayoutUndoElement(model.uri, edit, layout => this.putLayoutBack(engine, model.uri, layoutResource, layout))),
			onUndo: () => void model.undo(),
			onRedo: () => void model.redo(),
			onOpenCode: block => this.openCodeAt(model, block),
			onOpenImport: block => void this.openImportedFile(model, block),
			onAsk: block => this.askAbout(model, block),
			onOpenFlow: block => void this.commandService.executeCommand(CODE_CANVAS_OPEN_FLOW_COMMAND_ID, model.uri, block.id),
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

		// In Studio the canvas lies under the floating panels; it keeps the file and Fit clear of them.
		canvas.setViewInsets(getStudioEditorFreeArea());
		this.inputDisposables.add(onDidChangeStudioEditorFreeArea(freeArea => canvas.setViewInsets(freeArea)));
		canvas.openFile(path, model.getValue(), savedLayout.layout);
		this.shownFile = { canvas, model, layoutResource };
		this.inputDisposables.add(toDisposable(() => this.shownFile = undefined));
		void this.showChangesIfOn();
		// Errors come from VS Code's Problems (the TypeScript extension), not from the engine.
		const showProblems = () => canvas.setDiagnostics(problemsOf(this.markerService, model));
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

	/** "Open code" on a block: the Code view in place of the canvas, the cursor at the block and its lines tinted. */
	private openCodeAt(model: ITextModel, block: { id: string; start: number; nameStart: number }) {
		const input = this.input;
		if (!input) {
			return;
		}
		const declaration = model.getPositionAt(block.nameStart >= 0 ? block.nameStart : block.start);
		selectBlockWhenCodeViewShows(model.uri, block.id);
		// The canvas edits the file's text model, so its unsaved changes survive the switch.
		void this.editorService.replaceEditors([{
			editor: input,
			replacement: { resource: model.uri, options: { override: DEFAULT_EDITOR_ASSOCIATION.id, selection: Range.fromPositions(declaration), pinned: true } },
			forceReplaceDirty: true,
		}], this.group);
	}

	/** ⌘-click on an import block: the file TypeScript finds for its path, as Go to Definition on the path would. */
	private async openImportedFile(model: ITextModel, block: { start: number; end: number; name: string }) {
		const importText = model.getValue().slice(block.start, block.end);
		const quotedSpecifierAt = ['\'', '"', '`'].map(quote => importText.indexOf(quote + block.name + quote)).find(index => index >= 0);
		if (quotedSpecifierAt === undefined) {
			return;
		}
		const specifierPosition = model.getPositionAt(block.start + quotedSpecifierAt + 1);
		const [definition] = await getDefinitionsAtPosition(this.languageFeaturesService.definitionProvider, model, specifierPosition, false, CancellationToken.None);
		if (definition) {
			await this.editorService.openEditor({ resource: definition.uri });
		}
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


	/** Blocks use the same font as the text editor. */
	private applyEditorFont() {
		const fontFamily = this.configurationService.getValue<string>('editor.fontFamily');
		this.container?.style.setProperty('--cc-font', fontFamily || 'var(--monaco-monospace-font)');
	}

	/** Undoing or redoing a move: on the canvas if it shows the file, else straight into the layout file. */
	private async putLayoutBack(engine: Engine, resource: URI, layoutResource: URI, layout: FileLayout) {
		const shownFile = this.shownFile;
		const canvasShowsFile = !!shownFile && isEqual(shownFile.model.uri, resource);
		if (canvasShowsFile) {
			shownFile.canvas.setLayout(layout);
			return;
		}
		try {
			await this.fileService.writeFile(layoutResource, VSBuffer.fromString(engine.serializeLayout(layout, null)));
		} catch (error) {
			this.logService.error('[codeCanvas] could not save block positions', error);
		}
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


	override clearInput(): void {
		this.inputDisposables.clear();
		super.clearInput();
	}

	override focus(): void {
		super.focus();
		this.canvas?.root.focus({ preventScroll: true });
	}

	override layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}
}


class CodeCanvasLayoutUndoElement implements IResourceUndoRedoElement {
	readonly type = UndoRedoElementType.Resource;
	readonly code = 'codeCanvas.moveBlocks';
	readonly label: string;

	constructor(readonly resource: URI, private readonly edit: LayoutEdit, private readonly putLayout: (layout: FileLayout) => void) {
		this.label = edit.label;
	}

	undo(): void {
		this.putLayout(this.edit.before);
	}

	redo(): void {
		this.putLayout(this.edit.after);
	}
}

function layoutStorageKey(layoutResource: URI): string {
	return `codeCanvas.layout:${layoutResource.toString()}`;
}

