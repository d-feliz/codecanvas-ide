/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { extname } from '../../../../base/common/resources.js';
import { ICodeEditor, isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { isStudioLayoutStyle } from '../../../common/studio.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { TEXT_FILE_EDITOR_ID } from '../../files/common/files.js';
import { CODE_CANVAS_FILE_EXTENSIONS } from '../common/codeCanvas.js';
import { BlockLaneStyle, CodeCanvasBlockLane } from './codeCanvasBlockLane.js';

/** Below this width the chips show only their glyph, so the code keeps its room. */
const NARROWEST_EDITOR_WITH_LABELS = 640;

/** In Studio, the text editor on a TypeScript or JavaScript file (the Code view) gets the block lane. */
export class CodeCanvasCodeViewLanes extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.codeCanvasCodeViewLanes';

	private readonly watchedEditors = this._register(new DisposableMap<ICodeEditor, DisposableStore>());

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();
		if (isStudioLayoutStyle(configurationService)) {
			this.watchVisibleTextEditors();
			this._register(editorService.onDidVisibleEditorsChange(() => this.watchVisibleTextEditors()));
		}
	}

	private watchVisibleTextEditors() {
		for (const pane of this.editorService.visibleEditorPanes) {
			const control = pane.getControl();
			const isTextFileEditor = pane.getId() === TEXT_FILE_EDITOR_ID && isCodeEditor(control);
			if (isTextFileEditor && !this.watchedEditors.has(control)) {
				this.watchedEditors.set(control, this.watch(control));
			}
		}
	}

	/** The text editor keeps its widget across files: the lane comes and goes with the file's language. */
	private watch(editor: ICodeEditor): DisposableStore {
		const disposables = new DisposableStore();
		let lane: CodeCanvasBlockLane | undefined;
		const laneStyle = (): BlockLaneStyle => editor.getLayoutInfo().width >= NARROWEST_EDITOR_WITH_LABELS ? 'labels' : 'glyphs';
		const updateLane = () => {
			const resource = editor.getModel()?.uri;
			const isCanvasFile = !!resource && CODE_CANVAS_FILE_EXTENSIONS.includes(extname(resource).toLowerCase());
			if (isCanvasFile) {
				lane ??= new CodeCanvasBlockLane(editor, laneStyle());
			} else {
				lane?.dispose();
				lane = undefined;
			}
		};
		updateLane();
		disposables.add(editor.onDidChangeModel(updateLane));
		disposables.add(editor.onDidLayoutChange(() => lane?.setStyle(laneStyle())));
		disposables.add(editor.onDidDispose(() => this.watchedEditors.deleteAndDispose(editor)));
		disposables.add({ dispose: () => lane?.dispose() });
		return disposables;
	}
}
