import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';

const directory = await mkdtemp(path.join(tmpdir(), 'tripboogie-overview-'));
test.after(() => rm(directory, {recursive: true, force: true}));
await writeFile(path.join(directory, 'package.json'), '{"type":"commonjs"}');
for (const name of ['planning', 'memo', 'booking-display', 'calendar', 'itinerary-overview', 'overview-image']) {
  const source = await readFile(new URL(`./${name}.ts`, import.meta.url), 'utf8');
  await writeFile(path.join(directory, `${name}.js`), ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText);
}
await mkdir(path.join(directory, 'data'));
await copyFile(new URL('./data/airport-labels.json', import.meta.url), path.join(directory, 'data/airport-labels.json'));
const require = createRequire(path.join(directory, 'package.json'));
const overview = require('./itinerary-overview.js');
const image = require('./overview-image.js');
const record = (id, kind, data) => ({id, kind, data, version: 1});
const date = '2026-11-26';
const flight = record('flight', 'booking', {type: 'flight', startTime: '18:20', endTime: '19:05', departure: 'AKL', arrival: 'ROT'});
const departure = record('dep', 'plan', {date, position: 2, time: '18:15', title: '出発', bookingId: 'flight', bookingEvent: 'departure'});
const arrival = record('arr', 'plan', {date, position: 3, time: '19:05', title: '到着', bookingId: 'flight', bookingEvent: 'arrival'});
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('import, free edits and removal leave every source record and booking unchanged', () => {
  const workspace = freeze({records: [flight, departure, arrival, record('lunch', 'plan', {date, position: 1, title: '점심', time: ''})]});
  const before = JSON.stringify(workspace);
  const candidates = overview.overviewCandidates(workspace, date);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].text, '점심');
  const imported = overview.importOverview(overview.emptyOverview(), candidates, 'replace', ' · ');
  const edited = overview.writeOverviewDay(imported, date, '자유 입력 → 쇼핑\n저녁');
  assert.equal(imported.days[date].text.includes('항공'), false);
  assert.match(imported.days[date].text, /18:15.*→.*19:05/);
  assert.equal(edited.days[date].text, '자유 입력 → 쇼핑\n저녁');
  assert.notEqual(imported.days[date].sourceIds, edited.days[date].sourceIds);
  assert.equal(overview.writeOverviewDay(edited, date, '').days[date].text, '');
  assert.equal(JSON.stringify(workspace), before);
});

test('adjacent same-booking flight events merge using itinerary clocks, never booking fallback', () => {
  const candidates = overview.overviewCandidates({records: [flight, arrival, departure]}, date);
  assert.deepEqual(candidates[0].sourceIds, ['dep', 'arr']);
  assert.match(candidates[0].text, /18:15/);
  assert.doesNotMatch(candidates[0].text, /18:20/);
  const untimed = overview.overviewCandidates({records: [flight, {...departure, data: {...departure.data, time: ''}}, arrival]}, date);
  assert.doesNotMatch(untimed[0].text, /18:20|18:15/);
  assert.doesNotMatch(overview.overviewCandidates({records: [flight, departure, arrival]}, date, false)[0].text, /\d{2}:\d{2}/);
});

test('cross-day flights and customized flight titles preserve their date and wording', () => {
  const nextDay = {...arrival, data: {...arrival.data, date: '2026-11-27'}};
  const workspace = {records: [flight, departure, nextDay]};
  assert.match(overview.overviewCandidates(workspace, date)[0].text, /출발$/);
  assert.match(overview.overviewCandidates(workspace, '2026-11-27')[0].text, /도착$/);
  const custom = {...departure, data: {...departure.data, title: '공항에서 만나기', bookingOverrides: ['title']}};
  const items = overview.overviewCandidates({records: [flight, custom, arrival]}, date);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, '18:15 공항에서 만나기');
  const legacy = {...departure, data: {...departure.data, title: '이전 버전의 사용자 제목', bookingManaged: false}};
  assert.equal(overview.overviewCandidates({records: [flight, legacy, arrival]}, date)[0].text, '18:15 이전 버전의 사용자 제목');
});

test('hotel stays, memos and unknown times remain available without invented transport or time', () => {
  const records = [record('hotel', 'booking', {type: 'hotel'}), record('stay', 'plan', {date, position: 1, bookingId: 'hotel', title: '로토루아 숙소'}), record('memo', 'plan', {date, position: 2, entryType: 'memo', title: '후보', note: '후보\n비 오면 박물관'})];
  const items = overview.overviewCandidates({records}, date);
  assert.equal(items[0].hotel, true);
  const result = overview.importOverview(overview.emptyOverview(), items, 'replace', ' · ');
  assert.equal(result.days[date].text, '후보\n비 오면 박물관\n숙소: 로토루아 숙소');
  assert.doesNotMatch(result.days[date].text, /00:00|도보/);
});

test('append preserves handwritten text, replacement affects only selected days, imports are atomic', () => {
  const draft = freeze({schema: 1, days: {[date]: {text: '직접 적은 메모', sourceIds: []}, '2026-11-27': {text: '다음날 일정', sourceIds: []}}});
  const candidate = {id: 'one', date, text: '쇼핑', sourceIds: ['one'], hotel: false};
  assert.equal(overview.importOverview(draft, [candidate], 'append', '\n').days[date].text, '직접 적은 메모\n쇼핑');
  const replaced = overview.importOverview(draft, [candidate], 'replace', '\n');
  assert.equal(replaced.days[date].text, '쇼핑');
  assert.equal(replaced.days['2026-11-27'].text, '다음날 일정');
  assert.throws(() => overview.importOverview(draft, [candidate, {...candidate, id: 'huge', date: '2026-11-27', text: '가'.repeat(10001)}], 'append', '\n'), /너무 길어요/);
  assert.equal(draft.days[date].text, '직접 적은 메모');
});

test('draft persistence round-trips, accounts/trips are isolated and invalid stored shapes fail closed', () => {
  const draft = overview.writeOverviewDay(overview.emptyOverview(), date, '한글 → 일정\n두 번째 줄');
  assert.deepEqual(overview.parseOverview(JSON.stringify(draft)), draft);
  assert.deepEqual(overview.parseOverview(null), overview.emptyOverview());
  assert.notEqual(overview.overviewStorageKey('alice', 'trip'), overview.overviewStorageKey('bob', 'trip'));
  assert.notEqual(overview.overviewStorageKey('alice:trip', 'one'), overview.overviewStorageKey('alice', 'trip:one'));
  for (const input of ['broken', '{"schema":2,"days":{}}', '{"schema":1,"days":[]}', '{"schema":1,"days":{"2026-11-26":{"text":42,"sourceIds":[]}}}']) assert.throws(() => overview.parseOverview(input));
});

test('every activity occupies its own line, including activities without a scheduled time', () => {
  const workspace = {records: [record('tour', 'plan', {date, position: 1, time: '08:30', title: '캐노피 투어', duration: 180}), record('luge', 'plan', {date, position: 2, time: '12:00', title: '루지'}), record('lunch', 'plan', {date, position: 3, title: '점심 + 정비'}), record('spring', 'plan', {date, position: 4, time: '15:30', title: '블루스프링', duration: 45})]};
  const candidates = overview.overviewCandidates(workspace, date);
  assert.equal(overview.importOverview(overview.emptyOverview(), candidates, 'replace').days[date].text, '08:30 캐노피 투어 (3시간)\n12:00 루지\n점심 + 정비\n15:30 블루스프링 (45분)');
  const noClocks = overview.overviewCandidates(workspace, date, false);
  assert.equal(overview.importOverview(overview.emptyOverview(), noClocks, 'replace').days[date].text, '캐노피 투어 (3시간)\n루지\n점심 + 정비\n블루스프링 (45분)');
});

test('durations display stored hours and minutes without inventing zero or missing durations', () => {
  assert.equal(overview.overviewDuration(105), ' (1시간 45분)');
  assert.equal(overview.overviewDuration(60), ' (1시간)');
  assert.equal(overview.overviewDuration(30), ' (30분)');
  for (const duration of [undefined, null, 0, -5, NaN, Infinity, '60']) assert.equal(overview.overviewDuration(duration), '');
});

test('long export days continue on multiple pages with every line preserved, including empty days', () => {
  const text = Array.from({length: 180}, (_, i) => `${i + 1}번째 일정`).join('\n');
  const pages = image.paginateOverview([{date, text}, {date: '2026-11-27', text: ''}], value => value.length * 10);
  assert.ok(pages.length > 1);
  assert.equal(pages.every(page => page.length > 0), true);
  assert.equal(pages.flat().filter(segment => segment.date === date).flatMap(segment => segment.lines).join('\n'), text);
  assert.equal(pages[1][0].continued, true);
  assert.deepEqual(pages.at(-1).at(-1), {date: '2026-11-27', lines: [''], continued: false});
  assert.deepEqual(image.wrapOverviewText('서울 → 😀\n\n다음 날', value => Array.from(value).length, 100), ['서울 → 😀', '', '다음 날']);
});


test('bulk overview import matches individual dates, including empty and duplicate dates, without mutating records', () => {
  const nextDate = '2026-11-27';
  const workspace = freeze({records: [flight, arrival, departure, record('memo', 'plan', {date: nextDate, entryType: 'memo', note: '자유시간'}), record('place', 'place', {name: '장소'})]});
  const before = JSON.stringify(workspace), dates = [date, nextDate, '2026-11-28', date];
  for (const times of [true, false]) {
    const bulk = overview.overviewCandidatesByDate(workspace, dates, times);
    for (const day of dates) assert.deepEqual(bulk.get(day), overview.overviewCandidates(workspace, day, times));
    assert.deepEqual(bulk.get('2026-11-28'), []);
  }
  assert.equal(JSON.stringify(workspace), before);
});

test('canvas memory is released when PNG encoding fails', async () => {
  const canvas = {width: 0, height: 0};
  const context = new Proxy({measureText: value => ({width: value.length * 10})}, {get: (target, key) => key in target ? target[key] : () => {}});
  canvas.getContext = () => context;
  canvas.toBlob = callback => callback(null);
  const previous = globalThis.document;
  globalThis.document = {fonts: {ready: Promise.resolve()}, createElement: () => canvas};
  try {
    await assert.rejects(image.renderOverviewImages('여행', [{date, text: '일정'}]), /이미지를 만들지 못했어요/);
    assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});
