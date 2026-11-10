/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { Action } from '../../../../base/common/actions.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { isEqual } from '../../../../base/common/resources.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CodeCanvasFlowEditorInput } from './codeCanvasFlowEditorInput.js';
import { flowsFolder, freeFlowResource, listSavedFlows, SavedFlow, writeFlow } from './codeCanvasFlows.js';

export const CODE_CANVAS_FLOW_VIEWS_ID = 'codeCanvas.flowViews';
export const CODE_CANVAS_FLOW_VIEWS_TITLE = localize2('codeCanvas.flowViews', "Flow views");

/** The saved flows of every workspace folder: click to open, double-click or right-click to rename or delete. */
export class CodeCanvasFlowViews extends ViewPane {

	private list: HTMLElement | undefined;
	private readonly refreshSoon = this._register(new RunOnceScheduler(() => void this.renderFlows(), 200));

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(fileService.onDidFilesChange(e => {
			const touchesFlows = workspaceContextService.getWorkspace().folders.some(folder => e.affects(flowsFolder(folder.uri)));
			if (touchesFlows) {
				this.refreshSoon.schedule();
			}
		}));
		this._register(workspaceContextService.onDidChangeWorkspaceFolders(() => this.refreshSoon.schedule()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.list = append(container, $('.code-canvas-flow-views'));
		void this.renderFlows();
	}

	private async renderFlows() {
		const list = this.list;
		if (!list) {
			return;
		}
		const flows = await listSavedFlows(this.fileService, this.workspaceContextService);
		clearNode(list);
		if (!flows.length) {
			append(list, $('.code-canvas-flow-views-empty')).textContent = localize('codeCanvas.noFlows', "No saved flows. Right-click a function and pick Open Flow; a flow is saved once you change it.");
			return;
		}
		for (const flow of flows) {
			const row = append(list, $('button.code-canvas-flow-row', { type: 'button' }));
			append(row, $('span.code-canvas-flow-name')).textContent = flow.layout.name;
			append(row, $('span.code-canvas-flow-count')).textContent = String(Object.keys(flow.layout.nodes).length);
			row.addEventListener('click', () => void this.open(flow));
			row.addEventListener('dblclick', () => void this.rename(flow));
			row.addEventListener('contextmenu', e => {
				e.preventDefault();
				this.contextMenuService.showContextMenu({
					getAnchor: () => new StandardMouseEvent(getWindow(row), e),
					getActions: () => [
						new Action('codeCanvas.renameFlow', localize('codeCanvas.renameFlow', "Rename"), undefined, true, () => this.rename(flow)),
						new Action('codeCanvas.deleteFlow', localize('codeCanvas.deleteFlow', "Delete"), undefined, true, () => this.delete(flow)),
					],
				});
			});
		}
	}

	private async open(flow: SavedFlow) {
		const openInput = this.editorService.editors.find(editor => editor instanceof CodeCanvasFlowEditorInput && isEqual(editor.resource, flow.resource));
		await this.editorService.openEditor(openInput ?? new CodeCanvasFlowEditorInput(flow.folder, flow.layout, flow.resource));
	}

	private async rename(flow: SavedFlow) {
		const name = await this.quickInputService.input({ value: flow.layout.name, prompt: localize('codeCanvas.flowNamePrompt', "The flow's name") });
		const newName = name?.trim();
		if (!newName || newName === flow.layout.name) {
			return;
		}
		const resource = await freeFlowResource(this.fileService, flow.folder, newName);
		await writeFlow(this.fileService, resource, { ...flow.layout, name: newName });
		await this.fileService.del(flow.resource);
		for (const editor of this.editorService.editors) {
			if (editor instanceof CodeCanvasFlowEditorInput && isEqual(editor.resource, flow.resource)) {
				editor.setLayout({ ...editor.getLayout(), name: newName });
				editor.pin(resource);
			}
		}
	}

	private async delete(flow: SavedFlow) {
		await this.fileService.del(flow.resource, { useTrash: true });
	}
}
