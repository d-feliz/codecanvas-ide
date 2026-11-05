/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as CodeCanvasEngine from '@codecanvas/engine/dist/codecanvas-engine.js';
import { importAMDNodeModule } from '../../../../amdX.js';
import { FileAccess, nodeModulesPath } from '../../../../base/common/network.js';
import { IFileService } from '../../../../platform/files/common/files.js';

export type Engine = typeof CodeCanvasEngine;
export type { CodeCanvas, FileLayout, FileModel, OtherFileChange, Project } from '@codecanvas/engine/dist/codecanvas-engine.js';

let engineLoading: Promise<Engine> | undefined;

/** The canvas engine (github.com/d-feliz/codecanvas) bundles the TypeScript compiler: load it only when a canvas opens. */
export function loadEngine(): Promise<Engine> {
	engineLoading ??= importAMDNodeModule<Engine>('@codecanvas/engine', 'dist/codecanvas-engine.js');
	return engineLoading;
}

let libFilesLoading: Promise<Record<string, string>> | undefined;

/** TypeScript's standard library, shipped with the engine. `Project` needs it to report type errors. */
export function loadLibFiles(fileService: IFileService): Promise<Record<string, string>> {
	libFilesLoading ??= (async () => {
		const libFolder = FileAccess.asFileUri(`${nodeModulesPath}/@codecanvas/engine/dist/lib`);
		const index = JSON.parse((await fileService.readFile(libFolder.with({ path: `${libFolder.path}/files.json` }))).value.toString()) as { files: string[] };
		const libFiles: Record<string, string> = {};
		await Promise.all(index.files.map(async name => {
			libFiles[name] = (await fileService.readFile(libFolder.with({ path: `${libFolder.path}/${name}` }))).value.toString();
		}));
		return libFiles;
	})();
	return libFilesLoading;
}
