import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../src/lab');
const parse = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics;

test('reserved principal parameter reproduces the generation failure', () => {
  assert.ok(parse('fixture.ts', 'interface Service { rekey_principal(old: Principal, new: Principal, dry_run: boolean): Promise<bigint> }').length > 0);
  assert.equal(parse('fixture.ts', 'interface Service { rekey_principal(old: Principal, new_principal: Principal, dry_run: boolean): Promise<bigint> }').length, 0);
});

for (const directory of ['bindings', 'generated-contracts']) {
  test(`${directory} contains only syntactically valid TypeScript contracts`, () => {
    const base = path.join(root, directory);
    const files = fs.readdirSync(base, { recursive: true }).filter(file => file.endsWith('.ts'));
    assert.ok(files.length > 0);
    const errors = files.flatMap(file => parse(file, fs.readFileSync(path.join(base, file), 'utf8')).map(diagnostic => `${directory}/${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`));
    assert.deepEqual(errors, []);
  });
}