/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { create } from './codeCanvasProjectWorker.js';
import { bootstrapWebWorker } from '../../../../base/common/worker/webWorkerBootstrap.js';

bootstrapWebWorker(create);
