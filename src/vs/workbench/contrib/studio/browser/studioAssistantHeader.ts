/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getWindow } from '../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { ChatViewContainerId } from '../../chat/browser/chat.js';

/**
 * The Assistant's header: "Assistant", new chat and close. It lies over VS Code's own header rows of
 * the secondary side bar while the Chat view is open there; any other view keeps VS Code's header.
 */
export class StudioAssistantHeader extends Disposable {

	private readonly header = $('.studio-assistant-header');
	private readonly auxiliaryBarElement: HTMLElement;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IPaneCompositePartService private readonly paneCompositeService: IPaneCompositePartService,
		@ICommandService commandService: ICommandService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();
		this.auxiliaryBarElement = layoutService.getContainer(getWindow(layoutService.mainContainer), Parts.AUXILIARYBAR_PART)!;
		this.auxiliaryBarElement.appendChild(this.header);
		this._register({ dispose: () => this.header.remove() });

		append(this.header, $('span.studio-assistant-title')).textContent = localize('studio.assistant', "Assistant");
		const actions = append(this.header, $('.studio-assistant-actions'));
		this.createButton(actions, '+', localize('studio.newChat', "New Chat"), () => commandService.executeCommand('workbench.action.chat.newChat'));
		this.createButton(actions, '×', localize('studio.closeAssistant', "Close Assistant"), () => commandService.executeCommand('workbench.action.closeAuxiliaryBar'));

		this.render();
		this._register(this.paneCompositeService.onDidPaneCompositeOpen(() => this.render()));
		const resizeObserver = new (getWindow(this.auxiliaryBarElement).ResizeObserver)(() => this.render());
		resizeObserver.observe(this.auxiliaryBarElement);
		this._register({ dispose: () => resizeObserver.disconnect() });
	}

	private createButton(parent: HTMLElement, text: string, label: string, run: () => unknown): void {
		const button = append(parent, $<HTMLButtonElement>('button.studio-assistant-button'));
		button.textContent = text;
		button.setAttribute('aria-label', label);
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, label));
		this._register(addDisposableListener(button, EventType.CLICK, () => run()));
	}

	private render(): void {
		const chatIsOpen = this.paneCompositeService.getActivePaneComposite(ViewContainerLocation.AuxiliaryBar)?.getId() === ChatViewContainerId;
		this.header.style.display = chatIsOpen ? '' : 'none';
		const vsCodeTitle = ([...this.auxiliaryBarElement.children] as HTMLElement[]).find(child => child.classList.contains('title'));
		if (chatIsOpen && vsCodeTitle) {
			this.header.style.height = `${vsCodeTitle.offsetTop + vsCodeTitle.offsetHeight}px`;
		}
	}
}
