/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/studioJson.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { localize } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Extensions as ViewExtensions, IViewsRegistry } from '../../../common/views.js';
import { VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { StudioJsonEditors, StudioJsonFileActiveContext } from './studioJsonEditors.js';
import { STUDIO_JSON_STRUCTURE_VIEW_ID, STUDIO_JSON_STRUCTURE_VIEW_TITLE, StudioJsonStructureView } from './studioJsonStructureView.js';

registerWorkbenchContribution2(StudioJsonEditors.ID, StudioJsonEditors, WorkbenchPhase.AfterRestored);

const structureViewIcon = registerIcon('studio-json-structure-view-icon', Codicon.json, localize('studioJsonStructureViewIcon', "View icon of the JSON Structure view."));

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: STUDIO_JSON_STRUCTURE_VIEW_ID,
	name: STUDIO_JSON_STRUCTURE_VIEW_TITLE,
	containerIcon: structureViewIcon,
	ctorDescriptor: new SyncDescriptor(StudioJsonStructureView),
	when: StudioJsonFileActiveContext,
	canToggleVisibility: true,
	canMoveView: true,
	order: 1,
	weight: 30,
}], VIEW_CONTAINER);
