/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { IResourceEditorInput } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { GroupIdentifier, IRevertOptions, ISaveOptions, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { AbstractResourceEditorInput } from '../../../common/editor/resourceEditorInput.js';
import { ICustomEditorLabelService } from '../../../services/editor/common/customEditorLabelService.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { CODE_CANVAS_EDITOR_ID, CODE_CANVAS_INPUT_ID } from '../common/codeCanvas.js';

/**
 * A TypeScript file shown as a canvas. The canvas edits the same text document as the text
 * editor, so unsaved changes, saving and undo are shared with it.
 */
export class CodeCanvasEditorInput extends AbstractResourceEditorInput {

	static readonly ID = CODE_CANVAS_INPUT_ID;

	constructor(
		resource: URI,
		@ITextFileService private readonly textFileService: ITextFileService,
		@ILabelService labelService: ILabelService,
		@IFileService fileService: IFileService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@ICustomEditorLabelService customEditorLabelService: ICustomEditorLabelService,
	) {
		super(resource, undefined, labelService, fileService, filesConfigurationService, textResourceConfigurationService, customEditorLabelService);
		this._register(this.textFileService.files.onDidChangeDirty(model => {
			if (isEqual(model.resource, this.resource)) {
				this._onDidChangeDirty.fire();
			}
		}));
	}

	override get typeId(): string {
		return CodeCanvasEditorInput.ID;
	}

	override get editorId(): string {
		return CODE_CANVAS_EDITOR_ID;
	}

	override isDirty(): boolean {
		return this.textFileService.isDirty(this.resource);
	}

	override async save(group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | IUntypedEditorInput | undefined> {
		const saved = await this.textFileService.save(this.resource, options);
		return saved ? this : undefined;
	}

	override async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		await this.textFileService.revert(this.resource, options);
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(otherInput)) {
			return true;
		}
		return otherInput instanceof CodeCanvasEditorInput && isEqual(this.resource, otherInput.resource);
	}

	override toUntyped(): IResourceEditorInput {
		return { resource: this.resource, options: { override: this.editorId } };
	}
}
