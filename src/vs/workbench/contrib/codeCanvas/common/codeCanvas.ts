/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const CODE_CANVAS_EDITOR_ID = 'workbench.editor.codeCanvas';

/** Setting: TypeScript and JavaScript files open as a canvas (the text editor is one click away), or as text. */
export const CODE_CANVAS_DEFAULT_SETTING = 'codeCanvas.openFilesAsCanvas';
/** The setting's name before JavaScript files could be canvases too. */
export const CODE_CANVAS_DEFAULT_SETTING_BEFORE_JAVASCRIPT = 'codeCanvas.openTypeScriptFilesAsCanvas';

/** The canvas shows the changes since the file's last commit. */
export const CODE_CANVAS_SHOWS_CHANGES = new RawContextKey<boolean>('codeCanvasShowsChanges', false);
export const CODE_CANVAS_INPUT_ID = 'workbench.input.codeCanvas';

/** Files the canvas can show: TypeScript and JavaScript, as the engine parses them. */
export const CODE_CANVAS_FILE_PATTERN = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
export const CODE_CANVAS_FILE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Per-repo folder with block positions, meant to be committed: `.codecanvas/<path>.json`. */
export const CODE_CANVAS_LAYOUT_FOLDER = '.codecanvas';
