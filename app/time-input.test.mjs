import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('./time-input.ts', import.meta.url), 'utf8');
const {normalizeTimeInput} = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}}).outputText).toString('base64'));

test('keyboard entry accepts 24-hour clocks, compact digits and full-width pasted text', () => {
  for (const [input, expected] of [['9:30', '09:30'], ['0930', '09:30'], ['930', '09:30'], ['9', '09:00'], ['09', '09:00'], ['9:3', '09:03'], ['0', '00:00'], ['0000', '00:00'], ['23:59', '23:59'], ['2359', '23:59'], [' ０９：３０ ', '09:30']]) {
    assert.equal(normalizeTimeInput(input), expected, input);
  }
});
test('invalid times stay invalid rather than silently changing the schedule', () => {
  for (const input of ['', ' ', '24:00', '2400', '2360', '9:60', '-1:30', '12:345', '12345', '9:', ':30', '9.5', '9pm', '12:30:00']) {
    assert.equal(normalizeTimeInput(input), null, input);
  }
});
