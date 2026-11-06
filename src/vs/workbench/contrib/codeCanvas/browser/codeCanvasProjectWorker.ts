/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebWorkerServerRequestHandler } from '../../../../base/common/worker/webWorker.js';
import type { ProjectServer } from './codeCanvasEngine.js';
import { Engine, loadEngine } from './codeCanvasEngine.js';

/**
 * Runs the canvas engine's TypeScript work (usage links between blocks, renames) off the window's
 * thread. The window keeps an engine `RemoteProject`, which only parses files into blocks.
 */
export class CodeCanvasProjectWorker implements IWebWorkerServerRequestHandler {
	_requestHandlerBrand: void = undefined;

	private serverLoading: Promise<{ engine: Engine; server: ProjectServer }> | undefined;

	async $call(method: string, args: unknown[]): Promise<unknown> {
		this.serverLoading ??= loadEngine().then(engine => ({ engine, server: new engine.ProjectServer() }));
		const { engine, server } = await this.serverLoading;
		return engine.callProjectServer(server, method, args);
	}
}

export function create(): CodeCanvasProjectWorker {
	return new CodeCanvasProjectWorker();
}
