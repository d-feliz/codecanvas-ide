/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { CODE_CANVAS_FLOW_EDITOR_ID, CODE_CANVAS_FLOW_INPUT_ID } from '../common/codeCanvas.js';
import type { FlowLayout } from './codeCanvasEngine.js';

/**
 * A Flow view: the functions connected to one function, across the files of a workspace folder. It is
 * temporary until the user changes it; from then on it is saved in `.codecanvas/flows/` (`resource`).
 */
export class CodeCanvasFlowEditorInput extends EditorInput {

	static readonly ID = CODE_CANVAS_FLOW_INPUT_ID;

	constructor(
		readonly folder: URI,
		private layout: FlowLayout,
		private savedResource: URI | undefined,
	) {
		super();
	}

	override get typeId(): string {
		return CodeCanvasFlowEditorInput.ID;
	}

	override get editorId(): string {
		return CODE_CANVAS_FLOW_EDITOR_ID;
	}

	override get resource(): URI | undefined {
		return this.savedResource;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	get isPinnedFlow(): boolean {
		return !!this.savedResource;
	}

	getLayout(): FlowLayout {
		return this.layout;
	}

	/** The flow tab keeps the latest layout here, so reopening the tab shows it as it was left. */
	setLayout(layout: FlowLayout) {
		const nameChanged = layout.name !== this.layout.name;
		this.layout = layout;
		if (nameChanged) {
			this._onDidChangeLabel.fire();
		}
	}

	pin(resource: URI) {
		this.savedResource = resource;
		this._onDidChangeLabel.fire();
	}

	override getName(): string {
		return this.savedResource
			? localize('codeCanvas.flowName', "Flow: {0}", this.layout.name)
			: localize('codeCanvas.temporaryFlowName', "Flow: {0} (temporary)", this.layout.name);
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		if (!(other instanceof CodeCanvasFlowEditorInput)) {
			return false;
		}
		const bothSaved = !!this.savedResource && !!other.savedResource;
		if (bothSaved) {
			return isEqual(this.savedResource, other.savedResource);
		}
		const bothTemporary = !this.savedResource && !other.savedResource;
		const sameStart = other.layout.start.path === this.layout.start.path && other.layout.start.blockId === this.layout.start.blockId;
		return bothTemporary && sameStart && isEqual(this.folder, other.folder);
	}
}
