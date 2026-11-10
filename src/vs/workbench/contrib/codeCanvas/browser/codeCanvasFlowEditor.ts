/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codeCanvasEditor.css';
import { $, addDisposableListener, append, Dimension, EventType } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickDiffService } from '../../scm/common/quickDiff.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { getStudioEditorFreeArea, onDidChangeStudioEditorFreeArea } from '../../../browser/studio/studioShell.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CODE_CANVAS_EDITOR_ID, CODE_CANVAS_FLOW_EDITOR_ID, CODE_CANVAS_FLOW_MAX_FUNCTIONS_SETTING, CODE_CANVAS_SHOWS_CHANGES } from '../common/codeCanvas.js';
import { CodeCanvasBlockEditors, problemsOf, replaceText } from './codeCanvasBlockEditor.js';
import { revealBlockWhenCanvasOpens } from './codeCanvasEditor.js';
import { EditorHandle, EditorOptions, Engine, FlowCanvas, FlowLayout, loadEngine } from './codeCanvasEngine.js';
import { CodeCanvasFlowEditorInput } from './codeCanvasFlowEditorInput.js';
import { freeFlowResource, writeFlow } from './codeCanvasFlows.js';
import { ICodeCanvasProjectService } from './codeCanvasProjects.js';

const SAVE_DELAY_MS = 400;

/** A Flow view in its own tab: the engine's flow canvas, on the files of one workspace folder. */
export class CodeCanvasFlowEditor extends EditorPane {

	static readonly ID = CODE_CANVAS_FLOW_EDITOR_ID;

	private container: HTMLElement | undefined;
	private flow: FlowCanvas | undefined;
	private readonly inputDisposables = this._register(new DisposableStore());
	private readonly blockEditors: CodeCanvasBlockEditors;
	private showsChanges = false;
	private readonly showsChangesContext: IContextKey<boolean>;
	private folderOfFlow: URI | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IModelService private readonly modelService: IModelService,
		@IFileService private readonly fileService: IFileService,
		@ICodeCanvasProjectService private readonly projectService: ICodeCanvasProjectService,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ILogService private readonly logService: ILogService,
		@IQuickDiffService private readonly quickDiffService: IQuickDiffService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(CodeCanvasFlowEditor.ID, group, telemetryService, themeService, storageService);
		this.blockEditors = instantiationService.createInstance(CodeCanvasBlockEditors);
		this.showsChangesContext = CODE_CANVAS_SHOWS_CHANGES.bindTo(group.scopedContextKeyService);
	}

	/** Show or hide what changed in the flow's files since their last commit. */
	async toggleChanges(): Promise<void> {
		this.showsChanges = !this.showsChanges;
		this.showsChangesContext.set(this.showsChanges);
		await this.showChangesIfOn();
	}

	private async showChangesIfOn() {
		const flow = this.flow;
		const folder = this.folderOfFlow;
		if (!flow || !folder) {
			return;
		}
		if (!this.showsChanges) {
			return flow.setDiffBases(null);
		}
		const layout = flow.getLayout();
		const paths = new Set([layout.start.path, ...(flow.getFlow()?.nodes.map(node => node.path) ?? []), ...layout.added.map(key => key.slice(0, key.indexOf('#')))]);
		const bases: Record<string, string> = {};
		for (const path of paths) {
			const committed = await this.readCommittedText(joinPath(folder, path));
			if (committed !== undefined) {
				bases[path] = committed;
			}
		}
		if (!Object.keys(bases).length) {
			this.notificationService.info(localize('codeCanvas.flowNoCommittedVersion', "These files have no committed version to compare with."));
			this.showsChanges = false;
			this.showsChangesContext.set(false);
			return;
		}
		if (this.flow === flow && this.showsChanges) {
			flow.setDiffBases(bases);
		}
	}

	/** A file as source control has it (git: HEAD or the staged version), as the file canvas reads it. */
	private async readCommittedText(resource: URI): Promise<string | undefined> {
		try {
			const quickDiffs = await this.quickDiffService.getQuickDiffs(resource);
			const sourceControl = quickDiffs.find(quickDiff => quickDiff.kind === 'primary') ?? quickDiffs[0];
			if (!sourceControl) {
				return undefined;
			}
			const reference = await this.textModelService.createModelReference(sourceControl.originalResource);
			try {
				return reference.object.textEditorModel.getValue();
			} finally {
				reference.dispose();
			}
		} catch {
			return undefined;
		}
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('.code-canvas-editor.code-canvas-flow-editor'));
		const fontFamily = this.configurationService.getValue<string>('editor.fontFamily');
		this.container.style.setProperty('--cc-font', fontFamily || 'var(--monaco-monospace-font)');
		// The flow handles its own shortcuts (F2, Delete…): keys it handled must not also run a workbench command.
		this._register(addDisposableListener(this.container, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.defaultPrevented) {
				e.stopPropagation();
			}
		}));
	}

	override async setInput(input: CodeCanvasFlowEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.inputDisposables.clear();
		await super.setInput(input, options, context, token);
		const folder = input.folder;
		const [engine, folderProject] = await Promise.all([loadEngine(), this.projectService.getFolderProject(folder)]);
		if (token.isCancellationRequested || !this.container) {
			return;
		}

		let layoutToSave: FlowLayout | undefined;
		const flowSaver = this.inputDisposables.add(new RunOnceScheduler(() => {
			const resource = input.resource;
			if (layoutToSave && resource) {
				writeFlow(this.fileService, resource, layoutToSave).catch(error => this.logService.error('[codeCanvas] could not save the flow', error));
			}
		}, SAVE_DELAY_MS));

		const flow: FlowCanvas = this.flow = new engine.FlowCanvas(this.container, {
			project: folderProject.project,
			theme: isDark(this.themeService.getColorTheme().type) ? 'dark' : 'light',
			maxFunctions: this.configurationService.getValue<number>(CODE_CANVAS_FLOW_MAX_FUNCTIONS_SETTING) || undefined,
			createEditor: editorOptions => this.createBlockEditor(engine, folder, editorOptions),
			onTextChange: (path, text) => void this.changeFile(joinPath(folder, path), text),
			onLayoutChange: (layout, reason) => {
				input.setLayout(layout);
				layoutToSave = layout;
				// A temporary flow is pinned by the first change the user makes: from then on it is a file.
				const pinsTheFlow = reason === 'user' && !input.isPinnedFlow;
				if (pinsTheFlow) {
					void freeFlowResource(this.fileService, folder, layout.name).then(resource => {
						input.pin(resource);
						flowSaver.schedule();
					});
				} else if (input.isPinnedFlow) {
					flowSaver.schedule();
				}
			},
			onOpenBlock: (path, blockId) => {
				const resource = joinPath(folder, path);
				revealBlockWhenCanvasOpens(resource, blockId);
				void this.editorService.openEditor({ resource, options: { override: CODE_CANVAS_EDITOR_ID } }, this.group);
			},
			pickFile: async () => {
				const paths = folderProject.project.paths().filter(path => !path.includes('node_modules/')).sort();
				const picked = await this.quickInputService.pick(paths.map(path => ({ label: path })), { placeHolder: localize('codeCanvas.pickFlowFile', "The file to create the function in") });
				return picked?.label;
			},
		});
		this.inputDisposables.add(toDisposable(() => {
			flowSaver.flush();
			flow.destroy();
			if (this.flow === flow) {
				this.flow = undefined;
			}
		}));

		flow.setViewInsets(getStudioEditorFreeArea());
		this.inputDisposables.add(onDidChangeStudioEditorFreeArea(freeArea => flow.setViewInsets(freeArea)));
		flow.open(input.getLayout());
		this.folderOfFlow = folder;
		this.inputDisposables.add(toDisposable(() => this.folderOfFlow = undefined));
		void this.showChangesIfOn();
		this.inputDisposables.add(folderProject.onDidChangeOtherFiles(() => flow.refreshSoon()));
		this.inputDisposables.add(this.themeService.onDidColorThemeChange(theme => flow.setTheme(isDark(theme.type) ? 'dark' : 'light')));
		// Errors come from VS Code's Problems (the TypeScript extension), as on the file canvas.
		this.inputDisposables.add(this.markerService.onMarkerChanged(resources => {
			for (const resource of resources) {
				const model = this.modelService.getModel(resource);
				const path = isEqualOrParent(resource, folder) ? folderProject.projectPath(resource) : undefined;
				if (model && path) {
					flow.setDiagnostics(path, problemsOf(this.markerService, model));
				}
			}
		}));
	}

	/** The block's file may not be open yet: the editor fills in once its document is loaded. */
	private createBlockEditor(engine: Engine, folder: URI, editorOptions: EditorOptions): EditorHandle {
		const disposables = new DisposableStore();
		let editor: EditorHandle | undefined;
		let wantsFocus = false;
		const resource = joinPath(folder, editorOptions.path ?? '');
		void this.textModelService.createModelReference(resource).then(reference => {
			if (disposables.isDisposed) {
				reference.dispose();
				return;
			}
			disposables.add(reference);
			editor = this.blockEditors.create(engine, reference.object.textEditorModel, editorOptions);
			disposables.add(toDisposable(() => editor?.destroy()));
			if (wantsFocus) {
				editor.focus();
			}
		}, error => this.logService.error('[codeCanvas] could not open the block\'s file', error));
		return {
			focus: () => editor ? editor.focus() : (wantsFocus = true),
			destroy: () => disposables.dispose(),
			editsFile: true,
		};
	}

	/** The flow changed a file (a new, deleted or renamed function): through its document, so undo and unsaved changes work. */
	private async changeFile(resource: URI, text: string) {
		const reference = await this.textModelService.createModelReference(resource);
		try {
			replaceText(reference.object.textEditorModel, text);
		} finally {
			reference.dispose();
		}
	}

	override clearInput(): void {
		this.inputDisposables.clear();
		super.clearInput();
	}

	override focus(): void {
		super.focus();
		this.flow?.root.focus({ preventScroll: true });
	}

	override layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}
}
