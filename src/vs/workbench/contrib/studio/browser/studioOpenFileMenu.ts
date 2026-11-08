/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ActiveEditorCannotCloseContext, ActiveEditorDirtyContext, ActiveEditorFirstInGroupContext, ActiveEditorLastInGroupContext, ActiveEditorPinnedContext, ActiveEditorStickyContext, EditorTabsVisibleContext, ResourceContextKey } from '../../../common/contextkeys.js';
import { EditorInputCapabilities, EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

/**
 * The right-click menu of an open file in Studio's top bar: VS Code's editor tab menu (Close, Close
 * Others, Close to the Right, Close All, Copy Path…), with the context keys a tab would set for that file.
 */
export class StudioOpenFileMenu extends Disposable {

	private readonly menuContextKeyService: IContextKeyService;
	private readonly resourceContext: ResourceContextKey;
	private readonly editorPinnedContext: IContextKey<boolean>;
	private readonly editorIsFirstContext: IContextKey<boolean>;
	private readonly editorIsLastContext: IContextKey<boolean>;
	private readonly editorStickyContext: IContextKey<boolean>;
	private readonly editorDirtyContext: IContextKey<boolean>;
	private readonly editorCannotCloseContext: IContextKey<boolean>;

	constructor(
		container: HTMLElement,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super();
		this.menuContextKeyService = this._register(contextKeyService.createScoped(container));
		const scopedInstantiationService = this._register(instantiationService.createChild(new ServiceCollection([IContextKeyService, this.menuContextKeyService])));
		this.resourceContext = this._register(scopedInstantiationService.createInstance(ResourceContextKey));
		this.editorPinnedContext = ActiveEditorPinnedContext.bindTo(this.menuContextKeyService);
		this.editorIsFirstContext = ActiveEditorFirstInGroupContext.bindTo(this.menuContextKeyService);
		this.editorIsLastContext = ActiveEditorLastInGroupContext.bindTo(this.menuContextKeyService);
		this.editorStickyContext = ActiveEditorStickyContext.bindTo(this.menuContextKeyService);
		this.editorDirtyContext = ActiveEditorDirtyContext.bindTo(this.menuContextKeyService);
		this.editorCannotCloseContext = ActiveEditorCannotCloseContext.bindTo(this.menuContextKeyService);
		// Studio hides VS Code's tabs; these pills are its tabs, and items like "Close to the Right" ask for tabs.
		EditorTabsVisibleContext.bindTo(this.menuContextKeyService).set(true);
	}

	show(group: IEditorGroup, editor: EditorInput, event: MouseEvent, pill: HTMLElement): void {
		this.resourceContext.set(EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY }));
		this.editorPinnedContext.set(group.isPinned(editor));
		this.editorIsFirstContext.set(group.isFirst(editor));
		this.editorIsLastContext.set(group.isLast(editor));
		this.editorStickyContext.set(group.isSticky(editor));
		this.editorDirtyContext.set(editor.isDirty() && !editor.isSaving());
		this.editorCannotCloseContext.set(editor.hasCapability(EditorInputCapabilities.CannotClose));
		this.contextMenuService.showContextMenu({
			getAnchor: () => new StandardMouseEvent(getWindow(pill), event),
			menuId: MenuId.EditorTitleContext,
			menuActionOptions: { shouldForwardArgs: true, arg: this.resourceContext.get() },
			contextKeyService: this.menuContextKeyService,
			// The editor commands find the file by its index in the group, as for a tab.
			getActionsContext: () => ({ groupId: group.id, editorIndex: group.getIndexOfEditor(editor) }),
			getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id, this.menuContextKeyService),
		});
	}
}
