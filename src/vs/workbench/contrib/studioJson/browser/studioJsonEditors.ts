/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { themeColorFromId } from '../../../../base/common/themables.js';
import { ICodeEditor, isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { studioJsonInvalid } from '../../../browser/studio/studioColors.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { isStudioLayoutStyle } from '../../../common/studio.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { TEXT_FILE_EDITOR_ID } from '../../files/common/files.js';
import { isJsonModel, StudioJsonEditor } from './studioJsonEditor.js';

export const StudioJsonFileActiveContext = new RawContextKey<boolean>('studioJsonFileActive', false, localize('studioJsonFileActive', "Whether the active editor is a JSON file with Studio's JSON view."));

let activeJsonEditor: StudioJsonEditor | undefined;
const activeJsonEditorEmitter = new Emitter<void>();
/** The Structure view follows the JSON view of the active editor. */
export const onDidChangeActiveJsonEditor = activeJsonEditorEmitter.event;
export function getActiveJsonEditor(): StudioJsonEditor | undefined {
	return activeJsonEditor;
}

/** In Studio, the text editor on a JSON file gets the JSON view, and the status bar tells whether the file parses. */
export class StudioJsonEditors extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.studioJsonEditors';

	private readonly watchedEditors = this._register(new DisposableMap<ICodeEditor, DisposableStore>());
	private readonly jsonEditors = new Map<ICodeEditor, StudioJsonEditor>();
	private readonly activeEditorListener = this._register(new MutableDisposable());
	private readonly statusEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly jsonFileActiveContext: IContextKey<boolean>;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.jsonFileActiveContext = StudioJsonFileActiveContext.bindTo(contextKeyService);
		if (isStudioLayoutStyle(configurationService)) {
			this.watchVisibleTextEditors();
			this._register(editorService.onDidVisibleEditorsChange(() => this.watchVisibleTextEditors()));
			this._register(editorService.onDidActiveEditorChange(() => this.followActiveEditor()));
		}
	}

	private watchVisibleTextEditors(): void {
		for (const pane of this.editorService.visibleEditorPanes) {
			const control = pane.getControl();
			const isTextFileEditor = pane.getId() === TEXT_FILE_EDITOR_ID && isCodeEditor(control);
			if (isTextFileEditor && !this.watchedEditors.has(control)) {
				this.watchedEditors.set(control, this.watch(control));
			}
		}
		this.followActiveEditor();
	}

	/** The text editor keeps its widget across files: the JSON view comes and goes with the file's language. */
	private watch(editor: ICodeEditor): DisposableStore {
		const disposables = new DisposableStore();
		const jsonEditor = disposables.add(new MutableDisposable<StudioJsonEditor>());
		const update = () => {
			const model = editor.getModel();
			// The old view goes first: both views put their bars on this editor under the same widget ids.
			jsonEditor.clear();
			jsonEditor.value = isJsonModel(model) ? this.instantiationService.createInstance(StudioJsonEditor, editor, model) : undefined;
			if (jsonEditor.value) {
				this.jsonEditors.set(editor, jsonEditor.value);
			} else {
				this.jsonEditors.delete(editor);
			}
			this.followActiveEditor();
		};
		update();
		disposables.add(editor.onDidChangeModel(update));
		disposables.add(editor.onDidChangeModelLanguage(update));
		disposables.add(editor.onDidDispose(() => this.watchedEditors.deleteAndDispose(editor)));
		disposables.add({ dispose: () => this.jsonEditors.delete(editor) });
		return disposables;
	}

	private followActiveEditor(): void {
		const activeControl = this.editorService.activeTextEditorControl;
		const jsonEditor = isCodeEditor(activeControl) ? this.jsonEditors.get(activeControl) : undefined;
		this.jsonFileActiveContext.set(!!jsonEditor);
		if (jsonEditor === activeJsonEditor) {
			return;
		}
		activeJsonEditor = jsonEditor;
		this.activeEditorListener.value = jsonEditor?.onDidChange(() => this.renderStatus());
		this.renderStatus();
		activeJsonEditorEmitter.fire();
	}

	private renderStatus(): void {
		const document = activeJsonEditor?.getDocument();
		if (!document) {
			this.statusEntry.clear();
			return;
		}
		const text = document.isValid
			? localize('studioJson.valid', "Valid JSON · {0} values · {1} levels", document.valueCount, document.levels)
			: localize('studioJson.invalid', "Invalid JSON · line {0}", document.firstErrorLine ?? 1);
		const entry = {
			name: localize('studioJson.status', "JSON"),
			text,
			ariaLabel: text,
			color: document.isValid ? undefined : themeColorFromId(studioJsonInvalid),
		};
		if (this.statusEntry.value) {
			this.statusEntry.value.update(entry);
		} else {
			this.statusEntry.value = this.statusbarService.addEntry(entry, 'studio.json.status', StatusbarAlignment.LEFT, 10);
		}
	}
}
