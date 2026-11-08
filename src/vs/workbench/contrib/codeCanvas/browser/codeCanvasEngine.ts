/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as CodeCanvasEngine from '@codecanvas-ide/engine/dist/codecanvas-engine.js';
import { importAMDNodeModule } from '../../../../amdX.js';

export type Engine = typeof CodeCanvasEngine;
export type { BlockLines, CodeCanvas, ConfigFile, EditorHandle, EditorOptions, FileLayout, FileModel, HostDiagnostic, OtherFileChange, ProjectServer, RemoteProject, Workspace } from '@codecanvas-ide/engine/dist/codecanvas-engine.js';

let engineLoading: Promise<Engine> | undefined;

/** The canvas engine (github.com/d-feliz/codecanvas) bundles the TypeScript compiler: load it only when a canvas opens. */
export function loadEngine(): Promise<Engine> {
	engineLoading ??= importAMDNodeModule<Engine>('@codecanvas-ide/engine', 'dist/codecanvas-engine.js');
	return engineLoading;
}
