/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/studioChrome.css';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { getStudioChromeSlots } from '../../../browser/studio/studioShell.js';
import { isStudioLayoutStyle, StudioLayoutContext } from '../../../common/studio.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import './studioGoToAnything.js';
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
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		if (!isStudioLayoutStyle(configurationService)) {
			return;
		}
		StudioLayoutContext.bindTo(contextKeyService).set(true);
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

// As in a browser, ⌘[ and ⌘] go back and forward like the top bar's arrows, also in code editors
// (where they would outdent and indent lines; Shift+Tab and Tab still do).
KeybindingsRegistry.registerKeybindingRule({ id: 'workbench.action.navigateBack', primary: KeyMod.CtrlCmd | KeyCode.BracketLeft, when: StudioLayoutContext, weight: KeybindingWeight.WorkbenchContrib });
KeybindingsRegistry.registerKeybindingRule({ id: 'workbench.action.navigateForward', primary: KeyMod.CtrlCmd | KeyCode.BracketRight, when: StudioLayoutContext, weight: KeybindingWeight.WorkbenchContrib });
