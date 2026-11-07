/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { RawContextKey } from '../../platform/contextkey/common/contextkey.js';

export const STUDIO_LAYOUT_STYLE_SETTING = 'workbench.layoutStyle';

/** Studio or classic, read when the window opens: switching takes a window reload. */
export function isStudioLayoutStyle(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<string>(STUDIO_LAYOUT_STYLE_SETTING) !== 'classic';
}

export const StudioLayoutContext = new RawContextKey<boolean>('studioLayout', false, localize('studioLayout', "Whether the window uses CodeCanvas's Studio layout"));
