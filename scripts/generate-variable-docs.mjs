import { parse } from 'acorn';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'docs/generated/VARIABLES.md');
const excluded = new Set(['node_modules', '.git', 'data', 'test-results', 'playwright-report', '.gradle', 'build']);
const check = process.argv.includes('--check');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', "'");
const shorten = value => value.replace(/\s+/g, ' ').slice(0, 130);

async function files(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await files(path));
    else if (['.js', '.mjs', '.kt', '.kts', '.java', '.swift'].includes(extname(entry.name))) paths.push(path);
  }
  return paths.sort();
}

function bindings(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern];
  if (pattern.type === 'RestElement') return bindings(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindings(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindings);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(property => bindings(property.type === 'RestElement' ? property.argument : property.value));
  return [];
}

function javascript(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  const rows = [];
  const add = (pattern, kind, scope, expression = '') => {
    for (const binding of bindings(pattern)) rows.push({ line: binding.loc.start.line, column: binding.loc.start.column + 1, name: binding.name, kind, scope, expression: shorten(expression) });
  };
  function visit(node, scope) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) add(declaration.id, node.kind, scope, declaration.init ? source.slice(declaration.init.start, declaration.init.end) : '초기값 없음');
    }
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) add(specifier.local, 'import', scope, node.source.value);
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') if (node.id) add(node.id, 'class', scope);
    if (node.type === 'CatchClause') add(node.param, 'catch', scope);
    let childScope = scope;
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      if (node.id) add(node.id, 'function', scope);
      const name = node.id?.name || `anonymous@${node.loc.start.line}`;
      childScope = `${scope}/${name}`;
      for (const param of node.params) add(param, 'parameter', childScope, source.slice(param.start, param.end));
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end'].includes(key)) continue;
      if (Array.isArray(value)) for (const item of value) visit(item, childScope);
      else if (value && typeof value === 'object') visit(value, childScope);
    }
  }
  visit(ast, 'module');
  return rows.sort((a, b) => a.line - b.line || a.column - b.column || a.name.localeCompare(b.name));
}

function nativeIndex(source) {
  // Supplementary source index, not a native compiler/type analysis. Strings and
  // comments are blanked first to avoid treating prose as code declarations.
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, value => value.replace(/[^\n]/g, ' '));
  const rows = [];
  const seen = new Set();
  const add = (name, kind, offset, expression = '') => {
    const line = code.slice(0, offset).split('\n').length;
    const key = `${line}:${name}:${kind}`;
    if (!seen.has(key)) rows.push({ line, name, kind, scope: 'native source', expression: shorten(expression) });
    seen.add(key);
  };
  for (const match of code.matchAll(/\b(val|let|var)\s+([A-Za-z_][\w]*)/g)) add(match[2], match[1], match.index, source.slice(match.index, source.indexOf('\n', match.index) < 0 ? source.length : source.indexOf('\n', match.index)));
  for (const match of code.matchAll(/\b(?:fun|func|class|struct|enum|protocol|object|interface)\s+([A-Za-z_][\w]*)/g)) add(match[1], 'declaration', match.index);
  for (const match of code.matchAll(/(?:[,(]|\b(?:val|var))\s*([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w.<>,? ]*)/g)) add(match[1], 'typed name / parameter', match.index, match[2]);
  for (const match of code.matchAll(/\b(?:boolean|byte|short|int|long|float|double|char|String|[A-Z][A-Za-z0-9_.]*)(?:<[^;={}\n]+>)?(?:\[\])*\s+([A-Za-z_$][\w$]*)\s*(?=[=;,)\[])/g)) add(match[1], 'native typed declaration / parameter', match.index, match[0]);
  return rows.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
}

const sections = [];
let declarations = 0;
let fileCount = 0;
for (const path of await files(root)) {
  const name = relative(root, path).replaceAll('\\', '/');
  const source = await readFile(path, 'utf8');
  const isNative = ['.kt', '.kts', '.java', '.swift'].includes(extname(path));
  const rows = isNative ? nativeIndex(source) : javascript(source);
  declarations += rows.length;
  fileCount++;
  sections.push(`## ${name}\n\n${isNative ? 'Kotlin/Java/Swift 소스 선언 참고 목록(정규식 인덱스, 컴파일러 검증 아님).\n\n' : ''}| 위치 | 이름 | 종류 | 범위 | 정의/기본값/자료형 참고 |\n|---|---|---|---|---|\n${rows.map(row => `| ${row.line}${row.column ? ':' + row.column : ''} | ${escape(row.name)} | ${escape(row.kind)} | ${escape(row.scope)} | ${escape(row.expression)} |`).join('\n')}\n`);
}
if (!fileCount || !declarations) throw new Error('No source declarations were indexed.');
const document = `# 코드 변수·매개변수 목록\n\n자동 생성 파일. 직접 편집하지 않는다. 생성: \`npm run docs:variables\`, 최신 여부 검사: \`npm run docs:check\`.\n\nJavaScript는 Acorn AST로 import·변수(구조 분해 포함)·함수/매개변수·class·catch를 추출한다. Kotlin/Java/Swift는 선언/타입 이름의 보조 인덱스이며 컴파일러 AST 전수 분석과 다르다. 객체의 데이터 필드/API 단위/상태 의미는 [자료 사전](../DATA_DICTIONARY.md)과 [계약](../CONTRACTS.md)을 함께 읽는다.\n\n소스 ${fileCount}개, 선언/매개변수 ${declarations}개. node_modules·DB·업로드·생성 캡처는 제외한다. 코드에 비밀값을 직접 넣지 않는다.\n\n${sections.join('\n')}`;
if (check) {
  let saved = '';
  try { saved = await readFile(output, 'utf8'); } catch {}
  if (saved !== document) { console.error('Variable documentation is stale. Run npm run docs:variables after updating the planning/contracts.'); process.exitCode = 1; }
  else console.log(`Variable documentation matches ${fileCount} source files / ${declarations} declarations.`);
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, document);
  console.log(`Generated docs/generated/VARIABLES.md: ${fileCount} source files / ${declarations} declarations.`);
}
