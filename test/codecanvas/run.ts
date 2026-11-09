/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Runs the canvas end-to-end check in one go: copies the CodeCanvas sample project (from the CodeCanvas
// repo, checked out next to this one), starts the app on it, runs canvas.e2e.ts, and quits the app.
//   node test/codecanvas/run.ts                 # the development build (scripts/code.sh)
//   node test/codecanvas/run.ts --app <path>    # a packaged app, e.g. ../VSCode-darwin-arm64/CodeCanvas.app
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(import.meta.dirname, '..', '..');
const sampleProject = path.join(repoRoot, '..', 'codecanvas', 'apps', 'playground', 'src', 'sample');
// Short on purpose: macOS limits socket paths (inside --user-data-dir) to 104 characters.
const workFolder = path.join(repoRoot, '.build', 'e2e');
const debugPort = 9333;

const appArgumentIndex = process.argv.indexOf('--app');
const packagedApp = appArgumentIndex > 0 ? path.resolve(process.argv[appArgumentIndex + 1]) : undefined;

/** The sample, plus a path alias from tsconfig.json that the canvas must follow. */
function prepareProject() {
	fs.rmSync(workFolder, { recursive: true, force: true });
	const project = path.join(workFolder, 'sample-project');
	fs.cpSync(sampleProject, project, { recursive: true });
	fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, jsx: 'preserve', paths: { '@shop/*': ['./*'] } } }, null, 2));
	fs.writeFileSync(path.join(project, 'checkout.ts'), [
		`import { applyDiscount } from '@shop/pricing';`,
		`import { formatReceipt } from '@shop/receipts';`,
		``,
		`export function checkoutTotal(amount: number): number {`,
		`  return applyDiscount(amount, null);`,
		`}`,
		``,
		`export function checkoutReceipt(amount: number): string {`,
		`  return formatReceipt(checkoutTotal(amount));`,
		`}`,
		``,
	].join('\n'));
	// A workspace package with its own config and alias, imported by name. Package managers link it into
	// node_modules (VS Code's TypeScript follows that); the canvas finds it from its package.json.
	const receipts = path.join(project, 'packages', 'receipts');
	fs.mkdirSync(path.join(receipts, 'src'), { recursive: true });
	fs.writeFileSync(path.join(receipts, 'package.json'), JSON.stringify({ name: '@shop/receipts', types: './src/index.ts' }, null, 2));
	fs.writeFileSync(path.join(receipts, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, paths: { '@/*': ['./src/*'] } } }, null, 2));
	fs.writeFileSync(path.join(receipts, 'src', 'index.ts'), `export { formatReceipt } from '@/receiptFormat';\n`);
	fs.writeFileSync(path.join(receipts, 'src', 'receiptFormat.ts'), `export function formatReceipt(total: number): string {\n  return 'Total: ' + total.toFixed(2);\n}\n`);
	fs.mkdirSync(path.join(project, 'node_modules', '@shop'), { recursive: true });
	fs.symlinkSync(path.join('..', '..', 'packages', 'receipts'), path.join(project, 'node_modules', '@shop', 'receipts'));
	// An Expo config for the JSON view: nested objects, an array, a colour, a boolean and a null.
	fs.writeFileSync(path.join(project, 'app.json'), [
		`{`,
		`  "expo": {`,
		`    "name": "Vooks",`,
		`    "slug": "vooks-expo",`,
		`    "version": "4.12.0",`,
		`    "splash": {`,
		`      "image": "./assets/splash.png",`,
		`      "backgroundColor": "#1B1B2F"`,
		`    },`,
		`    "android": {`,
		`      "package": "com.example.vooks",`,
		`      "versionCode": 412`,
		`    },`,
		`    "plugins": ["expo-localization", "expo-av"],`,
		`    "updates": { "enabled": true },`,
		`    "extra": { "eas": { "projectId": null } }`,
		`  }`,
		`}`,
		``,
	].join('\n'));
	fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules\n');
	// A git repo with one commit, so "Show Changes" has a committed version to compare with.
	const git = (...gitArgs: string[]) => execFileSync('git', ['-c', 'user.name=CodeCanvas e2e', '-c', 'user.email=e2e@codecanvas.invalid', ...gitArgs], { cwd: project, stdio: 'ignore' });
	const discounts = path.join(project, 'discounts.ts');
	const writeDiscounts = (rate: string, extra = '') => fs.writeFileSync(discounts, `export function seasonalDiscount(amount: number): number {\n  return amount * ${rate};\n}\n${extra}`);
	writeDiscounts('0.95');
	git('init', '-q');
	git('add', '-A');
	git('commit', '-q', '-m', 'Sample project');
	// A merge that leaves conflict markers in discounts.ts.
	git('checkout', '-q', '-b', 'sale');
	writeDiscounts('0.8', `\nexport function flashSale(amount: number): number {\n  return amount / 2;\n}\n`);
	git('commit', '-q', '-am', 'Bigger discounts');
	git('checkout', '-q', '-');
	writeDiscounts('0.9');
	git('commit', '-q', '-am', 'Smaller discount');
	try {
		git('merge', 'sale');
	} catch {
		// Expected: the merge stops with a conflict.
	}
	const userSettings = path.join(workFolder, 'user', 'User');
	fs.mkdirSync(userSettings, { recursive: true });
	// The canvas checks use editor tabs, so they run in the classic layout; studio.e2e.ts switches to Studio.
	fs.writeFileSync(path.join(userSettings, 'settings.json'), JSON.stringify({ 'git.openRepositoryInParentFolders': 'never', 'workbench.layoutStyle': 'classic' }));
	fs.mkdirSync(path.join(workFolder, 'screenshots'));
	return project;
}

function startApp(project: string): ChildProcess {
	const appArgs = [
		'--user-data-dir', path.join(workFolder, 'user'),
		'--extensions-dir', path.join(workFolder, 'ext'),
		`--remote-debugging-port=${debugPort}`, '--skip-welcome', '--disable-workspace-trust', project,
	];
	const executable = packagedApp
		? path.join(packagedApp, 'Contents', 'MacOS', path.basename(packagedApp, '.app'))
		: path.join(repoRoot, 'scripts', 'code.sh');
	// Its own process group, so a stuck app can be stopped with all of Electron's helper processes.
	return spawn(executable, appArgs, { cwd: repoRoot, detached: true, stdio: ['ignore', fs.openSync(path.join(workFolder, 'app.log'), 'w'), 'pipe'] });
}

/** Ask the app to quit like a user would; stop it and its helpers only if it doesn't within 20 seconds. */
async function quitApp(app: ChildProcess) {
	if (app.exitCode !== null) {
		return;
	}
	const exited = new Promise(resolve => app.once('exit', () => resolve(true)));
	process.kill(app.pid!, 'SIGTERM');
	const quitInTime = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(false), 20000))]);
	if (!quitInTime) {
		try {
			process.kill(-app.pid!, 'SIGKILL');
		} catch {
			// Already gone.
		}
	}
}

async function waitForWindow() {
	for (let attempt = 0; attempt < 90; attempt++) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
			if (targets.some(target => target.url.includes('workbench'))) {
				return;
			}
		} catch {
			// Not listening yet.
		}
		await new Promise(resolve => setTimeout(resolve, 1000));
	}
	throw new Error('CodeCanvas did not open a window within 90 seconds');
}

(async () => {
	const project = prepareProject();
	const app = startApp(project);
	let exitCode = 1;
	try {
		await waitForWindow();
		// Let the extension host and TypeScript start before the checks.
		await new Promise(resolve => setTimeout(resolve, 4000));
		const runCheck = (script: string, args: string[]) => new Promise<number>(resolve => spawn(process.execPath, [path.join(import.meta.dirname, script), path.join(workFolder, 'screenshots'), ...args], { cwd: repoRoot, stdio: 'inherit' }).on('exit', code => resolve(code ?? 1)));
		const canvasExitCode = await runCheck('canvas.e2e.ts', [project]);
		const studioExitCode = await runCheck('studio.e2e.ts', [path.join(workFolder, 'user', 'User', 'settings.json')]);
		exitCode = canvasExitCode || studioExitCode;
	} catch (error) {
		console.error(error.message);
	} finally {
		await quitApp(app);
	}
	console.log(exitCode === 0 ? 'canvas e2e: passed' : `canvas e2e: failed (screenshots and app.log in ${workFolder})`);
	process.exit(exitCode);
})();
