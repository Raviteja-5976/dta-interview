/**
 * Copies Monaco's prebuilt AMD bundle into public/monaco/vs.
 *
 * @monaco-editor/react loads Monaco from jsDelivr by default. That is a third
 * party in the critical path of a paid, timed interview: if the CDN is slow or
 * blocked by a corporate network, the candidate stares at a spinner while their
 * coding round runs. Serving it from our own origin removes that.
 *
 * The AMD build is used rather than bundling monaco-editor's ESM sources,
 * because the AMD loader spawns and wires Monaco's web workers itself. Bundling
 * the ESM build means hand-configuring MonacoEnvironment.getWorker with
 * bundler-specific worker URLs, which is a different fight on Turbopack than on
 * webpack, and one worth not having.
 *
 * Runs from `prebuild` and `predev`. public/monaco is gitignored — it is build
 * output, regenerated from node_modules on every install.
 */

import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'monaco-editor');
const source = join(pkgDir, 'min', 'vs');
const target = join(root, 'public', 'monaco', 'vs');
const component = join(root, 'components', 'app', 'MonacoEditor.tsx');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(source))) {
  // Not fatal. The editor falls back to the CDN, which still works — it is only
  // the resilience that is lost, and failing the build over it helps nobody.
  console.warn('[monaco] monaco-editor not installed; skipping copy');
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true });

/*
 * MonacoEditor.tsx pins a version in its CDN fallback URL. If that drifts from
 * the installed package, the fallback quietly serves a different Monaco than
 * the one this app was built against — and only on the day the local copy is
 * missing, which is the worst day to discover it.
 */
const { version } = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
const src = await readFile(component, 'utf8');
const pinned = src.match(/monaco-editor@([\d.]+)\/min\/vs/)?.[1];

if (pinned && pinned !== version) {
  console.warn(
    `[monaco] CDN fallback in MonacoEditor.tsx pins ${pinned} but ${version} is installed. Update it.`,
  );
}

console.log(`[monaco] copied min/vs → public/monaco/vs (${version})`);
