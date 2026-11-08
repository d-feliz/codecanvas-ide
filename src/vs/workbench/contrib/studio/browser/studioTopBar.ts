/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType, getWindow } from '../../../../base/browser/dom.js';
import { ActionsOrientation, prepareActions } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { ActionRunner, IAction, toAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { extname } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { WorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorCommandsContextActionRunner } from '../../../browser/parts/editor/editorTabsControl.js';
import { EditorResourceAccessor, GroupModelChangeKind, IEditorCommandsContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { CODE_CANVAS_FILE_EXTENSIONS, CODE_CANVAS_OPEN_AS_SPLIT_COMMAND_ID } from '../../codeCanvas/common/codeCanvas.js';
import { CodeCanvasEditor, onDidChangeCodeCanvasViewMode } from '../../codeCanvas/browser/codeCanvasEditor.js';
import { TEXT_FILE_EDITOR_ID } from '../../files/common/files.js';
import { ISCMViewService } from '../../scm/common/scm.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { ACCOUNTS_ACTIVITY_ID } from '../../../common/activity.js';
import { createActivityActionBar, StudioSignedInAccount } from './studioAccount.js';
import { STUDIO_GO_TO_ANYTHING_COMMAND_ID, STUDIO_TOGGLE_THEME_COMMAND_ID } from './studioGoToAnything.js';
import { studioIcon } from './studioIcons.js';

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
/** The canvas's own buttons for switching views; the top bar's Canvas / Code switch replaces them. */
const VIEW_SWITCHING_ACTION_IDS = new Set(['codeCanvas.openAsCanvas', 'codeCanvas.openAsText']);

type StudioViewMode = 'canvas' | 'code' | 'split';

/**
 * Studio's top bar, in place of VS Code's title bar: the project, branch and "Go to anything" on the
 * left, the open files in the middle, and the editor's actions, the view of the file, the theme, the
 * assistant and the account on the right.
 */
export class StudioTopBar extends Disposable {

	private readonly projectLabel: HTMLElement;
	private readonly branchButton: HTMLButtonElement;
	private readonly branchLabel: HTMLElement;
	private readonly openFiles: HTMLElement;
	private readonly openFilesList: HTMLElement;
	private readonly moreOpenFilesButton: HTMLButtonElement;
	private readonly viewModeGroup: HTMLElement;
	private readonly viewModeButtons = new Map<StudioViewMode, HTMLButtonElement>();
	private readonly themeButton: HTMLButtonElement;
	private readonly assistantButton: HTMLButtonElement;
	private readonly editorActionsToolBar: WorkbenchToolBar;
	private readonly activeGroupListener = this._register(new MutableDisposable());
	private readonly editorActionsListener = this._register(new DisposableStore());
	private readonly openFilePillListeners = this._register(new DisposableStore());
	private hiddenOpenFiles: EditorInput[] = [];

	constructor(
		container: HTMLElement,
		signedInAccount: StudioSignedInAccount,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILabelService private readonly labelService: ILabelService,
		@ISCMViewService private readonly scmViewService: ISCMViewService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IHoverService private readonly hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		const topBar = append(container, $('.studio-top-bar-content'));

		const leftGroup = append(topBar, $('.studio-top-group.studio-top-left'));
		const projectButton = this.createButton(leftGroup, 'studio-project', localize('studio.openRecent', "Open Recent"), () => this.commandService.executeCommand('workbench.action.openRecent'));
		projectButton.append(studioIcon('project', 18));
		this.projectLabel = append(projectButton, $('span.studio-project-name'));
		append(projectButton, $('span.studio-faint')).append(studioIcon('chevronDown', 12));
		this.branchButton = this.createButton(leftGroup, 'studio-branch', localize('studio.checkout', "Checkout to…"), () => this.commandService.executeCommand('git.checkout'));
		this.branchButton.append(studioIcon('branch', 14));
		this.branchLabel = append(this.branchButton, $('span'));
		const goToAnything = this.createButton(leftGroup, 'studio-go-to-anything', localize('studio.goToAnything', "Go to anything"), () => this.commandService.executeCommand(STUDIO_GO_TO_ANYTHING_COMMAND_ID));
		goToAnything.append(studioIcon('search', 14));
		append(goToAnything, $('span')).textContent = localize('studio.goToAnything', "Go to anything");
		append(goToAnything, $('span.studio-key')).textContent = '⌘K';

		this.openFiles = append(topBar, $('.studio-top-group.studio-open-files'));
		this.createButton(this.openFiles, 'studio-navigate', localize('studio.back', "Back"), () => this.commandService.executeCommand('workbench.action.navigateBack')).append(studioIcon('chevronLeft', 12));
		this.createButton(this.openFiles, 'studio-navigate', localize('studio.forward', "Forward"), () => this.commandService.executeCommand('workbench.action.navigateForward')).append(studioIcon('chevronRight', 12));
		append(this.openFiles, $('span.studio-divider'));
		this.openFilesList = append(this.openFiles, $('.studio-open-files-list'));
		this.moreOpenFilesButton = this.createButton(this.openFiles, 'studio-more-files', localize('studio.moreFiles', "More open files"), () => this.showHiddenOpenFiles());

		const rightGroup = append(topBar, $('.studio-top-group.studio-top-right'));
		this.editorActionsToolBar = this._register(instantiationService.createInstance(WorkbenchToolBar, append(rightGroup, $('.studio-editor-actions')), {
			orientation: ActionsOrientation.HORIZONTAL,
			ariaLabel: localize('studio.editorActions', "Editor actions"),
			telemetrySource: 'studioTopBar',
			hoverDelegate: getDefaultHoverDelegate('mouse'),
		}));
		this.viewModeGroup = append(rightGroup, $('.studio-segmented'));
		this.viewModeGroup.setAttribute('role', 'group');
		this.viewModeGroup.setAttribute('aria-label', localize('studio.viewMode', "View"));
		for (const [mode, label, commandId] of [['canvas', localize('studio.canvasView', "Canvas"), 'codeCanvas.openAsCanvas'], ['code', localize('studio.codeView', "Code"), 'codeCanvas.openAsText'], ['split', localize('studio.splitView', "Split"), CODE_CANVAS_OPEN_AS_SPLIT_COMMAND_ID]] as const) {
			const button = this.createButton(this.viewModeGroup, 'studio-segment', label, () => this.commandService.executeCommand(commandId));
			button.textContent = label;
			this.viewModeButtons.set(mode, button);
		}
		this.themeButton = this.createButton(rightGroup, 'studio-icon-button', localize('studio.toggleTheme', "Switch between the light and dark theme"), () => this.commandService.executeCommand(STUDIO_TOGGLE_THEME_COMMAND_ID));
		this.assistantButton = this.createButton(rightGroup, 'studio-icon-button', localize('studio.toggleAssistant', "Toggle Assistant"), () => this.commandService.executeCommand('workbench.action.toggleAuxiliaryBar'));
		this.assistantButton.append(studioIcon('assistant', 16));
		// VS Code's Accounts menu covers the whole pill; the "Sign in" text shows while no one is signed in.
		const account = append(rightGroup, $('.studio-top-account'));
		this._register(createActivityActionBar(account, [ACCOUNTS_ACTIVITY_ID], HoverPosition.BELOW, instantiationService));
		append(account, $('span.studio-sign-in')).textContent = localize('studio.signIn', "Sign in");
		const renderAccount = () => account.classList.toggle('studio-signed-in', !!signedInAccount.accountName);
		renderAccount();
		this._register(signedInAccount.onDidChange(renderAccount));

		this.renderProject();
		this._register(this.workspaceContextService.onDidChangeWorkspaceName(() => this.renderProject()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.renderProject()));
		this._register(autorun(reader => {
			const repository = this.scmViewService.activeRepository.read(reader)?.repository;
			const branchName = repository?.provider.historyProvider.read(reader)?.historyItemRef.read(reader)?.name;
			this.branchButton.style.display = branchName ? '' : 'none';
			this.branchLabel.textContent = branchName ?? '';
		}));
		this.renderThemeButton();
		this._register(this.themeService.onDidColorThemeChange(() => this.renderThemeButton()));
		this.renderAssistantButton();
		this._register(this.layoutService.onDidChangePartVisibility(() => this.renderAssistantButton()));

		this.listenToActiveGroup();
		this._register(this.editorGroupsService.mainPart.onDidChangeActiveGroup(() => this.listenToActiveGroup()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.renderViewMode()));
		this._register(onDidChangeCodeCanvasViewMode(() => this.renderViewMode()));
		this._register(new ResizeObserverDisposable(container, () => this.fitOpenFiles()));
	}

	private createButton(parent: HTMLElement, className: string, label: string, run: () => unknown): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>(`button.studio-button.${className}`));
		button.setAttribute('aria-label', label);
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, label));
		this._register(addDisposableListener(button, EventType.CLICK, () => run()));
		return button;
	}

	private renderProject(): void {
		this.projectLabel.textContent = this.labelService.getWorkspaceLabel(this.workspaceContextService.getWorkspace());
	}

	private renderThemeButton(): void {
		clearNode(this.themeButton);
		const isDark = this.themeService.getColorTheme().type === ColorScheme.DARK || this.themeService.getColorTheme().type === ColorScheme.HIGH_CONTRAST_DARK;
		this.themeButton.append(studioIcon(isDark ? 'moon' : 'sun', 16));
	}

	private renderAssistantButton(): void {
		const assistantIsOpen = this.layoutService.isVisible(Parts.AUXILIARYBAR_PART);
		this.assistantButton.setAttribute('aria-pressed', `${assistantIsOpen}`);
		this.assistantButton.classList.toggle('studio-pressed', assistantIsOpen);
	}

	private listenToActiveGroup(): void {
		const group = this.editorGroupsService.mainPart.activeGroup;
		this.activeGroupListener.value = group.onDidModelChange(change => {
			if (change.kind !== GroupModelChangeKind.EDITOR_LABEL) {
				this.renderOpenFiles();
			}
			if (change.kind === GroupModelChangeKind.EDITOR_ACTIVE) {
				this.renderEditorActions();
			}
		});
		this.renderOpenFiles();
		this.renderEditorActions();
		this.renderViewMode();
	}

	private renderOpenFiles(): void {
		const group = this.editorGroupsService.mainPart.activeGroup;
		clearNode(this.openFilesList);
		this.openFilePillListeners.clear();
		this.openFiles.style.display = group.editors.length ? '' : 'none';
		for (const editor of group.editors) {
			this.openFilesList.append(this.createOpenFilePill(group, editor));
		}
		this.fitOpenFiles();
	}

	private createOpenFilePill(group: IEditorGroup, editor: EditorInput): HTMLElement {
		const isActive = group.activeEditor === editor;
		const pill = $<HTMLButtonElement>('button.studio-button.studio-open-file');
		pill.classList.toggle('studio-active', isActive);
		pill.setAttribute('aria-label', editor.getTitle());
		append(pill, $(`span.studio-file-dot.${this.languageClassOf(editor)}`));
		append(pill, $('span.studio-open-file-name')).textContent = editor.getName();
		this.openFilePillListeners.add(addDisposableListener(pill, EventType.CLICK, () => group.openEditor(editor)));
		if (editor.isDirty()) {
			append(pill, $('span.studio-unsaved')).textContent = '●';
		}
		if (isActive) {
			const close = append(pill, $('span.studio-close-file'));
			close.textContent = '×';
			close.setAttribute('role', 'button');
			close.setAttribute('aria-label', localize('studio.closeFile', "Close"));
			this.openFilePillListeners.add(addDisposableListener(close, EventType.CLICK, event => {
				event.stopPropagation();
				group.closeEditor(editor);
			}));
		}
		return pill;
	}

	private languageClassOf(editor: EditorInput): string {
		const resource = EditorResourceAccessor.getOriginalUri(editor);
		const extension = resource ? extname(resource).toLowerCase() : '';
		if (TYPESCRIPT_EXTENSIONS.has(extension)) {
			return 'studio-file-ts';
		}
		if (JAVASCRIPT_EXTENSIONS.has(extension)) {
			return 'studio-file-js';
		}
		return 'studio-file-other';
	}

	/** Hides the open files that don't fit, last first and never the active one, behind a "+N" button. */
	private fitOpenFiles(): void {
		const group = this.editorGroupsService.mainPart.activeGroup;
		const pills = [...this.openFilesList.children] as HTMLElement[];
		for (const pill of pills) {
			pill.style.display = '';
		}
		this.hiddenOpenFiles = [];
		this.moreOpenFilesButton.style.display = 'none';
		const listOverflows = () => this.openFilesList.scrollWidth > this.openFilesList.clientWidth + 1;
		for (let index = pills.length - 1; index >= 0 && listOverflows(); index--) {
			const editor = group.editors[index];
			if (editor && editor !== group.activeEditor) {
				pills[index].style.display = 'none';
				this.hiddenOpenFiles.unshift(editor);
			}
		}
		if (this.hiddenOpenFiles.length) {
			this.moreOpenFilesButton.style.display = '';
			this.moreOpenFilesButton.textContent = `+${this.hiddenOpenFiles.length}`;
		}
	}

	private showHiddenOpenFiles(): void {
		const group = this.editorGroupsService.mainPart.activeGroup;
		this.contextMenuService.showContextMenu({
			getAnchor: () => this.moreOpenFilesButton,
			getActions: () => this.hiddenOpenFiles.map(editor => toAction({ id: 'studio.openFile', label: editor.getName(), run: () => group.openEditor(editor) })),
		});
	}

	private renderEditorActions(): void {
		this.editorActionsListener.clear();
		const group = this.editorGroupsService.mainPart.activeGroup;
		const update = () => {
			const editorActionsChangeListener = new DisposableStore();
			this.editorActionsListener.add(editorActionsChangeListener);
			const editorActions = group.createEditorActions(editorActionsChangeListener, MenuId.EditorTitle);
			const isShownInTopBar = (action: IAction) => !VIEW_SWITCHING_ACTION_IDS.has(action.id);
			this.editorActionsToolBar.setActions(prepareActions(editorActions.actions.primary.filter(isShownInTopBar)), prepareActions(editorActions.actions.secondary));
			editorActionsChangeListener.add(editorActions.onDidChange(() => {
				editorActionsChangeListener.dispose();
				update();
			}));
		};
		if (group.activeEditor) {
			const context: IEditorCommandsContext = { groupId: group.id };
			this.editorActionsToolBar.actionRunner = this.editorActionsListener.add(new EditorCommandsContextActionRunner(context));
			this.editorActionsToolBar.context = context;
			update();
		} else {
			this.editorActionsToolBar.actionRunner = this.editorActionsListener.add(new ActionRunner());
			this.editorActionsToolBar.setActions([]);
		}
	}

	private renderViewMode(): void {
		const viewMode = this.activeViewMode();
		this.viewModeGroup.style.display = viewMode ? '' : 'none';
		for (const [mode, button] of this.viewModeButtons) {
			button.classList.toggle('studio-active', mode === viewMode);
			button.setAttribute('aria-pressed', `${mode === viewMode}`);
		}
	}

	/** Canvas, Code or Split for a TypeScript or JavaScript file, nothing for any other editor. */
	private activeViewMode(): StudioViewMode | undefined {
		const activePane = this.editorService.activeEditorPane;
		if (activePane instanceof CodeCanvasEditor) {
			return activePane.getViewMode();
		}
		const resource = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor);
		const isCanvasFileInTextEditor = activePane?.getId() === TEXT_FILE_EDITOR_ID && !!resource && CODE_CANVAS_FILE_EXTENSIONS.includes(extname(resource).toLowerCase());
		return isCanvasFileInTextEditor ? 'code' : undefined;
	}
}

class ResizeObserverDisposable extends Disposable {
	constructor(element: HTMLElement, onResize: () => void) {
		super();
		const observer = new (getWindow(element).ResizeObserver)(() => onResize());
		observer.observe(element);
		this._register({ dispose: () => observer.disconnect() });
	}
}

