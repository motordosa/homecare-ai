import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { PATIENT_SCREENS, PATIENT_INPUT_SCREENS } from '../public/patient-screens.js';

const html = readFileSync(new URL('../public/patient.html', import.meta.url), 'utf8');
const specification = readFileSync(new URL('../docs/SCREEN_SPEC.md', import.meta.url), 'utf8');
const viewIds = [...html.matchAll(/id="view-([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(viewIds, Object.keys(PATIENT_SCREENS), 'HTML views must match the screen registry in order');
const nav = html.match(/<nav class="bottom-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
assert.ok(nav, 'patient navigation exists');
assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(match => match[1]), viewIds, 'bottom navigation has the same ordered screens');
for (const [name, screen] of Object.entries(PATIENT_SCREENS)) {
  assert.ok(specification.includes(`| ${screen.id} /`), `${screen.id} must have a detailed page specification`);
  assert.equal(screen.closeTarget, name === 'home' ? null : 'home');
  assert.equal(screen.nav, name);
}
for (const screen of Object.values(PATIENT_INPUT_SCREENS)) {
  assert.ok(html.includes(`id="${screen.dialog}"`));
  assert.ok(specification.includes(`| ${screen.id} /`));
  assert.equal(screen.closeTarget, 'opener');
}
assert.deepEqual([...html.matchAll(/<dialog id="([^"]+)"/g)].map(match => match[1]).sort(),
  [...new Set(Object.values(PATIENT_INPUT_SCREENS).map(screen => screen.dialog))].sort(), 'new input dialogs require registry entries and page specifications');
const header = html.match(/<header class="patient-header">([\s\S]*?)<\/header>/)?.[1];
assert.ok(header?.includes('id="patient-view-close"'));
assert.ok(!header.includes('/clinician'), 'patient header must not switch roles');
const guide = html.slice(html.indexOf('<section id="view-guide"'), html.indexOf('</section>', html.indexOf('<section id="view-guide"')));
assert.ok(guide.includes('id="guide-clinician-link"'));
assert.equal((html.match(/href="\/clinician/g) ?? []).length, 1, 'role switching belongs only in the guide');
assert.ok(html.includes('src="/patient.js" type="module"'));

const clinicianIds = { overview: 'C-OVERVIEW', patients: 'C-PATIENTS', medications: 'C-MED', records: 'C-RECORDS', notices: 'C-NOTICES', messages: 'C-MESSAGES', settings: 'C-SETTINGS' };
const clinicianSource = readFileSync(new URL('../public/clinician.js', import.meta.url), 'utf8');
let clinicianTitles;
function visit(node) {
  if (Array.isArray(node)) { node.forEach(visit); return; }
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id?.name === 'viewTitles') clinicianTitles = node.init;
  Object.values(node).forEach(visit);
}
visit(parse(clinicianSource, { ecmaVersion: 'latest', sourceType: 'module' }));
assert.equal(clinicianTitles?.type, 'ObjectExpression');
assert.deepEqual(clinicianTitles.properties.map(property => property.key.name ?? property.key.value).sort(), Object.keys(clinicianIds).sort(), 'new clinician pages also require page specifications');
for (const id of Object.values(clinicianIds)) assert.ok(specification.includes(`| ${id} /`), `${id} needs a detailed page specification`);
console.log(`Screen contract matches ${viewIds.length} patient pages, ${Object.keys(PATIENT_INPUT_SCREENS).length} input variants and ${Object.keys(clinicianIds).length} clinician pages.`);
