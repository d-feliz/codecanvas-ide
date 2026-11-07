/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/studioChrome.css';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { getStudioChromeSlots, STUDIO_LAYOUT_STYLE_SETTING } from '../../../browser/studio/studioShell.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { StudioLeftPanelFooter, StudioSignedInAccount } from './studioAccount.js';
import { StudioAssistantHeader } from './studioAssistantHeader.js';
import { StudioTopBar } from './studioTopBar.js';

/** Fills the Studio shell's top bar and left panel footer; does nothing in the classic layout. */
class StudioChromeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.studioChrome';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		if (configurationService.getValue<string>(STUDIO_LAYOUT_STYLE_SETTING) !== 'studio') {
			return;
		}
		// This phase can come before the workbench builds its layout, and with it the shell's slots.
		if (!this.fillSlots()) {
			const firstLayoutListener = this._register(this.layoutService.onDidLayoutMainContainer(() => {
				if (this.fillSlots()) {
					firstLayoutListener.dispose();
				}
			}));
		}
	}

	private fillSlots(): boolean {
		const slots = getStudioChromeSlots(this.layoutService.mainContainer);
		if (!slots) {
			return false;
		}
		const signedInAccount = this._register(this.instantiationService.createInstance(StudioSignedInAccount));
		this._register(this.instantiationService.createInstance(StudioTopBar, slots.topBar, signedInAccount));
		this._register(this.instantiationService.createInstance(StudioLeftPanelFooter, slots.leftPanelFooter, signedInAccount));
		this._register(this.instantiationService.createInstance(StudioAssistantHeader));
		return true;
	}
}

registerWorkbenchContribution2(StudioChromeContribution.ID, StudioChromeContribution, WorkbenchPhase.BlockRestore);
