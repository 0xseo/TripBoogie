// Compiled only into the instrumentation APK, never the application APK.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {BookingForm} from '../../app/components/Bookings';
import PlanComposer from '../../app/components/PlanComposer';
import {ExpenseForm} from '../../app/components/Expenses';
import TripForm from '../../app/components/TripForm';
import Checklist from '../../app/components/Checklist';
import CategoryEditor from '../../app/components/CategoryEditor';
import AccountSettings from '../../app/components/AccountSettings';
import PlacePicker from '../../app/components/PlacePicker';
import ManualPlacePicker from '../../app/components/ManualPlacePicker';
import TripCollectionControls from '../../app/components/TripCollectionControls';
import ItineraryEditor from '../../app/ItineraryEditor';
import {dayGraph} from '../../app/route-graph';
import KeyboardFocus from '../../app/components/KeyboardFocus';
import {MobileTripNav} from '../../app/components/TripNavigation';
import Toast from '../../app/components/Toast';
import {ConfirmationProvider} from '../../app/components/Confirmation';
import {Dialog} from '../../app/components/ui';
import type {Workspace,Profile,ItemRecord} from '../../app/types';
import '../../app/styles.css';
import '../native.css';
const noop=()=>{},save=async()=>{};
const profile:Profile={id:'test',name:'검증 계정',email:'test@example.invalid',baseCurrency:'KRW',version:1};
const row=(id:string,kind:ItemRecord['kind'],data:Record<string,unknown>):ItemRecord=>({id,kind,data,version:1,updatedAt:'',updatedBy:'test'});
const memo=Array.from({length:60},(_,i)=>`${i+1}번째 줄 · 예약 및 일정 메모 입력 중 커서가 가리지 않는지 확인합니다.`).join('\n');
const bookings=['flight','hotel','tour','other'].map(type=>row(type,'booking',{type,title:type==='hotel'?'검증 숙소':type==='tour'?'검증 투어':'검증 예약',startDate:'2026-11-01',endDate:'2026-11-03',startTime:'09:15',endTime:'13:20',departure:'ICN',arrival:'AKL',flightNumber:'KE411',note:memo,platform:'예약 플랫폼',reference:'ABC123',roomName:'디럭스 트윈',moneyAmount:1000}));
const routePlaces=[row('a','place',{name:'서울역',lat:37.55,lng:126.97}),row('b','place',{name:'숙소',lat:37.56,lng:126.98})];
const routePlans=Array.from({length:10},(_,i)=>row('plan'+i,'plan',{title:`일정 ${i+1}`,date:'2026-11-01',placeId:i%2?'b':'a',position:i,travelMinutes:10,transportMode:'walk'}));
const graph=dayGraph(routePlans,routePlaces);
const workspace:Workspace={trip:{id:'test',title:'키보드 검증 여행',destination:'서울',startDate:'2026-11-01',endDate:'2026-11-04',currency:'KRW',timezone:'Asia/Seoul',settings:{expenseCategories:[{id:'food',label:'식비'}],checklistCategories:[{id:'prepare',label:'준비'}]},version:1,revision:1,role:'owner',memberCount:1,createdAt:'',updatedAt:''},revision:1,members:[{id:'test',name:'검증 계정',email:'test@example.invalid',role:'owner'}],files:[],records:bookings};
// No live account, maps provider, or reservation writes are used by this test.
window.fetch=async(input)=>Response.json(String(input).includes('auth-config')?{url:'',publishableKey:'',providers:{email:false,google:false,kakao:false}}:{places:[],holidays:[],supported:false,time:600,rate:1,date:'2026-11-01'});
declare global{interface Window{keyboardFixture:{show:(scene:string)=>void;saved:unknown[];memo:string;ready:boolean}}}
window.keyboardFixture={show:noop,saved:[],memo,ready:false};
function Fixture(){
 const [scene,setScene]=useState(new URLSearchParams(location.search).get('scene')||'toast'),[query,setQuery]=useState('');
 window.keyboardFixture.show=setScene;window.keyboardFixture.ready=true;
 const type=scene.split('-')[1],booking=bookings.find(b=>b.data.type===type);
 return <ConfirmationProvider><KeyboardFocus/><main style={{padding:16,paddingBottom:90}}>
 {scene==='travel'&&<ItineraryEditor workspace={{...workspace,records:[...routePlaces,...routePlans]}} date='2026-11-01' days={['2026-11-01']} plans={routePlans} places={routePlaces} connections={graph.connections} disabled={false} onSchedule={async()=>workspace} onEdit={noop} onRemove={noop} onAdd={noop} onError={noop} onBooking={noop} onSave={save} onEstimate={save}/>}
 {scene.startsWith('booking-')&&<BookingForm key={scene} workspace={workspace} profile={profile} type={type} record={scene.endsWith('-new')?undefined:booking} onSave={async(...args)=>{window.keyboardFixture.saved.push(args);}} onClose={noop}/>}
 {scene==='plan'&&<PlanComposer workspace={workspace} date='2026-11-01' record={row('plan','plan',{title:'일정 입력',time:'09:15',duration:60,note:memo})} onSave={save} onClose={noop} onNotice={noop} onHotel={save}/>}
 {scene.startsWith('linked-plan-')&&<PlanComposer key={scene} workspace={workspace} date='2026-11-01' record={row('linked-plan','plan',{entryType:'plan',title:'연결된 일정',date:'2026-11-01',time:'09:15',bookingId:scene.slice('linked-plan-'.length),bookingEvent:'manual',note:memo})} onSave={async(...args)=>{window.keyboardFixture.saved.push(args);}} onClose={noop} onNotice={noop} onHotel={save}/>}
 {scene==='memo'&&<PlanComposer workspace={workspace} date='2026-11-01' record={row('memo','plan',{entryType:'memo',note:memo})} onSave={save} onClose={noop} onNotice={noop} onHotel={save}/>}
 {scene==='expense'&&<ExpenseForm workspace={workspace} profile={profile} record={row('expense','expense',{model:2,title:'검증 식사',amount:1000,tripAmount:1000,baseAmount:1000,tripCurrency:'USD',baseCurrency:'KRW',paidCurrency:'USD',exchangeRate:1,date:'2026-11-01',note:memo,payers:[{userId:'test',name:'검증 계정',amount:'1000'}],participants:[{userId:'test',name:'검증 계정',amount:'1000'}]})} categories={workspace.trip.settings.expenseCategories} initialPeriod='day' initialDate='2026-11-01' onSave={save} onClose={noop}/>}
 {scene==='trip'&&<TripForm trip={workspace.trip} onSave={save} onClose={noop}/>}
 {scene==='trip-new'&&<TripForm onSave={save} onClose={noop}/>}
 {scene==='checklist'&&<Checklist workspace={workspace} userId='test' readOnly={false} onSave={save} onDelete={noop} onToggle={save} onReorder={save}/>}
 {scene==='categories'&&<CategoryEditor title='분류 수정' items={Array.from({length:12},(_,i)=>({id:String(i),label:`분류 ${i+1}`}))} onSave={save} onClose={noop}/>}
 {scene==='account'&&<AccountSettings profile={profile} onSave={save} onLogout={noop} signingOut={false} onAuthenticated={noop} onWithdraw={save}/>}
 {scene==='place'&&<Dialog mobilePage title='장소 검색' onClose={noop}><PlacePicker onChoose={noop}/></Dialog>}
 {scene==='manual'&&<ManualPlacePicker initial={{name:'장소 입력',address:'서울',lat:37.55,lng:126.97}} onChoose={noop} onClose={noop}/>}
 {scene==='search'&&<TripCollectionControls query={query} onQuery={setQuery} columns={2} onColumns={noop} sort='upcoming' onSort={noop} filter={{status:'all',ownership:'all',destination:''}} onFilter={noop} destinations={[]}/>}
 <Toast message='저장했어북'/>
 <MobileTripNav tab='plan' disabled={false} onSelect={noop}/>
 </main></ConfirmationProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
