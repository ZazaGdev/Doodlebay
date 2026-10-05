// Writes THIRD_PARTY_LICENSES.txt: the licence of every package bundled into the app (React,
// Excalidraw and everything they pull in) and of the fonts that ship with it. Run with
// `npm run licenses`; `npm run dist` runs it too. Electron adds Chromium's own notices.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const seen = new Map();

function resolve(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const p = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(p)) return p;
    if (path.dirname(dir) === dir) return null;
  }
}

function walk(name, from) {
  const pj = resolve(name, from);
  if (!pj) return;
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  const dir = path.dirname(pj);
  let license = pkg.license || (pkg.licenses || []).map(l => l.type || l).join(' OR ') || 'see licence text';
  if (typeof license === 'object') license = license.type;
  const texts = fs.readdirSync(dir).filter(f => /^(licen[cs]e|copying|notice)/i.test(f)).map(f => fs.readFileSync(path.join(dir, f), 'utf8').trim());
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  seen.set(key, { license, texts, repo });
  for (const d of Object.keys(pkg.dependencies || {})) walk(d, dir);
  for (const d of Object.keys(pkg.peerDependencies || {})) if (resolve(d, dir)) walk(d, dir);
}

for (const n of ['react', 'react-dom', '@excalidraw/excalidraw']) walk(n, root);

const FONTS = [
  ['Excalifont, Virgil', 'SIL Open Font License 1.1', 'https://github.com/excalidraw/excalidraw'],
  ['Nunito', 'SIL Open Font License 1.1', 'https://github.com/googlefonts/nunito'],
  ['Lilita One', 'SIL Open Font License 1.1', 'https://fonts.google.com/specimen/Lilita+One'],
  ['Cascadia Code', 'SIL Open Font License 1.1', 'https://github.com/microsoft/cascadia-code'],
  ['Liberation Sans', 'SIL Open Font License 1.1', 'https://github.com/liberationfonts/liberation-fonts'],
  ['Assistant', 'SIL Open Font License 1.1', 'https://github.com/hafontia-zz/Assistant'],
  ['Xiaolai', 'SIL Open Font License 1.1', 'https://github.com/lxgw/kose-font'],
  ['Comic Shanns', 'MIT', 'https://github.com/shannpersand/comic-shanns'],
];

const rule = '='.repeat(78);
const out = [
  'Third-party software in ExcaliDesk',
  '',
  'ExcaliDesk bundles the packages and fonts below. Each is used under the licence shown.',
  'Electron and Chromium notices ship separately in the app folder (LICENSES.chromium.html).',
  '',
];
for (const [key, { license, texts, repo }] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  out.push(rule, `${key}  (${license})`, ...(repo ? [repo] : []), '');
  out.push(texts.length ? texts.join('\n\n') : `Licensed under ${license}.`, '');
}
out.push(rule, 'FONTS', '');
for (const [name, license, src] of FONTS) out.push(`${name}: ${license}, copyright its authors, ${src}`);
out.push('', 'The SIL Open Font License 1.1 applies to every font above except Comic Shanns:', '');
out.push(fs.readFileSync(path.join(__dirname, 'OFL.txt'), 'utf8').trim(), '');
out.push('Comic Shanns is under the MIT License; its licence text is embedded in the font file.', '');

fs.writeFileSync(path.join(root, 'THIRD_PARTY_LICENSES.txt'), out.join('\n'));
console.log(`THIRD_PARTY_LICENSES.txt: ${seen.size} packages, ${FONTS.length} fonts`);
