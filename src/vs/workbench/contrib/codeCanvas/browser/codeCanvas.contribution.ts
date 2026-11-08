/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { REOPEN_ACTIVE_EDITOR_WITH_COMMAND_ID } from '../../../browser/parts/editor/editorCommands.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ActiveEditorContext, ResourceContextKey } from '../../../common/contextkeys.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorExtensions, EditorResourceAccessor, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { TEXT_FILE_EDITOR_ID } from '../../files/common/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Schemas } from '../../../../base/common/network.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Extensions as WorkbenchConfigurationExtensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';
import { CODE_CANVAS_DEFAULT_SETTING, CODE_CANVAS_DEFAULT_SETTING_BEFORE_JAVASCRIPT, CODE_CANVAS_EDITOR_ID, CODE_CANVAS_FILE_EXTENSIONS, CODE_CANVAS_FILE_PATTERN, CODE_CANVAS_OPEN_AS_SPLIT_COMMAND_ID, CODE_CANVAS_SHOWS_CHANGES } from '../common/codeCanvas.js';
import { CodeCanvasEditor, CodeCanvasViewMode, codeCanvasViewModeStorageKey } from './codeCanvasEditor.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { studioWindowFillingEditorIds } from '../../../browser/studio/studioShell.js';
import { CodeCanvasEditorInput } from './codeCanvasEditorInput.js';
import { CodeCanvasCodeViewLanes } from './codeCanvasCodeViewLanes.js';
import { CodeCanvasProjectService, ICodeCanvasProjectService } from './codeCanvasProjects.js';

registerSingleton(ICodeCanvasProjectService, CodeCanvasProjectService, InstantiationType.Delayed);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'codeCanvas',
	title: localize('codeCanvasConfigurationTitle', "Code Canvas"),
	type: 'object',
	properties: {
		[CODE_CANVAS_DEFAULT_SETTING]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize('codeCanvas.openAsCanvasSetting', "Open TypeScript and JavaScript files as a canvas. When off, they open as text and the canvas is in **Open With…** and the editor title bar."),
		},
	},
});

Registry.as<IConfigurationMigrationRegistry>(WorkbenchConfigurationExtensions.ConfigurationMigration).registerConfigurationMigrations([{
	key: CODE_CANVAS_DEFAULT_SETTING_BEFORE_JAVASCRIPT,
	migrateFn: value => [[CODE_CANVAS_DEFAULT_SETTING, { value }], [CODE_CANVAS_DEFAULT_SETTING_BEFORE_JAVASCRIPT, { value: undefined }]],
}]);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CodeCanvasEditor, CodeCanvasEditor.ID, localize('codeCanvasEditor', "Code Canvas")),
	[new SyncDescriptor(CodeCanvasEditorInput)]
);
studioWindowFillingEditorIds.add(CodeCanvasEditor.ID);

class CodeCanvasEditorInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: CodeCanvasEditorInput): string {
		return JSON.stringify({ resource: input.resource.toJSON() });
	}

	deserialize(instantiationService: IInstantiationService, serialized: string): CodeCanvasEditorInput {
		const { resource } = JSON.parse(serialized) as { resource: UriComponents };
		return instantiationService.createInstance(CodeCanvasEditorInput, URI.revive(resource));
	}
}
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(CodeCanvasEditorInput.ID, CodeCanvasEditorInputSerializer);

/**
 * TypeScript and JavaScript files open as a canvas by default (the setting turns that off, leaving the canvas in
 * "Open With…"). Diffs, and files that aren't on disk (e.g. a git version), keep the text editor.
 */
class CodeCanvasEditorResolverContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.codeCanvasEditorResolver';

	private readonly registration = this._register(new MutableDisposable());

	constructor(
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.register();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CODE_CANVAS_DEFAULT_SETTING)) {
				this.register();
			}
		}));
	}

	private register() {
		const isDefault = this.configurationService.getValue<boolean>(CODE_CANVAS_DEFAULT_SETTING) !== false;
		this.registration.value = this.editorResolverService.registerEditor(
			CODE_CANVAS_FILE_PATTERN,
			{
				id: CODE_CANVAS_EDITOR_ID,
				label: localize('codeCanvas.displayName', "Code Canvas"),
				detail: DEFAULT_EDITOR_ASSOCIATION.providerDisplayName,
				priority: isDefault ? RegisteredEditorPriority.default : RegisteredEditorPriority.option,
			},
			{ canSupportResource: resource => isOnDisk(resource) && !isMinified(resource) },
			{
				createEditorInput: ({ resource, options }) => ({ editor: this.instantiationService.createInstance(CodeCanvasEditorInput, resource), options }),
			}
		);
	}
}
const isOnDisk = (resource: URI) => resource.scheme === Schemas.file || resource.scheme === Schemas.vscodeRemote;
/** A minified bundle is one long line of code: nothing to see as a canvas. */
const isMinified = (resource: URI) => /\.min\.[cm]?js$/.test(resource.path);

registerWorkbenchContribution2(CodeCanvasEditorResolverContribution.ID, CodeCanvasEditorResolverContribution, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(CodeCanvasCodeViewLanes.ID, CodeCanvasCodeViewLanes, WorkbenchPhase.AfterRestored);

const isCanvasFile = ContextKeyExpr.or(...CODE_CANVAS_FILE_EXTENSIONS.map(extension => ResourceContextKey.Extension.isEqualTo(extension)));
const textEditorOnCanvasFile = ContextKeyExpr.and(ActiveEditorContext.isEqualTo(TEXT_FILE_EDITOR_ID), isCanvasFile);
const canvasEditorActive = ActiveEditorContext.isEqualTo(CODE_CANVAS_EDITOR_ID);

registerAction2(class OpenAsCanvasAction extends Action2 {
	constructor() {
		super({
			id: 'codeCanvas.openAsCanvas',
			title: localize2('codeCanvas.openAsCanvas', "Open as Canvas"),
			category: localize2('codeCanvas.category', "Code Canvas"),
			icon: Codicon.typeHierarchy,
			f1: true,
			precondition: ContextKeyExpr.or(textEditorOnCanvasFile, canvasEditorActive),
			menu: { id: MenuId.EditorTitle, group: 'navigation', when: textEditorOnCanvasFile },
		});
	}

	async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<unknown> {
		return openCanvasIn(accessor, 'canvas', args);
	}
});

registerAction2(class OpenAsSplitAction extends Action2 {
	constructor() {
		super({
			id: CODE_CANVAS_OPEN_AS_SPLIT_COMMAND_ID,
			title: localize2('codeCanvas.openAsSplit', "Open in Split View"),
			category: localize2('codeCanvas.category', "Code Canvas"),
			f1: true,
			precondition: ContextKeyExpr.or(textEditorOnCanvasFile, canvasEditorActive),
		});
	}

	async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<unknown> {
		return openCanvasIn(accessor, 'split', args);
	}
});

/** The canvas, alone or with the code beside it. From the text editor, the file reopens as a canvas. */
async function openCanvasIn(accessor: ServicesAccessor, viewMode: CodeCanvasViewMode, args: unknown[]): Promise<unknown> {
	const editorService = accessor.get(IEditorService);
	const activePane = editorService.activeEditorPane;
	if (activePane instanceof CodeCanvasEditor) {
		return activePane.setViewMode(viewMode);
	}
	const resource = EditorResourceAccessor.getOriginalUri(editorService.activeEditor);
	if (resource) {
		accessor.get(IStorageService).store(codeCanvasViewModeStorageKey(resource), viewMode, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}
	return accessor.get(ICommandService).executeCommand(REOPEN_ACTIVE_EDITOR_WITH_COMMAND_ID, CODE_CANVAS_EDITOR_ID, ...args);
}

registerAction2(class AddFunctionAction extends Action2 {
	constructor() {
		super({
			id: 'codeCanvas.addFunction',
			title: localize2('codeCanvas.addFunction', "Add Function"),
			category: localize2('codeCanvas.category', "Code Canvas"),
			f1: true,
			precondition: canvasEditorActive,
		});
	}

	run(accessor: ServicesAccessor): void {
		const activePane = accessor.get(IEditorService).activeEditorPane;
		if (activePane instanceof CodeCanvasEditor) {
			activePane.addFunction();
		}
	}
});

registerAction2(class OpenAsTextAction extends Action2 {
	constructor() {
		super({
			id: 'codeCanvas.openAsText',
			title: localize2('codeCanvas.openAsText', "Open as Text"),
			category: localize2('codeCanvas.category', "Code Canvas"),
			icon: Codicon.goToFile,
			f1: true,
			precondition: canvasEditorActive,
			menu: { id: MenuId.EditorTitle, group: 'navigation', when: canvasEditorActive },
		});
	}

	run(accessor: ServicesAccessor, ...args: unknown[]): Promise<unknown> {
		return accessor.get(ICommandService).executeCommand(REOPEN_ACTIVE_EDITOR_WITH_COMMAND_ID, DEFAULT_EDITOR_ASSOCIATION.id, ...args);
	}
});

registerAction2(class ToggleChangesAction extends Action2 {
	constructor() {
		super({
			id: 'codeCanvas.toggleChanges',
			title: localize2('codeCanvas.showChanges', "Show Changes"),
			category: localize2('codeCanvas.category', "Code Canvas"),
			icon: Codicon.diffSingle,
			toggled: { condition: CODE_CANVAS_SHOWS_CHANGES, title: localize('codeCanvas.hideChanges', "Hide Changes") },
			f1: true,
			precondition: canvasEditorActive,
			menu: { id: MenuId.EditorTitle, group: 'navigation', when: canvasEditorActive },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const activePane = accessor.get(IEditorService).activeEditorPane;
		if (activePane instanceof CodeCanvasEditor) {
			await activePane.toggleChanges();
		}
	}
});
