import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
const directory=await mkdtemp(path.join(tmpdir(),'tripboogie-navigation-'));
test.after(()=>rm(directory,{recursive:true,force:true}));
for(const name of ['navigation','trip-collection','calendar','memo','profile-update','booking-categories','install-platform'])await writeFile(path.join(directory,name+'.mjs'),ts.transpileModule(await readFile(new URL('./'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const nav=await import(pathToFileURL(path.join(directory,'navigation.mjs')));
const collection=await import(pathToFileURL(path.join(directory,'trip-collection.mjs')));
const trip=(id,title,startDate,endDate,role='owner',destination='서울')=>({id,title,startDate,endDate,role,destination,settings:{cities:[]}});
const trips=[trip('a','여행 2','2026-12-01','2026-12-05'),trip('b','여행 10','2026-10-18','2026-10-19','editor','항저우'),trip('c','가족 여행','2026-09-01','2026-09-03','viewer','서울')];
test('all preparation features remain reachable under the preparation bottom tab',()=>{
 for(const tab of ['checklist','bookings','categories','expenses']){assert.equal(nav.mobileSection(tab),'prepare');assert.equal(nav.sectionDestination('prepare',tab),tab);}
 assert.equal(nav.mobileSection('files'),'prepare');
 for(const tab of ['plan','tools','settings']){assert.equal(nav.mobileSection(tab),tab);assert.equal(nav.sectionDestination(tab,'expenses'),tab);}
 assert.equal(nav.sectionDestination('home','expenses'),null);
});
test('collection layout and sort buttons follow the requested cycles',()=>{
 assert.deepEqual([3,2,1].map(columns=>collection.nextColumns(columns,3)),[2,1,3]);
 assert.deepEqual(['newest','oldest','title'].map(collection.nextTripSort),['oldest','title','newest']);
});
test('date sorting uses departure dates and title sorting is Korean and numeric',()=>{
 const select=sort=>collection.filterTrips(trips,'',collection.initialTripFilter,sort,'2026-10-19').map(t=>t.id);
 assert.deepEqual(select('newest'),['a','b','c']);assert.deepEqual(select('oldest'),['c','b','a']);assert.deepEqual(select('title'),['c','a','b']);assert.deepEqual(trips.map(t=>t.id),['a','b','c']);
});
test('travel status includes both departure and arrival day and combines with ownership and destination filters',()=>{
 assert.equal(collection.tripStatus(trips[1],'2026-10-18'),'ongoing');assert.equal(collection.tripStatus(trips[1],'2026-10-19'),'ongoing');assert.equal(collection.tripStatus(trips[1],'2026-10-20'),'past');
 const filter={status:'ongoing',ownership:'invited',destination:'항저우'};
 assert.deepEqual(collection.filterTrips(trips,'여행',filter,'newest','2026-10-19').map(t=>t.id),['b']);
 assert.equal(collection.filterTrips(trips,'',{...filter,ownership:'owned'},'newest','2026-10-19').length,0);
});
test('collection search includes selected city names and normalizes composed Korean',()=>{
 const sample=trip('z','한강 산책','2026-10-19','2026-10-20');sample.settings.cities=[{name:'杭州'}];
 assert.equal(collection.filterTrips([sample],'杭州',collection.initialTripFilter,'title','2026-10-19').length,1);
 assert.equal(collection.filterTrips([sample],'한강'.normalize('NFD'),collection.initialTripFilter,'title','2026-10-19').length,1);
});

const calendar=await import(pathToFileURL(path.join(directory,'calendar.mjs')));
test('week navigation uses calendar weeks across month and year boundaries and concise Korean dates',()=>{
 assert.deepEqual(calendar.weekDates('2026-10-31'),['2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31']);
 assert.deepEqual(calendar.weekDates('2027-01-01'),['2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
 assert.equal(calendar.shortDate('2026-10-26'),'10/26 (월)');assert.equal(calendar.shortDate('2026-11-01'),'11/1 (일)');
 assert.equal(calendar.weekDates('2026-11-01')[0],'2026-11-01');
 assert.equal(calendar.shortDate('invalid'),'');assert.deepEqual(calendar.weekDates('invalid'),[]);
 assert.deepEqual(nav.preparationTabs.map(t=>t.id),['checklist','expenses','bookings','categories']);
});

const {memoText}=await import(pathToFileURL(path.join(directory,'memo.mjs')));
test('single-body memo editing preserves separate legacy content without duplicating modern notes',()=>{
 assert.equal(memoText({title:'옛 제목',note:'자세한 기록'}),'옛 제목\n자세한 기록');
 assert.equal(memoText({title:'긴 메모',note:'긴 메모 본문'}),'긴 메모 본문');
 assert.equal(memoText({title:'메모만'}),'메모만');
});

test('trip cards use nights and days and subtract verified flight nights',()=>{
 assert.equal(collection.tripLengthLabel({startDate:'2026-11-01',endDate:'2026-11-04'}),'3박 4일');
 assert.equal(collection.tripLengthLabel({startDate:'2026-11-01',endDate:'2026-11-12',flightNights:1}),'10박 12일');
 assert.equal(collection.tripLengthLabel({startDate:'2026-11-01',endDate:'2026-11-01'}),'0박 1일');
});

const {profileUpdate}=await import(pathToFileURL(path.join(directory,'profile-update.mjs')));
test('profile writes contain explicit preferences and version, never derived photos or identity fields',()=>{
 const profile={version:7,avatar:'https://k.kakaocdn.net/profile.jpg',email:'test@example.test',name:'부기'};
 assert.deepEqual(profileUpdate(profile,{theme:'dark'}),{version:7,theme:'dark'});
 assert.deepEqual(profileUpdate(profile,{...profile,theme:'light'}),{version:7,name:'부기',theme:'light'});
});

const booking=await import(pathToFileURL(path.join(directory,'booking-categories.mjs')));
test('reservation choices retain legacy custom fields and restore missing fixed categories without changing order',()=>{
 const settings={bookingCategories:[{id:'parking',label:'주차',kind:'other'},{id:'hotel',label:'머무는 곳',kind:'hotel'}]};
 assert.deepEqual(booking.bookingCategories(settings).map(c=>c.id),['parking','hotel','flight','tour']);assert.equal(booking.bookingCategories(settings)[1].label,'머무는 곳');assert.equal(settings.bookingCategories.length,2);assert.equal(booking.fixedBookingCategory('tour'),true);assert.equal(booking.fixedBookingCategory('parking'),false);
});


test('compact collections cycle only 2 and 1 while desktop retains 3, 2 and 1',()=>{
 assert.deepEqual([2,1,2,1].map(c=>collection.nextColumns(c,2)),[1,2,1,2]);
 assert.equal(collection.nextColumns(3,2),2);
});
test('initial selection picks the nearest departure and leaves past-only lists unselected',()=>{
 const list=[trip('late','늦은 여행','2026-12-01','2026-12-05'),trip('past','지난 여행','2026-09-01','2026-09-05'),trip('near','가까운 여행','2026-10-26','2026-10-29')];
 assert.equal(collection.preferredTrip(list,'2026-10-19').id,'near');
 assert.equal(collection.preferredTrip(list,'2026-10-26').id,'near');
 assert.equal(collection.preferredTrip(list,'2027-01-01'),null);
 assert.equal(collection.preferredTrip([],'2026-10-19'),null);
 assert.deepEqual(list.map(t=>t.id),['late','past','near']);
});
test('trip card countdowns use whole calendar days across month and year boundaries',()=>{
 assert.equal(collection.tripCountdown('2026-10-26','2026-10-19'),'D-7');
 assert.equal(collection.tripCountdown('2026-10-19','2026-10-19'),'D-DAY');
 assert.equal(collection.tripCountdown('2026-10-18','2026-10-19'),'D+1');
 assert.equal(collection.tripCountdown('2027-01-01','2026-12-31'),'D-1');
 assert.equal(collection.tripCountdown('2028-03-01','2028-02-28'),'D-2');
});

test('ongoing trips take priority through their arrival day, before upcoming trips',()=>{const active=trip('active','여행 중','2026-10-17','2026-10-21'),future=trip('tomorrow','내일','2026-10-20','2026-10-23');assert.equal(collection.preferredTrip([future,active],'2026-10-19').id,'active');assert.equal(collection.preferredTrip([future,active],'2026-10-21').id,'tomorrow');assert.equal(collection.tripStatus(active,'2026-10-21'),'ongoing');});

test('reselecting preparation returns to its initial checklist screen',()=>{for(const previous of ['checklist','expenses','bookings','categories']){assert.equal(nav.sectionDestination('prepare',previous,true),'checklist');assert.equal(nav.sectionDestination('prepare',previous,false),previous);}assert.equal(nav.sectionDestination('plan','expenses',true),'plan');});

const {installPlatform}=await import(pathToFileURL(path.join(directory,'install-platform.mjs')));
test('install options use the device OS rather than viewport size and include desktop-mode iPad',()=>{
 assert.equal(installPlatform('Mozilla Android 16','Linux armv8l',5),'android');
 assert.equal(installPlatform('Mozilla iPhone OS 26','iPhone',5),'ios');
 assert.equal(installPlatform('Mozilla Macintosh','MacIntel',5),'ios');
 assert.equal(installPlatform('Mozilla Macintosh','MacIntel',0),'desktop');
 assert.equal(installPlatform('Mozilla Windows NT 10','Win32',0),'desktop');
});
