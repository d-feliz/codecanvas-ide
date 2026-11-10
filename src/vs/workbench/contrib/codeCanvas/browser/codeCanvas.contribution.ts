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
import { DEFAULT_EDITOR_ASSOCIATION, EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { TEXT_FILE_EDITOR_ID } from '../../files/common/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Schemas } from '../../../../base/common/network.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Extensions as WorkbenchConfigurationExtensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';
import { CODE_CANVAS_DEFAULT_SETTING, CODE_CANVAS_DEFAULT_SETTING_BEFORE_JAVASCRIPT, CODE_CANVAS_EDITOR_ID, CODE_CANVAS_FILE_EXTENSIONS, CODE_CANVAS_FILE_PATTERN, CODE_CANVAS_FLOW_EDITOR_ID, CODE_CANVAS_FLOW_MAX_FUNCTIONS_SETTING, CODE_CANVAS_OPEN_FLOW_COMMAND_ID, CODE_CANVAS_SHOWS_CHANGES } from '../common/codeCanvas.js';
import { CodeCanvasFlowEditor } from './codeCanvasFlowEditor.js';
import { CodeCanvasFlowEditorInput } from './codeCanvasFlowEditorInput.js';
import { CODE_CANVAS_FLOW_VIEWS_ID, CODE_CANVAS_FLOW_VIEWS_TITLE, CodeCanvasFlowViews } from './codeCanvasFlowViews.js';
import { loadEngine, type FlowLayout } from './codeCanvasEngine.js';
import { dirname } from '../../../../base/common/resources.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Extensions as ViewExtensions, IViewsRegistry } from '../../../common/views.js';
import { VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { CodeCanvasEditor } from './codeCanvasEditor.js';
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
		[CODE_CANVAS_FLOW_MAX_FUNCTIONS_SETTING]: {
			type: 'number',
			default: 200,
			minimum: 10,
			markdownDescription: localize('codeCanvas.flowMaxFunctionsSetting', "The most functions a Flow view shows. A bigger flow is cut, and says so."),
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
const canvasOrFlowEditorActive = ContextKeyExpr.or(canvasEditorActive, ActiveEditorContext.isEqualTo(CODE_CANVAS_FLOW_EDITOR_ID));

registerAction2(class OpenAsCanvasAction extends Action2 {
	constructor() {
		super({
			id: 'codeCanvas.openAsCanvas',
			title: localize2('codeCanvas.openAsCanvas', "Open as Canvas"),
			category: localize2('codeCanvas.category', "Code Canvas"),
			icon: Codicon.typeHierarchy,
			f1: true,
			precondition: textEditorOnCanvasFile,
			menu: { id: MenuId.EditorTitle, group: 'navigation', when: textEditorOnCanvasFile },
		});
	}

	run(accessor: ServicesAccessor, ...args: unknown[]): Promise<unknown> {
		return accessor.get(ICommandService).executeCommand(REOPEN_ACTIVE_EDITOR_WITH_COMMAND_ID, CODE_CANVAS_EDITOR_ID, ...args);
	}
});

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
			precondition: canvasOrFlowEditorActive,
			menu: { id: MenuId.EditorTitle, group: 'navigation', when: canvasOrFlowEditorActive },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const activePane = accessor.get(IEditorService).activeEditorPane;
		if (activePane instanceof CodeCanvasEditor || activePane instanceof CodeCanvasFlowEditor) {
			await activePane.toggleChanges();
		}
	}
});

// ---------------------------------------------------------------- Flow views

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CodeCanvasFlowEditor, CodeCanvasFlowEditor.ID, localize('codeCanvasFlowEditor', "Flow View")),
	[new SyncDescriptor(CodeCanvasFlowEditorInput)]
);
studioWindowFillingEditorIds.add(CodeCanvasFlowEditor.ID);

class CodeCanvasFlowEditorInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: CodeCanvasFlowEditorInput): string {
		return JSON.stringify({ folder: input.folder.toJSON(), layout: input.getLayout(), resource: input.resource?.toJSON() });
	}

	deserialize(_instantiationService: IInstantiationService, serialized: string): CodeCanvasFlowEditorInput {
		const { folder, layout, resource } = JSON.parse(serialized) as { folder: UriComponents; layout: FlowLayout; resource?: UriComponents };
		return new CodeCanvasFlowEditorInput(URI.revive(folder), layout, resource ? URI.revive(resource) : undefined);
	}
}
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(CodeCanvasFlowEditorInput.ID, CodeCanvasFlowEditorInputSerializer);

registerAction2(class OpenFlowAction extends Action2 {
	constructor() {
		super({
			id: CODE_CANVAS_OPEN_FLOW_COMMAND_ID,
			title: localize2('codeCanvas.openFlow', "Open Flow"),
			category: localize2('codeCanvas.category', "Code Canvas"),
			f1: true,
			menu: { id: MenuId.EditorContext, group: 'navigation', order: 100, when: isCanvasFile },
		});
	}

	/** From a block (the canvas's menu passes its file and block id), or else the function at the text cursor. */
	async run(accessor: ServicesAccessor, resourceArg?: URI, blockIdArg?: string): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const projectService = accessor.get(ICodeCanvasProjectService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);
		const textEditor = editorService.activeTextEditorControl;
		const textModel = isCodeEditor(textEditor) ? textEditor.getModel() : null;
		const resource = URI.isUri(resourceArg) ? resourceArg : textModel?.uri;
		if (!resource) {
			return;
		}
		const folder = workspaceContextService.getWorkspaceFolder(resource)?.uri ?? dirname(resource);
		const [engine, folderProject] = await Promise.all([loadEngine(), projectService.getFolderProject(folder)]);
		const path = folderProject.projectPath(resource);
		const fileModel = path ? folderProject.project.getModel(path) : undefined;
		if (!path || !fileModel) {
			return;
		}
		let block = typeof blockIdArg === 'string' ? fileModel.blocks.get(blockIdArg) : undefined;
		const cursor = isCodeEditor(textEditor) ? textEditor.getPosition() : null;
		if (!block && textModel && cursor) {
			block = engine.blockAt(fileModel, textModel.getOffsetAt(cursor)) ?? undefined;
			while (block && block.kind !== 'function' && block.kind !== 'component') {
				block = block.parentId ? fileModel.blocks.get(block.parentId) : undefined;
			}
		}
		if (!block) {
			notificationService.info(localize('codeCanvas.noFunctionHere', "Put the cursor inside a function to open its flow."));
			return;
		}
		const layout = engine.emptyFlowLayout({ path, blockId: block.id }, block.name);
		await editorService.openEditor(new CodeCanvasFlowEditorInput(folder, layout, undefined));
	}
});

const flowViewsIcon = registerIcon('code-canvas-flow-views-view-icon', Codicon.typeHierarchySub, localize('codeCanvasFlowViewsIcon', "View icon of the Flow views view."));
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: CODE_CANVAS_FLOW_VIEWS_ID,
	name: CODE_CANVAS_FLOW_VIEWS_TITLE,
	containerIcon: flowViewsIcon,
	ctorDescriptor: new SyncDescriptor(CodeCanvasFlowViews),
	canToggleVisibility: true,
	canMoveView: true,
	collapsed: true,
	order: 3,
	weight: 20,
}], VIEW_CONTAINER);
