/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
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
import { CODE_CANVAS_EDITOR_ID, CODE_CANVAS_FILE_EXTENSIONS, CODE_CANVAS_FILE_PATTERN, CODE_CANVAS_SHOWS_CHANGES } from '../common/codeCanvas.js';
import { CodeCanvasEditor } from './codeCanvasEditor.js';
import { CodeCanvasEditorInput } from './codeCanvasEditorInput.js';
import { CodeCanvasProjectService, ICodeCanvasProjectService } from './codeCanvasProjects.js';

registerSingleton(ICodeCanvasProjectService, CodeCanvasProjectService, InstantiationType.Delayed);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CodeCanvasEditor, CodeCanvasEditor.ID, localize('codeCanvasEditor', "Code Canvas")),
	[new SyncDescriptor(CodeCanvasEditorInput)]
);

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

/** Offers the canvas in "Open With…" for TypeScript files. The text editor stays the default. */
class CodeCanvasEditorResolverContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.codeCanvasEditorResolver';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(editorResolverService.registerEditor(
			CODE_CANVAS_FILE_PATTERN,
			{
				id: CODE_CANVAS_EDITOR_ID,
				label: localize('codeCanvas.displayName', "Code Canvas"),
				detail: DEFAULT_EDITOR_ASSOCIATION.providerDisplayName,
				priority: RegisteredEditorPriority.option,
			},
			{},
			{
				createEditorInput: ({ resource }) => ({ editor: instantiationService.createInstance(CodeCanvasEditorInput, resource) }),
			}
		));
	}
}
registerWorkbenchContribution2(CodeCanvasEditorResolverContribution.ID, CodeCanvasEditorResolverContribution, WorkbenchPhase.BlockStartup);

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
			precondition: textEditorOnCanvasFile,
			menu: { id: MenuId.EditorTitle, group: 'navigation', when: textEditorOnCanvasFile },
		});
	}

	run(accessor: ServicesAccessor, ...args: unknown[]): Promise<unknown> {
		return accessor.get(ICommandService).executeCommand(REOPEN_ACTIVE_EDITOR_WITH_COMMAND_ID, CODE_CANVAS_EDITOR_ID, ...args);
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
