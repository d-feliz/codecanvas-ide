/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/studioFonts.css';
import './studioColors.js';
import { localize } from '../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { workbenchConfigurationNodeBase } from '../../common/configuration.js';
import { STUDIO_LAYOUT_STYLE_SETTING } from './studioShell.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[STUDIO_LAYOUT_STYLE_SETTING]: {
			type: 'string',
			enum: ['studio', 'classic'],
			enumDescriptions: [
				localize('workbench.layoutStyle.studio', "Floating panels over the canvas, CodeCanvas's own layout."),
				localize('workbench.layoutStyle.classic', "VS Code's layout, with the panels side by side."),
			],
			default: 'classic',
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: localize('workbench.layoutStyle', "The layout of the window. Takes effect after the window is reloaded."),
		},
	},
});
