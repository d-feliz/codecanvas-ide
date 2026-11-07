/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SimpleAccountActivityActionViewItem, SimpleGlobalActivityActionViewItem } from '../../../browser/parts/globalCompositeBar.js';
import { ACCOUNTS_ACTIVITY_TILE_ACTION, GLOBAL_ACTIVITY_TITLE_ACTION } from '../../../browser/parts/titlebar/titlebarActions.js';
import { ACCOUNTS_ACTIVITY_ID, GLOBAL_ACTIVITY_ID } from '../../../common/activity.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';

/** The name of the first signed-in account, kept up to date. */
export class StudioSignedInAccount extends Disposable {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;
	private _accountName: string | undefined;
	get accountName(): string | undefined { return this._accountName; }

	constructor(@IAuthenticationService private readonly authenticationService: IAuthenticationService) {
		super();
		this.update();
		this._register(this.authenticationService.onDidChangeSessions(() => this.update()));
		this._register(this.authenticationService.onDidRegisterAuthenticationProvider(() => this.update()));
	}

	private async update(): Promise<void> {
		let accountName: string | undefined;
		for (const providerId of this.authenticationService.getProviderIds()) {
			const sessions = await this.authenticationService.getSessions(providerId).catch(() => []);
			accountName ??= sessions[0]?.account.label;
		}
		if (accountName !== this._accountName) {
			this._accountName = accountName;
			this._onDidChange.fire();
		}
	}
}

/** VS Code's own Accounts and Manage menus, as the given activity ids, in an action bar. */
export function createActivityActionBar(container: HTMLElement, activityIds: readonly string[], hoverPosition: HoverPosition, instantiationService: IInstantiationService): ActionBar {
	const actionBar = new ActionBar(container, {
		actionViewItemProvider: (action, options) => {
			if (action.id === ACCOUNTS_ACTIVITY_ID) {
				return instantiationService.createInstance(SimpleAccountActivityActionViewItem, { position: () => hoverPosition }, options);
			}
			if (action.id === GLOBAL_ACTIVITY_ID) {
				return instantiationService.createInstance(SimpleGlobalActivityActionViewItem, { position: () => hoverPosition }, options);
			}
			return undefined;
		},
	});
	const activityActions = [ACCOUNTS_ACTIVITY_TILE_ACTION, GLOBAL_ACTIVITY_TITLE_ACTION].filter(action => activityIds.includes(action.id));
	actionBar.push(activityActions, { icon: true, label: false });
	return actionBar;
}

/** The left panel's footer: the signed-in account and the Manage (gear) menu. */
export class StudioLeftPanelFooter extends Disposable {

	constructor(
		container: HTMLElement,
		signedInAccount: StudioSignedInAccount,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		const footer = append(container, $('.studio-left-panel-footer-content'));
		const account = append(footer, $('.studio-footer-account'));
		this._register(createActivityActionBar(append(account, $('.studio-footer-account-menu')), [ACCOUNTS_ACTIVITY_ID], HoverPosition.ABOVE, instantiationService));
		const accountName = append(account, $('span.studio-footer-account-name'));
		this._register(createActivityActionBar(append(footer, $('.studio-footer-manage')), [GLOBAL_ACTIVITY_ID], HoverPosition.ABOVE, instantiationService));

		const renderAccountName = () => accountName.textContent = signedInAccount.accountName ?? localize('studio.notSignedIn', "Not signed in");
		renderAccountName();
		this._register(signedInAccount.onDidChange(renderAccountName));
	}
}
