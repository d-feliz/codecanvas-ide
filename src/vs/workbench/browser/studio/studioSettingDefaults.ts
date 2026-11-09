/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../platform/registry/common/platform.js';

/**
 * Studio's own widgets stand in for the activity bar and the editor tabs: the view icons go on top
 * of the left panel, and the open files are in the top bar (so the editor needs no breadcrumbs bar either). These are defaults, so a user's own
 * settings still win.
 */
export function registerStudioSettingDefaults(): void {
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
		overrides: {
			'workbench.activityBar.location': 'top',
			'workbench.editor.showTabs': 'none',
			'breadcrumbs.enabled': false,
			// JSON's own colour provider only knows colours its schema marks; the default one finds every "#RRGGBB".
			// Bracket colours would hide the JSON view's punctuation colour.
			'[json]': { 'editor.defaultColorDecorators': 'always', 'editor.bracketPairColorization.enabled': false },
			'[jsonc]': { 'editor.defaultColorDecorators': 'always', 'editor.bracketPairColorization.enabled': false },
		},
	}]);
}
