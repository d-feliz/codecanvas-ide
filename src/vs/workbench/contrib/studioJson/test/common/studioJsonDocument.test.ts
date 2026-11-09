/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { dottedPath, StudioJsonDocument } from '../../common/studioJsonDocument.js';

const APP_JSON = [
	'{',                                  // 1
	'  "expo": {',                        // 2
	'    "name": "Vooks",',               // 3
	'    "splash": {',                    // 4
	'      "backgroundColor": "#FFFFFF"', // 5
	'    },',                             // 6
	'    "plugins": ["expo-av", 2],',     // 7
	'    "updates": { "enabled": true },', // 8
	'    "projectId": null',              // 9
	'  }',                                // 10
	'}',                                  // 11
].join('\n');

function parse(text: string, allowComments = false): StudioJsonDocument {
	const lineStarts = [0];
	for (let offset = 0; offset < text.length; offset++) {
		if (text[offset] === '\n') {
			lineStarts.push(offset + 1);
		}
	}
	const lineAt = (offset: number) => lineStarts.filter(start => start <= offset).length;
	return new StudioJsonDocument(text, allowComments, lineAt);
}

suite('StudioJsonDocument', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('counts the plain values and the levels', () => {
		const document = parse(APP_JSON);
		assert.strictEqual(document.isValid, true);
		assert.strictEqual(document.valueCount, 6);
		assert.strictEqual(document.levels, 3);
	});

	test('finds the value on a line, with its path and type', () => {
		const document = parse(APP_JSON);
		const name = document.valueStartingOnLine(3)!;
		assert.deepStrictEqual([name.path, name.type], [['expo', 'name'], 'string']);
		const splash = document.valueStartingOnLine(4)!;
		assert.deepStrictEqual([splash.type, splash.startLine, splash.endLine], ['object', 4, 6]);
		assert.strictEqual(document.valueStartingOnLine(8)!.type, 'boolean');
		assert.strictEqual(document.valueStartingOnLine(9)!.type, 'null');
	});

	test('a closing brace line belongs to the object it closes', () => {
		const document = parse(APP_JSON);
		assert.strictEqual(document.valueStartingOnLine(6), undefined);
		assert.deepStrictEqual(document.containerAroundLine(6)!.path, ['expo', 'splash']);
	});

	test('array items are keyed by index and shown as [i] in the dotted path', () => {
		const document = parse(APP_JSON);
		const secondPlugin = document.valueAtPath(['expo', 'plugins', 1])!;
		assert.strictEqual(secondPlugin.type, 'number');
		assert.strictEqual(dottedPath(secondPlugin.path), 'expo.plugins[1]');
		assert.strictEqual(dottedPath(['expo', 'android', 'versionCode']), 'expo.android.versionCode');
	});

	test('previews plain values as text and cuts long ones', () => {
		const document = parse(APP_JSON);
		assert.strictEqual(document.preview(document.valueAtPath(['expo', 'name'])!, 40), '"Vooks"');
		assert.strictEqual(document.preview(document.valueAtPath(['expo', 'name'])!, 4), '"Vo…');
		assert.strictEqual(document.preview(document.valueAtPath(['expo'])!, 40), '{ 5 }');
	});

	test('finds the object a fold on its opening line folds', () => {
		const document = parse(APP_JSON);
		assert.deepStrictEqual(document.containerOpeningOnLine(4)!.path, ['expo', 'splash']);
	});

	test('the filter keeps matches and the keys that lead to them bright', () => {
		const document = parse(APP_JSON);
		const result = document.filter('FFFFFF');
		assert.deepStrictEqual([...result.brightLines].sort((a, b) => a - b), [1, 2, 4, 5]);
		assert.strictEqual(result.matchedRanges.length, 1);
		const keyResult = document.filter('PLUG');
		assert.ok(keyResult.brightLines.has(7));
	});

	test('reports the line of the first error', () => {
		const document = parse('{\n  "a": 1,\n  "b" 2\n}');
		assert.strictEqual(document.isValid, false);
		assert.strictEqual(document.firstErrorLine, 3);
	});

	test('comments and trailing commas are errors in JSON, fine in JSON with comments', () => {
		const text = '{\n  // the name\n  "a": 1,\n}';
		assert.strictEqual(parse(text).isValid, false);
		assert.strictEqual(parse(text, true).isValid, true);
	});
});
