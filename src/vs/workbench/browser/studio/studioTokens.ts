/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Studio's design tokens, from the "Tokens & components" board of the Studio design. The registered
// `studio.*` colors (studioColors.ts) and the two Studio themes (made by
// build/codecanvas/make-studio-themes.ts) both read them, so they are kept here only.

export interface StudioPalette {
	/** The canvas behind everything, and its dot grid. */
	canvas: string;
	dot: string;
	/** Floating panels (left panel, assistant, code panel, drawer). */
	panel: string;
	/** Bars, pills, menus, the palette. */
	surface: string;
	surface2: string;
	input: string;
	/** The active item of a bar or a segmented control. */
	raised: string;
	border: string;
	divider: string;
	nodeBackground: string;
	nodeBorder: string;
	nodeHeadBorder: string;
	text: string;
	strong: string;
	muted: string;
	faint: string;
	faintest: string;
	codeText: string;
	accent: string;
	/** The accent where it is text or a thin line; darker than the accent in the light theme. */
	ink: string;
	onAccent: string;
	/** The active file in a list, and the rows of the selected block in the Code view. */
	activeRow: string;
	selectedLines: string;
	fileTs: string;
	fileJs: string;
	scrim: string;
	error: string;
	warning: string;
	info: string;
	success: string;
	syntaxKeyword: string;
	syntaxString: string;
	syntaxType: string;
	syntaxComment: string;
	syntaxConstant: string;
	syntaxFunction: string;
}

/** Block kinds of the canvas ("Node color options", option 6): blocks are tinted with these, see the engine's styles. */
export interface StudioKindColors {
	import: string;
	variable: string;
	function: string;
	class: string;
	type: string;
	component: string;
	state: string;
	namespace: string;
	statement: string;
}

export const STUDIO_DARK: StudioPalette = {
	canvas: '#0C0D0F',
	dot: '#25272C',
	panel: '#141518',
	surface: '#16171A',
	surface2: '#1C1D21',
	input: '#111214',
	raised: '#2A2C31',
	border: '#26282D',
	divider: '#222428',
	nodeBackground: '#16171A',
	nodeBorder: '#2B2D33',
	nodeHeadBorder: '#24262B',
	text: '#E6E7EA',
	strong: '#F2F2F3',
	muted: '#A9ADB6',
	faint: '#8B8F98',
	faintest: '#6E727B',
	codeText: '#C9CCD2',
	accent: '#E8C27A',
	ink: '#E8C27A',
	onAccent: '#1A1408',
	activeRow: '#E8C27A1F',
	selectedLines: '#E8C27A14',
	fileTs: '#7FB0F0',
	fileJs: '#E8D27A',
	scrim: '#0506088C',
	error: '#F2877D',
	warning: '#E3A85C',
	info: '#7FB0F0',
	success: '#9BE3B0',
	syntaxKeyword: '#C3A6F0',
	syntaxString: '#9FD3EC',
	syntaxType: '#B8C4FF',
	syntaxComment: '#7D828C',
	syntaxConstant: '#7CC4E8',
	syntaxFunction: '#F2F2F3',
};

export const STUDIO_LIGHT: StudioPalette = {
	canvas: '#F3F3F1',
	dot: '#D4D4CF',
	panel: '#FFFFFF',
	surface: '#FFFFFF',
	surface2: '#F5F5F3',
	input: '#F7F7F5',
	raised: '#ECECE8',
	border: '#E1E1DC',
	divider: '#ECECE8',
	nodeBackground: '#FFFFFF',
	nodeBorder: '#DADAD4',
	nodeHeadBorder: '#EDEDE9',
	text: '#1F2023',
	strong: '#0F1012',
	muted: '#4A4D55',
	faint: '#5F626A',
	faintest: '#8A8D94',
	codeText: '#2E3036',
	accent: '#E8C27A',
	ink: '#8A5D0E',
	onAccent: '#1A1408',
	activeRow: '#E8C27A47',
	selectedLines: '#E8C27A33',
	fileTs: '#2F64B8',
	fileJs: '#8A6A00',
	scrim: '#1E1E1940',
	error: '#B4362B',
	warning: '#9A5B00',
	info: '#2F64B8',
	success: '#2F7A4A',
	syntaxKeyword: '#7A3FC0',
	syntaxString: '#1D6A92',
	syntaxType: '#3B4FB0',
	syntaxComment: '#6F737B',
	syntaxConstant: '#1D6A92',
	syntaxFunction: '#0F1012',
};

export const STUDIO_KINDS_DARK: StudioKindColors = {
	import: '#9AA0AA',
	variable: '#5DB8E8',
	function: '#A98BF0',
	class: '#5CC98A',
	type: '#E8B04A',
	component: '#F08CC4',
	state: '#C5DC5A',
	namespace: '#86E3D6',
	statement: '#C9CDD4',
};

export const STUDIO_KINDS_LIGHT: StudioKindColors = {
	import: '#5F646D',
	variable: '#1F6E9A',
	function: '#6B48C8',
	class: '#1E7F4C',
	type: '#9A6406',
	component: '#B0306F',
	state: '#5E7410',
	namespace: '#0B6F64',
	statement: '#3F434A',
};

/** The JSON view: the colour of each kind of value (also the JSON syntax colours of the Studio themes), and the marks around the text. */
export interface StudioJsonColors {
	string: string;
	number: string;
	boolean: string;
	null: string;
	key: string;
	punctuation: string;
	/** Objects and arrays in the path bar's type chip. */
	container: string;
	indentGuide: string;
	colorSwatchBorder: string;
	foldChipBackground: string;
	foldChipText: string;
	/** The line under the cursor, and the lines of the object or array it opens. */
	selectedLine: string;
	selectedContainerLines: string;
	selectedLineNumber: string;
	typeHint: string;
	crumb: string;
	currentCrumb: string;
	crumbSeparator: string;
	invalid: string;
}

/** `#RRGGBB` with an alpha from 0 to 1 → `#RRGGBBAA`. */
export function withAlpha(color: string, alpha: number): string {
	return color.slice(0, 7) + Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
}

export const STUDIO_JSON_DARK: StudioJsonColors = {
	string: '#9FD3EC',
	number: '#E8B04A',
	boolean: '#A98BF0',
	null: '#A9ADB6',
	key: '#C9CCD2',
	punctuation: '#6E727B',
	container: '#C9CCD2',
	indentGuide: '#24262B',
	colorSwatchBorder: '#3A3D44',
	foldChipBackground: '#1C1D21',
	foldChipText: '#8B8F98',
	selectedLine: withAlpha('#FFFFFF', 0.07),
	selectedContainerLines: withAlpha('#FFFFFF', 0.025),
	selectedLineNumber: '#F2F2F3',
	typeHint: '#8B8F98',
	crumb: '#8B8F98',
	currentCrumb: '#F2F2F3',
	crumbSeparator: '#6E727B',
	invalid: '#F2836B',
};

export const STUDIO_JSON_LIGHT: StudioJsonColors = {
	string: '#1D6A92',
	number: '#9A6406',
	boolean: '#6B48C8',
	null: '#5F626A',
	key: '#2E3036',
	punctuation: '#8A8D94',
	container: '#2E3036',
	indentGuide: '#E2E2DF',
	colorSwatchBorder: '#DADAD4',
	foldChipBackground: '#E9E9E6',
	foldChipText: '#5F626A',
	selectedLine: withAlpha('#000000', 0.06),
	selectedContainerLines: withAlpha('#000000', 0.025),
	selectedLineNumber: '#121316',
	typeHint: '#5F626A',
	crumb: '#5F626A',
	currentCrumb: '#0F1012',
	crumbSeparator: '#8A8D94',
	invalid: '#B4362B',
};
