/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { CODE_CANVAS_FLOWS_FOLDER } from '../common/codeCanvas.js';
import type { FlowLayout } from './codeCanvasEngine.js';

/** A flow saved in a workspace folder's `.codecanvas/flows/`. */
export interface SavedFlow {
	resource: URI;
	folder: URI;
	layout: FlowLayout;
}

export function flowsFolder(folder: URI): URI {
	return joinPath(folder, CODE_CANVAS_FLOWS_FOLDER);
}

/** `.codecanvas/flows/place.json` for a flow named "place": the name, made safe as a file name. */
export function flowResource(folder: URI, name: string): URI {
	const fileName = name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'flow';
	return joinPath(flowsFolder(folder), `${fileName}.json`);
}

/** A free file name for a new flow: "place", then "place-2"… */
export async function freeFlowResource(fileService: IFileService, folder: URI, name: string): Promise<URI> {
	for (let attempt = 1; ; attempt++) {
		const resource = flowResource(folder, attempt === 1 ? name : `${name}-${attempt}`);
		if (!await fileService.exists(resource)) {
			return resource;
		}
	}
}

export async function readFlow(fileService: IFileService, resource: URI): Promise<FlowLayout | undefined> {
	try {
		return JSON.parse((await fileService.readFile(resource)).value.toString()) as FlowLayout;
	} catch {
		return undefined;
	}
}

export async function writeFlow(fileService: IFileService, resource: URI, layout: FlowLayout): Promise<void> {
	await fileService.writeFile(resource, VSBuffer.fromString(JSON.stringify(layout, null, 2) + '\n'));
}

/** Every saved flow of every workspace folder, by name. */
export async function listSavedFlows(fileService: IFileService, workspaceContextService: IWorkspaceContextService): Promise<SavedFlow[]> {
	const flows: SavedFlow[] = [];
	for (const { uri: folder } of workspaceContextService.getWorkspace().folders) {
		const folderFlows = await fileService.resolve(flowsFolder(folder)).catch(() => undefined);
		for (const child of folderFlows?.children ?? []) {
			const isFlowFile = !child.isDirectory && child.name.endsWith('.json');
			const layout = isFlowFile ? await readFlow(fileService, child.resource) : undefined;
			if (layout) {
				flows.push({ resource: child.resource, folder, layout });
			}
		}
	}
	return flows.sort((a, b) => a.layout.name.localeCompare(b.layout.name));
}
