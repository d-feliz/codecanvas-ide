/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, ScanCode } from '../../../../base/common/keyCodes.js';
import { Chord, Keybinding, KeyCodeChord, ScanCodeChord } from '../../../../base/common/keybindings.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { IKeybindingItem } from '../../../../platform/keybinding/common/keybindingsRegistry.js';

/**
 * In Studio, ⌘K opens Go to anything, so VS Code's default ⌘K chords start with ⌘' instead
 * (⌘K ⌘S becomes ⌘' ⌘S; Ctrl instead of ⌘ off macOS). ⌘' is free in VS Code; ⌘; is not (Testing).
 */
export function moveCommandKChordsToQuote(items: IKeybindingItem[]): IKeybindingItem[] {
	return items.map(item => {
		const keybinding = item.keybinding;
		if (!keybinding || keybinding.chords.length < 2 || !isCommandK(keybinding.chords[0])) {
			return item;
		}
		const [commandK, ...rest] = keybinding.chords;
		const commandQuote = new KeyCodeChord(commandK.ctrlKey, false, false, commandK.metaKey, KeyCode.Quote);
		return { ...item, keybinding: new Keybinding([commandQuote, ...rest]) };
	});
}

function isCommandK(chord: Chord): boolean {
	const isKeyK = chord instanceof KeyCodeChord ? chord.keyCode === KeyCode.KeyK : chord instanceof ScanCodeChord && chord.scanCode === ScanCode.KeyK;
	const onlyCommand = isMacintosh ? chord.metaKey && !chord.ctrlKey : chord.ctrlKey && !chord.metaKey;
	return isKeyK && onlyCommand && !chord.shiftKey && !chord.altKey;
}
