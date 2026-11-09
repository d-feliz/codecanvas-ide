/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { registerColor } from '../../../platform/theme/common/colorUtils.js';
import { STUDIO_DARK, STUDIO_JSON_DARK, STUDIO_JSON_LIGHT, STUDIO_KINDS_DARK, STUDIO_KINDS_LIGHT, STUDIO_LIGHT, StudioJsonColors, StudioKindColors, StudioPalette, withAlpha } from './studioTokens.js';

const tokenColor = (token: keyof StudioPalette) => ({ dark: STUDIO_DARK[token], light: STUDIO_LIGHT[token], hcDark: STUDIO_DARK[token], hcLight: STUDIO_LIGHT[token] });
const jsonColor = (token: keyof StudioJsonColors) => ({ dark: STUDIO_JSON_DARK[token], light: STUDIO_JSON_LIGHT[token], hcDark: STUDIO_JSON_DARK[token], hcLight: STUDIO_JSON_LIGHT[token] });
const jsonColorWithAlpha = (token: keyof StudioJsonColors, alpha: number) => ({ dark: withAlpha(STUDIO_JSON_DARK[token], alpha), light: withAlpha(STUDIO_JSON_LIGHT[token], alpha), hcDark: withAlpha(STUDIO_JSON_DARK[token], alpha), hcLight: withAlpha(STUDIO_JSON_LIGHT[token], alpha) });
const kindColor = (kind: keyof StudioKindColors) => ({ dark: STUDIO_KINDS_DARK[kind], light: STUDIO_KINDS_LIGHT[kind], hcDark: STUDIO_KINDS_DARK[kind], hcLight: STUDIO_KINDS_LIGHT[kind] });

export const studioCanvas = registerColor('studio.canvas', tokenColor('canvas'), localize('studio.canvas', "The canvas behind Studio's floating surfaces."));
export const studioDot = registerColor('studio.dot', tokenColor('dot'), localize('studio.dot', "The dot grid of the canvas."));
export const studioPanel = registerColor('studio.panel', tokenColor('panel'), localize('studio.panel', "Background of Studio's floating panels."));
export const studioSurface = registerColor('studio.surface', tokenColor('surface'), localize('studio.surface', "Background of Studio's bars, pills and menus."));
export const studioSurface2 = registerColor('studio.surface2', tokenColor('surface2'), localize('studio.surface2', "Background of cards inside Studio's panels."));
export const studioInput = registerColor('studio.input', tokenColor('input'), localize('studio.input', "Background of Studio's text inputs."));
export const studioRaised = registerColor('studio.raised', tokenColor('raised'), localize('studio.raised', "Background of the active item of a Studio bar."));
export const studioBorder = registerColor('studio.border', tokenColor('border'), localize('studio.border', "Border of Studio's surfaces."));
export const studioDivider = registerColor('studio.divider', tokenColor('divider'), localize('studio.divider', "Lines that divide sections of a Studio panel."));
export const studioNodeBackground = registerColor('studio.nodeBackground', tokenColor('nodeBackground'), localize('studio.nodeBackground', "Background of a block on the canvas."));
export const studioNodeBorder = registerColor('studio.nodeBorder', tokenColor('nodeBorder'), localize('studio.nodeBorder', "Border of a block on the canvas."));
export const studioNodeHeadBorder = registerColor('studio.nodeHeadBorder', tokenColor('nodeHeadBorder'), localize('studio.nodeHeadBorder', "Line under the header of a block on the canvas."));
export const studioText = registerColor('studio.text', tokenColor('text'), localize('studio.text', "Text in Studio."));
export const studioStrong = registerColor('studio.strong', tokenColor('strong'), localize('studio.strong', "Text that stands out in Studio, such as names."));
export const studioMuted = registerColor('studio.muted', tokenColor('muted'), localize('studio.muted', "Secondary text in Studio."));
export const studioFaint = registerColor('studio.faint', tokenColor('faint'), localize('studio.faint', "Hints and labels in Studio."));
export const studioFaintest = registerColor('studio.faintest', tokenColor('faintest'), localize('studio.faintest', "The faintest text in Studio, such as carets."));
export const studioCodeText = registerColor('studio.codeText', tokenColor('codeText'), localize('studio.codeText', "Code on the canvas."));
export const studioAccent = registerColor('studio.accent', tokenColor('accent'), localize('studio.accent', "Studio's accent color: primary buttons and the selection ring."));
export const studioInk = registerColor('studio.ink', tokenColor('ink'), localize('studio.ink', "The accent where it is text or a thin line."));
export const studioOnAccent = registerColor('studio.onAccent', tokenColor('onAccent'), localize('studio.onAccent', "Text on the accent color."));
export const studioActiveRow = registerColor('studio.activeRow', tokenColor('activeRow'), localize('studio.activeRow', "Background of the active file in Studio's lists."));
export const studioSelectedLines = registerColor('studio.selectedLines', tokenColor('selectedLines'), localize('studio.selectedLines', "Background of the selected block's lines in the Code view."));
export const studioFileTs = registerColor('studio.fileTs', tokenColor('fileTs'), localize('studio.fileTs', "Dot and label of TypeScript files."));
export const studioFileJs = registerColor('studio.fileJs', tokenColor('fileJs'), localize('studio.fileJs', "Dot and label of JavaScript files."));
export const studioScrim = registerColor('studio.scrim', tokenColor('scrim'), localize('studio.scrim', "Shade behind Studio's command palette."));

export const studioKindImport = registerColor('studio.kindImport', kindColor('import'), localize('studio.kindImport', "Color of import blocks on the canvas."));
export const studioKindVariable = registerColor('studio.kindVariable', kindColor('variable'), localize('studio.kindVariable', "Color of variable blocks on the canvas."));
export const studioKindFunction = registerColor('studio.kindFunction', kindColor('function'), localize('studio.kindFunction', "Color of function blocks on the canvas."));
export const studioKindClass = registerColor('studio.kindClass', kindColor('class'), localize('studio.kindClass', "Color of class blocks on the canvas."));
export const studioKindType = registerColor('studio.kindType', kindColor('type'), localize('studio.kindType', "Color of type blocks on the canvas."));
export const studioKindComponent = registerColor('studio.kindComponent', kindColor('component'), localize('studio.kindComponent', "Color of component blocks on the canvas."));
export const studioKindState = registerColor('studio.kindState', kindColor('state'), localize('studio.kindState', "Color of state blocks on the canvas."));
export const studioKindNamespace = registerColor('studio.kindNamespace', kindColor('namespace'), localize('studio.kindNamespace', "Color of namespace blocks on the canvas."));
export const studioKindStatement = registerColor('studio.kindStatement', kindColor('statement'), localize('studio.kindStatement', "Color of statement blocks on the canvas."));

/** The type chip of the JSON path bar: the type's colour on that colour at 16%. */
const JSON_TYPE_CHIP_ALPHA = 0.16;
export const studioJsonString = registerColor('studioJson.string', jsonColor('string'), localize('studioJson.string', "Strings in the JSON view."));
export const studioJsonNumber = registerColor('studioJson.number', jsonColor('number'), localize('studioJson.number', "Numbers in the JSON view."));
export const studioJsonBoolean = registerColor('studioJson.boolean', jsonColor('boolean'), localize('studioJson.boolean', "true and false in the JSON view."));
export const studioJsonNull = registerColor('studioJson.null', jsonColor('null'), localize('studioJson.null', "null in the JSON view."));
export const studioJsonPunctuation = registerColor('studioJson.punctuation', jsonColor('punctuation'), localize('studioJson.punctuation', "Braces, commas and colons in the JSON view, and the `…` of a folded object or array."));
export const studioJsonContainer = registerColor('studioJson.container', jsonColor('container'), localize('studioJson.container', "Objects and arrays in the JSON view's path bar."));
export const studioJsonStringChip = registerColor('studioJson.stringChip', jsonColorWithAlpha('string', JSON_TYPE_CHIP_ALPHA), localize('studioJson.stringChip', "Background of the string type chip in the JSON path bar."));
export const studioJsonNumberChip = registerColor('studioJson.numberChip', jsonColorWithAlpha('number', JSON_TYPE_CHIP_ALPHA), localize('studioJson.numberChip', "Background of the number type chip in the JSON path bar."));
export const studioJsonBooleanChip = registerColor('studioJson.booleanChip', jsonColorWithAlpha('boolean', JSON_TYPE_CHIP_ALPHA), localize('studioJson.booleanChip', "Background of the boolean type chip in the JSON path bar."));
export const studioJsonNullChip = registerColor('studioJson.nullChip', jsonColorWithAlpha('null', JSON_TYPE_CHIP_ALPHA), localize('studioJson.nullChip', "Background of the null type chip in the JSON path bar."));
export const studioJsonContainerChip = registerColor('studioJson.containerChip', jsonColorWithAlpha('container', JSON_TYPE_CHIP_ALPHA), localize('studioJson.containerChip', "Background of the object and array type chip in the JSON path bar."));
export const studioJsonColorSwatchBorder = registerColor('studioJson.colorSwatchBorder', jsonColor('colorSwatchBorder'), localize('studioJson.colorSwatchBorder', "Border of the colour swatch next to a colour value in the JSON view."));
export const studioJsonFoldChipBackground = registerColor('studioJson.foldChipBackground', jsonColor('foldChipBackground'), localize('studioJson.foldChipBackground', "Background of the key count after a folded object or array."));
export const studioJsonFoldChipText = registerColor('studioJson.foldChipText', jsonColor('foldChipText'), localize('studioJson.foldChipText', "Text of the key count after a folded object or array."));
export const studioJsonSelectedLine = registerColor('studioJson.selectedLine', jsonColor('selectedLine'), localize('studioJson.selectedLine', "Background of the line under the cursor in the JSON view."));
export const studioJsonSelectedContainerLines = registerColor('studioJson.selectedContainerLines', jsonColor('selectedContainerLines'), localize('studioJson.selectedContainerLines', "Background of the lines of the selected object or array."));
export const studioJsonSelectedLineNumber = registerColor('studioJson.selectedLineNumber', jsonColor('selectedLineNumber'), localize('studioJson.selectedLineNumber', "Line number of the line under the cursor in the JSON view."));
export const studioJsonTypeHint = registerColor('studioJson.typeHint', jsonColor('typeHint'), localize('studioJson.typeHint', "The type shown at the end of the line under the cursor."));
export const studioJsonCrumb = registerColor('studioJson.crumb', jsonColor('crumb'), localize('studioJson.crumb', "Keys of the JSON path bar."));
export const studioJsonCurrentCrumb = registerColor('studioJson.currentCrumb', jsonColor('currentCrumb'), localize('studioJson.currentCrumb', "The current key of the JSON path bar."));
export const studioJsonCrumbSeparator = registerColor('studioJson.crumbSeparator', jsonColor('crumbSeparator'), localize('studioJson.crumbSeparator', "Separators of the JSON path bar."));
export const studioJsonInvalid = registerColor('studioJson.invalid', jsonColor('invalid'), localize('studioJson.invalid', "The status bar item of a JSON file that does not parse."));
