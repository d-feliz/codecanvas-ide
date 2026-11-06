/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const CODE_CANVAS_EDITOR_ID = 'workbench.editor.codeCanvas';

/** Setting: TypeScript files open as a canvas (the text editor is one click away), or as text. */
export const CODE_CANVAS_DEFAULT_SETTING = 'codeCanvas.openTypeScriptFilesAsCanvas';

/** The canvas shows the changes since the file's last commit. */
export const CODE_CANVAS_SHOWS_CHANGES = new RawContextKey<boolean>('codeCanvasShowsChanges', false);
export const CODE_CANVAS_INPUT_ID = 'workbench.input.codeCanvas';

/** Files the canvas can show: TypeScript, as the engine parses it. */
export const CODE_CANVAS_FILE_PATTERN = '**/*.{ts,tsx,mts,cts}';
export const CODE_CANVAS_FILE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/** Per-repo folder with block positions, meant to be committed: `.codecanvas/<path>.json`. */
export const CODE_CANVAS_LAYOUT_FOLDER = '.codecanvas';
