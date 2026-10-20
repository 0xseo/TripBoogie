package com.tripboogie.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeWebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises production React forms with the OS software keyboard in the actual app WebView. */
@RunWith(AndroidJUnit4.class)
public class FormKeyboardTest {
    private static String js(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        AtomicReference<String> result=new AtomicReference<>("");CountDownLatch done=new CountDownLatch(1);
        scenario.onActivity(a->a.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);done.countDown();}));
        assertTrue("JavaScript timed out",done.await(30,TimeUnit.SECONDS));return result.get();
    }
    private static void expect(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        String result="";for(int i=0;i<60;i++){result=js(scenario,script);if("true".equals(result))return;SystemClock.sleep(100);}
        fail(script+" => "+result);
    }
    private static void click(ActivityScenario<MainActivity> scenario,String text) throws Exception {
        expect(scenario,"(()=>{const b=[...document.querySelectorAll('dialog[open] button,main button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())==="+JSONObject.quote(text)+");if(!b)return false;b.click();return true})()");SystemClock.sleep(250);
    }
    private static void show(ActivityScenario<MainActivity> scenario,String scene) throws Exception {
        js(scenario,"document.activeElement?.blur();window.keyboardFixture.show("+JSONObject.quote(scene)+");true");SystemClock.sleep(450);
    }
    private static void keyboard(ActivityScenario<MainActivity> scenario) throws Exception { KeyboardTestHost.keyboard(scenario); }
    private static final String FIELDS="[...document.querySelectorAll('dialog[open] input,dialog[open] textarea,main input')].filter(e=>!e.disabled&&!e.readOnly&&!['checkbox','radio','file','hidden','button','submit'].includes(e.type)&&e.getClientRects().length)";
    private static final String INPUT_BOUNDS="(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),d=e.closest('dialog'),v=visualViewport;let top=v.offsetTop+8,bottom=v.offsetTop+v.height-8;const h=d?.querySelector('header');if(h)top=Math.max(top,h.getBoundingClientRect().bottom);for(const f of d?.querySelectorAll('footer,form>.primary:last-child')||[]){const b=f.getBoundingClientRect();if(/sticky|fixed/.test(getComputedStyle(f).position)&&b.top>top)bottom=Math.min(bottom,b.top);}return JSON.stringify({label:e.getAttribute('aria-label')||e.placeholder||e.tagName,top:r.top,bottom:r.bottom,limitTop:top,limitBottom:bottom,clear:r.top>=top-2&&r.bottom<=bottom+2,scrollTop:e.scrollTop})})()";
    private static int audit(ActivityScenario<MainActivity> scenario,String label) throws Exception {
        int count=Integer.parseInt(js(scenario,FIELDS+".length"));assertTrue("No editable field in "+label,count>0);
        for(int index=0;index<count;index++){
            js(scenario,"(()=>{const e="+FIELDS+"["+index+"];e.focus();if(e.tagName==='TEXTAREA')e.setSelectionRange(e.value.length,e.value.length);e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
            keyboard(scenario);
            expect(scenario,"JSON.parse("+INPUT_BOUNDS+").clear");
            String bounds=js(scenario,INPUT_BOUNDS);
            JSONObject result=new JSONObject(new org.json.JSONTokener(bounds).nextValue().toString());
            System.out.println("FORM_KEYBOARD "+label+" #"+index+" "+result);
            assertTrue(label+" input hidden: "+result,result.getBoolean("clear"));
        }
        return count;
    }
    private static void loadFixture(ActivityScenario<MainActivity> scenario) throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getContext();
        KeyboardTestHost.ready(scenario);
        CountDownLatch fixtureLoaded=new CountDownLatch(1);
        String html="<!doctype html><html class='native-app'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><link rel='stylesheet' href='fixture.css'><script defer src='fixture.js'></script><body><div id='root'></div></body></html>";
        scenario.onActivity(a->{
            WebView web=a.getBridge().getWebView();web.stopLoading();
            web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage message){System.out.println("FIXTURE_CONSOLE "+message.message().substring(0,Math.min(700,message.message().length())));return true;}});
            // Stream the test-only assets as normal resources. Large inline or
            // evaluateJavascript bundles can stall Chromium's initial navigation.
            web.setWebViewClient(new BridgeWebViewClient(a.getBridge()){
            @Override public void onPageFinished(WebView view,String url){super.onPageFinished(view,url);if(url.equals("https://localhost/keyboard-test/"))fixtureLoaded.countDown();}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String path=request.getUrl().getPath();
                try {
                    if("/keyboard-test/".equals(path))return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                    if("/keyboard-test/fixture.js".equals(path))return new WebResourceResponse("application/javascript","UTF-8",context.getAssets().open("fixture.js"));
                    if(path!=null&&path.startsWith("/pdfjs/")&&!path.contains(".."))return new WebResourceResponse(path.endsWith(".js")?"application/javascript":path.endsWith(".wasm")?"application/wasm":"application/octet-stream",null,context.getAssets().open(path.substring(1)));
                    if("/keyboard-test/fixture.css".equals(path))return new WebResourceResponse("text/css","UTF-8",context.getAssets().open("fixture.css"));
                }catch(IOException e){throw new RuntimeException(e);}
                return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
            }});
            web.loadUrl("https://localhost/keyboard-test/");
        });
            // JS callbacks requested during navigation can be discarded with
            // the old document. Wait in Java for the new page to finish first.
            assertTrue("Fixture document did not finish loading",fixtureLoaded.await(30,TimeUnit.SECONDS));
            expect(scenario,"!!window.keyboardFixture?.ready");
            expect(scenario,"(()=>{const t=document.querySelector('body>.toast')?.getBoundingClientRect(),n=document.querySelector('.mobile-trip-nav')?.getBoundingClientRect();return !!t&&!!n&&t.bottom<n.top})()");
    }
    private static void input(ActivityScenario<MainActivity> scenario,String selector,String value) throws Exception {
        js(scenario,"(()=>{const e=document.querySelector("+JSONObject.quote(selector)+");Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");SystemClock.sleep(150);
    }
    private static void pull(ActivityScenario<MainActivity> scenario,String event,int y) throws Exception {
        js(scenario,"(()=>{const target=document.querySelector('[data-refresh-test]'),e=new Event('"+event+"',{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:"+(event.equals("touchend")||event.equals("touchcancel")?"[]":"[{clientX:30,clientY:"+y+"}]")+"});target.dispatchEvent(e);return true})()");SystemClock.sleep(100);
    }
    private static void screenshot(String name) throws Exception {
        Bitmap image=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        try(FileOutputStream output=new FileOutputStream(new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),name+".png"))){image.compress(Bitmap.CompressFormat.PNG,100,output);}image.recycle();
    }
    @Test public void bookingNoticesHotelPlaceOnlyAndRefreshFeedback() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            loadFixture(scenario);
            show(scenario,"booking-tour-unlinked");js(scenario,"window.keyboardFixture.notices=[];true");
            input(scenario,"textarea","연결 없는 투어 메모");expect(scenario,"window.keyboardFixture.notices.length===0");
            show(scenario,"booking-tour");input(scenario,"[data-validation-label='이름'] input","수정한 투어");
            expect(scenario,"window.keyboardFixture.notices.at(-1).includes('연결된 일정')");
            input(scenario,"textarea","수정한 투어 메모");expect(scenario,"window.keyboardFixture.notices.at(-1).includes('일정 메모도 함께 변경')");
            js(scenario,"window.noticeCount=window.keyboardFixture.notices.length;true");input(scenario,"textarea","메모 계속 입력");expect(scenario,"window.noticeCount===window.keyboardFixture.notices.length");
            show(scenario,"plan-hotel");click(scenario,"숙소");
            expect(scenario,"document.querySelector('.place-input').textContent.includes('숙소')&&document.querySelector('dialog[open] header').textContent.includes('일정 추가')");
            expect(scenario,"document.querySelector('textarea').value===''&&document.querySelector('[aria-label=\"연결할 예약\"]').textContent.includes('연결 안 함')");
            screenshot("hotel-place");click(scenario,"저장하기");
            expect(scenario,"(()=>{const d=window.keyboardFixture.saved.at(-1)[0];return d.placeId==='b'&&d.bookingId===''&&d.date==='2026-11-02'&&d.time===''&&d.note===''})()");
            show(scenario,"plan-hotels");click(scenario,"숙소");expect(scenario,"document.querySelectorAll('.hotel-shortcut-options button').length===2");click(scenario,"두 번째 숙소");click(scenario,"저장하기");expect(scenario,"window.keyboardFixture.saved.at(-1)[0].placeId==='a'&&window.keyboardFixture.saved.at(-1)[0].bookingId===''");
            show(scenario,"plan-hotel-linked");click(scenario,"숙소");click(scenario,"저장하기");
            expect(scenario,"(()=>{const d=window.keyboardFixture.saved.at(-1)[0];return d.placeId==='b'&&d.bookingId==='tour'&&d.time==='09:15'&&d.note===window.keyboardFixture.memo})()");
            show(scenario,"plan-hotel-missing");click(scenario,"숙소");expect(scenario,"window.keyboardFixture.notices.at(-1).includes('등록된 장소가 없어요')");
            show(scenario,"plan-no-hotel");click(scenario,"숙소");expect(scenario,"window.keyboardFixture.notices.at(-1)==='이날은 예약된 숙소가 없어요.'");
            show(scenario,"refresh");js(scenario,"window.scrollTo(0,0);true");
            pull(scenario,"touchstart",100);pull(scenario,"touchmove",130);expect(scenario,"document.querySelector('body>.pull-indicator')?.textContent==='당겨서 새로고침'");
            expect(scenario,"(()=>{const e=document.querySelector('.pull-indicator'),r=e.getBoundingClientRect();return r.height>=44&&r.top>0&&r.bottom<innerHeight&&!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)})()");
            pull(scenario,"touchend",130);expect(scenario,"!document.querySelector('.pull-indicator')&&window.keyboardFixture.refreshes===0");
            pull(scenario,"touchstart",100);pull(scenario,"touchmove",210);expect(scenario,"document.querySelector('.pull-indicator')?.textContent==='놓으면 새로고침'");SystemClock.sleep(500);System.out.println("PULL_INDICATOR_LAYOUT "+js(scenario,"(()=>{const e=document.querySelector('.pull-indicator'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height,translate:s.translate,transform:s.transform,opacity:s.opacity,visibility:s.visibility,z:s.zIndex,color:s.color,background:s.backgroundColor,dialogs:document.querySelectorAll('dialog[open]').length})})()"));screenshot("pull-ready");pull(scenario,"touchend",210);pull(scenario,"touchend",210);
            expect(scenario,"window.keyboardFixture.refreshes===1&&!!document.querySelector('body>.refresh-overlay')&&document.querySelector('main').inert");
            expect(scenario,"(()=>{const e=document.querySelector('.refresh-overlay'),r=document.querySelector('.refresh-loader').getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<2&&Math.abs(r.y+r.height/2-innerHeight/2)<2&&getComputedStyle(e).backgroundColor==='rgb(255, 255, 255)'&&document.elementFromPoint(innerWidth-20,innerHeight-100)===e})()");screenshot("refresh-centered");
            js(scenario,"window.keyboardFixture.finishRefresh();true");expect(scenario,"!document.querySelector('.refresh-overlay')&&!document.querySelector('main').inert&&document.body.style.overflow!==\"hidden\"");
            pull(scenario,"touchstart",100);pull(scenario,"touchmove",210);pull(scenario,"touchend",210);expect(scenario,"window.keyboardFixture.refreshes===2");js(scenario,"window.keyboardFixture.finishRefresh(true);true");expect(scenario,"!document.querySelector('.refresh-overlay')&&!document.querySelector('main').inert");
            System.out.println("RESERVATION_REFRESH_UI_PASS linkedTourNotice=true hotelPlaceOnly=true multiHotel=true linkedBookingPreserved=true pullFeedback=true centeredOpaqueLoading=true refreshCleanup=true");
        }
    }
    @Test public void allFormInputsClearKeyboardAndStickyActions() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            loadFixture(scenario);
            int count=0;
            for(String type:new String[]{"hotel","flight","tour","other"}){
                show(scenario,"booking-"+type);
                if(!type.equals("flight"))js(scenario,"(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'메모만 수정한 내용\\n'+e.value);e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
                count+=audit(scenario,type+" booking details");
                if(type.equals("flight"))expect(scenario,"document.querySelector('.booking-add-plan input').checked===false");
                click(scenario,"다음");
                if(!type.equals("flight"))expect(scenario,"document.querySelector('.booking-add-plan input').checked==="+type.equals("tour"));
                if(type.equals("flight"))count+=audit(scenario,"flight reservation details");
                click(scenario,"다음");
                count+=audit(scenario,type+" booking payment");click(scenario,"예약 저장");
                expect(scenario,"window.keyboardFixture.saved.at(-1)?.[4]==="+type.equals("tour"));
                if(!type.equals("flight"))expect(scenario,"window.keyboardFixture.saved.at(-1)[0].note.startsWith('메모만 수정한 내용')");
            }
            for(String type:new String[]{"flight","hotel","tour","other"}){
                show(scenario,"booking-"+type+"-new");
                if(!type.equals("flight")){
                    js(scenario,"(()=>{const e=document.querySelector('dialog[open] input:not([type=checkbox])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'새 예약');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");click(scenario,"다음");
                }
                expect(scenario,"document.querySelector('.booking-add-plan input').checked==="+(!type.equals("other")));
            }
            show(scenario,"plan");count+=audit(scenario,"plan title/duration/memo");
            expect(scenario,"(()=>{const t=document.querySelector('.optional-time .time-trigger').getBoundingClientRect(),i=document.querySelector('.optional-time input').getBoundingClientRect();return Math.abs(t.top-i.top)<2&&Math.abs(t.height-i.height)<2})()");
            click(scenario,"연결할 예약");
            expect(scenario,"[...document.querySelectorAll('.choice-options button')].filter(e=>e.querySelector('.choice-label>svg')).length===4");
            click(scenario,"검증 숙소 · 11/1 (일)");expect(scenario,"!!document.querySelector('[aria-label=\"연결할 예약\"] svg.lucide-hotel')");
            show(scenario,"memo");count+=audit(scenario,"full-page long memo");
            Bitmap screenshot=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            try(FileOutputStream output=new FileOutputStream(new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"keyboard-memo.png"))){screenshot.compress(Bitmap.CompressFormat.PNG,100,output);}screenshot.recycle();
            show(scenario,"expense");count+=audit(scenario,"expense amount/title");js(scenario,"document.querySelector('.summary-button').click();true");count+=audit(scenario,"exchange rate");click(scenario,"결제 금액으로");click(scenario,"함께 나누기");js(scenario,"document.querySelector('.expense-note summary').click();true");count+=audit(scenario,"expense memo");click(scenario,"결제자 수정");count+=audit(scenario,"expense payer amounts");click(scenario,"금액 확인 화면으로");click(scenario,"분담자 수정");count+=audit(scenario,"expense participant amounts");
            show(scenario,"trip");count+=audit(scenario,"trip name");
            show(scenario,"trip-new");count+=audit(scenario,"city search");
            show(scenario,"categories");count+=audit(scenario,"category rows including last row");
            show(scenario,"checklist");click(scenario,"할 일 추가");count+=audit(scenario,"checklist item");
            show(scenario,"account");click(scenario,"이름검증 계정");count+=audit(scenario,"account name");
            show(scenario,"account");click(scenario,"계정 탈퇴");count+=audit(scenario,"withdrawal confirmation");
            show(scenario,"place");count+=audit(scenario,"place search");
            show(scenario,"manual");count+=audit(scenario,"map place name");
            show(scenario,"search");count+=audit(scenario,"trip search");
            show(scenario,"travel");count+=audit(scenario,"itinerary route duration including last row");
            System.out.println("FORM_KEYBOARD_TOTAL_FIELDS "+count);
        }
    }
    @Test public void linkedPlanMemoPayloadAndModalToastStayCorrect() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            loadFixture(scenario);
            double toastTop=Double.parseDouble(js(scenario,"document.querySelector('.toast').getBoundingClientRect().top"));
            for(String type:new String[]{"flight","hotel","tour","other"}){
                show(scenario,"linked-plan-"+type);
                expect(scenario,"document.querySelector('dialog[open]>.toast')!==null");
                assertEquals("Opening a modal must not lift the toast",toastTop,Double.parseDouble(js(scenario,"document.querySelector('.toast').getBoundingClientRect().top")),2);
                for(String memo:new String[]{"일정에서 바꾼 메모", ""}){
                    js(scenario,"(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(memo)+");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
                    click(scenario,"저장하기");
                    expect(scenario,"window.keyboardFixture.saved.at(-1)?.[0].note==="+JSONObject.quote(memo)+"&&window.keyboardFixture.saved.at(-1)[0].bookingId==="+JSONObject.quote(type));
                }
                click(scenario,"연결할 예약");
                expect(scenario,"document.querySelectorAll('dialog[open]').length===2");
                System.out.println("TOAST_NESTED "+js(scenario,"(()=>{const t=document.querySelector('.toast'),c=getComputedStyle(t);return JSON.stringify({toast:t.getBoundingClientRect().toJSON(),style:{top:c.top,bottom:c.bottom,position:c.position},vh:visualViewport.height,innerHeight,scrollY,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>({rect:d.getBoundingClientRect().toJSON(),filter:getComputedStyle(d).filter,transform:getComputedStyle(d).transform,contain:getComputedStyle(d).contain,scroll:d.scrollTop}))})})()"));
                assertEquals("Nested modal must keep toast position",toastTop,Double.parseDouble(js(scenario,"document.querySelector('.toast').getBoundingClientRect().top")),2);
                js(scenario,"[...document.querySelectorAll('dialog[open]')].at(-1).querySelector('[aria-label=닫기]').click();true");
            }
        }
    }
    @Test public void documentsFileManagementAndMultiCountryTools() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            loadFixture(scenario);
            String audit=js(scenario,"JSON.stringify(window.keyboardFixture.auditDocuments())");System.out.println("DOCUMENT_AUDIT "+audit);
            expect(scenario,"window.keyboardFixture.auditDocuments().pass");
            show(scenario,"preview-pdf");
            boolean oldPdfEngine=Boolean.parseBoolean(js(scenario,"(()=>{const m=navigator.userAgent.match(/Chrome\\/(\\d+)/);return !!m&&Number(m[1])<125})()"));
            if(oldPdfEngine){expect(scenario,"document.querySelector('.file-preview [role=alert]')?.textContent.includes('업데이트')&&!document.querySelector('.preview-loading')");}
            else {
            expect(scenario,"document.querySelector('canvas')?.width>0&&!document.querySelector('.file-preview [role=status]')&&!document.querySelector('.file-preview [role=alert]')");
            expect(scenario,"document.querySelector('.preview-toolbar').textContent.includes('1 / 2')");SystemClock.sleep(500);screenshot("preview-pdf");
            click(scenario,"다음 페이지");expect(scenario,"document.querySelector('.preview-toolbar').textContent.includes('2 / 2')&&!document.querySelector('.file-preview [role=status]')");click(scenario,"확대");
            }
            show(scenario,"preview-docx");expect(scenario,"document.querySelector('.preview-text')?.textContent.includes('<script>alert(1)</script>')&&!document.querySelector('.preview-text script')");screenshot("preview-docx");
            show(scenario,"preview-xlsx");expect(scenario,"document.querySelector('.preview-sheet-tabs')?.textContent.includes('여행 경비')");click(scenario,"날짜");expect(scenario,"document.querySelector('.preview-sheet')?.textContent.includes('2024-01-01 12:00:00')");screenshot("preview-xlsx");
            show(scenario,"preview-txt");expect(scenario,"document.querySelector('.preview-text')?.textContent.includes('숙소 주소')");
            show(scenario,"preview-png");expect(scenario,"document.querySelector('.preview-image')?.naturalWidth===1");
            show(scenario,"tags-protected");expect(scenario,"document.querySelectorAll('[aria-label=\"기본 태그\"]').length===3&&document.querySelectorAll('button[aria-label$=\"태그 삭제\"]').length===1");screenshot("protected-tags");
            show(scenario,"files");expect(scenario,"document.querySelector('.file-count').textContent==='자료 5개'");
            js(scenario,"document.querySelectorAll('.file-list input[type=checkbox]')[0].click();document.querySelectorAll('.file-list input[type=checkbox]')[1].click();true");
            click(scenario,"선택 태그 이동");click(scenario,"투어·티켓");click(scenario,"적용");expect(scenario,"(()=>{const [op,p]=window.keyboardFixture.saved.at(-1);return op==='set-files-tags'&&p.files.length===2&&p.tags.includes('tour')})()");
            input(scenario,"[aria-label='자료 검색']","숙소");expect(scenario,"document.querySelectorAll('[data-file-id]').length===1&&document.querySelector('.file-count').textContent==='자료 5개'");screenshot("files-search");
            show(scenario,"expenses-multi");expect(scenario,"document.querySelector('.expense-summary>span').textContent.includes('50')&&document.querySelector('[data-currency=JPY]').textContent.includes('2')&&document.querySelector('[data-currency=KRW]').textContent.includes('30')&&document.querySelector('[data-currency=NZD]').textContent.includes('0')");screenshot("expenses-multi");
            show(scenario,"tools-multi");expect(scenario,"document.querySelectorAll('.clock-group').length===2&&document.querySelectorAll('.weather-city').length===3&&document.querySelectorAll('.currency-exchange-row').length===2");
            expect(scenario,"document.querySelectorAll('.city-weather-content').length===1");js(scenario,"document.querySelectorAll('.weather-city summary')[1].click();true");expect(scenario,"document.querySelectorAll('.city-weather-content').length===2");SystemClock.sleep(500);screenshot("tools-multi");
            System.out.println("RELEASE24_DOCUMENT_FILES_TOOLS_PASS");
        }
    }
    @Test public void directPaidBookingsFlightExtrasAndExistingPlace() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            loadFixture(scenario);
            for(String type:new String[]{"hotel","flight","tour","other"}){
                show(scenario,"booking-"+type+"-paid");click(scenario,"다음");
                if(type.equals("flight")){
                    click(scenario,"수하물 추가");input(scenario,"[aria-label='좌석']","18A");input(scenario,"[aria-label='수하물 개수 1']","2");input(scenario,"[aria-label='수하물 무게 1']","23");click(scenario,"수하물 추가");
                }
                click(scenario,"다음");js(scenario,"document.querySelector('.booking-paid-check input').click();true");
                expect(scenario,"document.querySelector('.booking-payers').textContent.includes('검증 계정')");
                input(scenario,"[aria-label='기준통화 환산 금액']","1200");click(scenario,"예약 저장");
                expect(scenario,"(()=>{const args=window.keyboardFixture.saved.at(-1);return args[0].isPaid&&args[2].data.baseAmount==='1200'&&args[2].data.tripAmount==='1000'&&args[2].data.payers[0].userId==='test'&&!document.querySelector('.allocation-section')})()");
                if(type.equals("flight"))expect(scenario,"window.keyboardFixture.saved.at(-1)[0].flightExtras.length===2&&window.keyboardFixture.saved.at(-1)[0].flightSeat==='18A'");
            }
            show(scenario,"expense-multi-new");input(scenario,"[data-validation-label='어디에 쓴 돈인가요?'] input","통화 전환 검증");input(scenario,".currency-inputs input","100");expect(scenario,"document.querySelectorAll('.currency-inputs input')[1].value==='80000'");
            click(scenario,"실제로 결제한 통화");click(scenario,"JPY");expect(scenario,"document.querySelectorAll('.currency-inputs input')[0].value==='100'&&document.querySelectorAll('.currency-inputs input')[1].value==='1000'");
            input(scenario,".currency-inputs label:nth-child(2) input","1200");click(scenario,"함께 나누기");click(scenario,"경비 저장");expect(scenario,"(()=>{const d=window.keyboardFixture.saved.at(-1)[0];return d.paidCurrency==='JPY'&&d.tripAmount==='100'&&d.baseAmount==='1200'&&d.payers[0].amount==='100'})()");
            show(scenario,"plan-place");js(scenario,"document.querySelector('.place-input button').click();true");expect(scenario,"document.querySelector('dialog[open]').textContent.includes('서울 용산구 한강대로 405')&&document.activeElement?.getAttribute('aria-label')!=='장소·주소 검색'");screenshot("existing-place");click(scenario,"이 장소로 정해북");click(scenario,"저장하기");expect(scenario,"window.keyboardFixture.saved.at(-1)[0].placeId==='a'&&!window.keyboardFixture.saved.at(-1)[1]");
            show(scenario,"trip-country");click(scenario,"변경 저장");expect(scenario,"(()=>{const d=window.keyboardFixture.saved.at(-1)[0];return d.cities.length===0&&d.countries.includes('NZ')&&d.currencies.includes('NZD')})()");
            show(scenario,"trip-multi");expect(scenario,"document.querySelector('.grouped-city-summary').textContent.includes('로토루아(환승)')&&!document.querySelector('.trip-image-picker')");
            click(scenario,"국가·도시");double before=Double.parseDouble(js(scenario,"document.querySelector('dialog[open]').getBoundingClientRect().height"));js(scenario,"document.querySelector('[aria-label=\"여행 국가·도시 검색\"]').focus();true");keyboard(scenario);
            scenario.onActivity(a->((InputMethodManager)a.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(a.getBridge().getWebView().getWindowToken(),0));SystemClock.sleep(1200);
            assertEquals("City search keyboard must restore the whole dialog",before,Double.parseDouble(js(scenario,"document.querySelector('dialog[open]').getBoundingClientRect().height")),2);screenshot("trip-search-restored");
            System.out.println("RELEASE24_PAID_FLIGHT_EXPENSE_PLACE_COUNTRY_KEYBOARD_PASS");
        }
    }
    @Test public void reservationPaymentLayoutAndReciprocalExpenseNavigation() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            loadFixture(scenario);show(scenario,"booking-flight-linked");expect(scenario,"document.querySelector('.booking-add-plan input').checked&&document.querySelector('.booking-add-plan input').disabled");
            show(scenario,"booking-flight-group");click(scenario,"다음");expect(scenario,"document.querySelectorAll('[aria-label=좌석]').length===1");click(scenario,"수하물 추가");click(scenario,"수하물 추가");expect(scenario,"document.querySelectorAll('.flight-extra').length===2&&document.querySelectorAll('.flight-extra [aria-label^=좌석]').length===0");input(scenario,"[aria-label=좌석]","22C");
            click(scenario,"다음");js(scenario,"document.querySelector('.booking-paid-check input').click();true");expect(scenario,"document.querySelector('.booking-conversion-row')&&!document.querySelector('.booking-payers [inputmode=decimal]')&&document.querySelectorAll('.booking-participant-options input:checked').length===3");
            input(scenario,"[aria-label='기준통화 환산 금액']","810000");js(scenario,"document.querySelectorAll('.booking-participant-options input')[2].click();true");SystemClock.sleep(500);screenshot("release25-payment-layout");click(scenario,"예약 저장");expect(scenario,"(()=>{const [b,,e]=window.keyboardFixture.saved.at(-1);return b.flightSeat==='22C'&&b.flightExtras.length===2&&e.data.category==='flight'&&e.data.baseAmount==='810000'&&e.data.participants.length===2&&e.data.participants.every(p=>p.amount==='500')})()");
            show(scenario,"booking-flight-paid");click(scenario,"다음");click(scenario,"다음");click(scenario,"예약 통화");click(scenario,"KRW");js(scenario,"document.querySelector('.booking-paid-check input').click();true");expect(scenario,"!document.querySelector('.booking-conversion-row')");click(scenario,"예약 저장");expect(scenario,"(()=>{const d=window.keyboardFixture.saved.at(-1)[2].data;return d.tripCurrency==='KRW'&&d.baseCurrency==='KRW'&&d.tripAmount==='1000'&&d.baseAmount==='1000'&&d.exchangeRate==='1'})()");
            show(scenario,"attachments");expect(scenario,"document.querySelectorAll('.file-row').length===5&&!document.querySelector('.file-management-bar')&&!document.querySelector('.file-row input[type=checkbox]')");
            show(scenario,"categories-expense");expect(scenario,"document.querySelectorAll('[aria-label=\"기본 분류\"]').length===5&&!document.querySelector('button[aria-label$=\"분류 삭제\"]')");
            show(scenario,"booking-cards");expect(scenario,"(()=>{const p=document.querySelector('.booking-expense-link'),l=document.querySelector('.booking-plan-links');return p.querySelector('svg.lucide-coins')&&p.textContent.includes('경비에 반영됨')&&p.getBoundingClientRect().top>=l.getBoundingClientRect().bottom&&!document.querySelector('.booking-payer-names')})()");js(scenario,"document.querySelector('.booking-expense-link').scrollIntoView({block:'center'});true");SystemClock.sleep(500);screenshot("release25-booking-card");click(scenario,"연결된 경비 보기");expect(scenario,"window.keyboardFixture.saved.at(-1)[0]==='expense-navigation'&&window.keyboardFixture.saved.at(-1)[1]==='e1'");
            show(scenario,"connected-expenses");expect(scenario,"document.querySelector('.expense-row .record-icon svg.lucide-plane')&&document.querySelector('.expense-booking-link').textContent==='예약'");click(scenario,"예약");expect(scenario,"window.keyboardFixture.saved.at(-1)[0]==='booking-navigation'");
            show(scenario,"tools-multi");expect(scenario,"[...document.querySelectorAll('.inverse-rate')].some(e=>e.textContent.includes('1 KRW')&&e.textContent.includes('NZD'))");
            show(scenario,"expense-multi-new");click(scenario,"경비에 연결할 예약");click(scenario,"ICN → AKL · KE411");expect(scenario,"document.querySelector('[data-validation-label=분류]').textContent.includes('항공')&&document.querySelector('.currency-inputs input').value==='1000'");click(scenario,"함께 나누기");click(scenario,"경비 저장");expect(scenario,"window.keyboardFixture.saved.at(-1)[0].bookingId==='flight'&&window.keyboardFixture.saved.at(-1)[0].category==='flight'");
            show(scenario,"toast");show(scenario,"expense-multi-new");input(scenario,"[data-validation-label='어디에 쓴 돈인가요?'] input","원화 결제");click(scenario,"실제로 결제한 통화");click(scenario,"KRW");expect(scenario,"document.querySelectorAll('.currency-inputs input').length===1&&!document.querySelector('.summary-button')");input(scenario,".currency-inputs input","5000");click(scenario,"함께 나누기");click(scenario,"경비 저장");expect(scenario,"(()=>{const d=window.keyboardFixture.saved.at(-1)[0];return d.paidCurrency==='KRW'&&d.tripCurrency==='KRW'&&d.tripAmount==='5000'&&d.baseAmount==='5000'})()");
            System.out.println("RELEASE25_RESERVATION_EXPENSE_PAYMENT_PASS");
        }
    }
    private static void sample(ActivityScenario<MainActivity> scenario) throws Exception {
        js(scenario,"(()=>{window.motionSamples=[];window.motionSampling=true;const tick=()=>{const e=window.motionTarget,r=e.getBoundingClientRect(),form=e.closest('form');window.motionSamples.push({vh:visualViewport.height,y:r.top,h:r.height,scroll:form?.scrollTop||0,caret:e.selectionEnd});if(window.motionSampling)requestAnimationFrame(tick)};requestAnimationFrame(tick);return true})()");
    }
    private static void assertMotion(ActivityScenario<MainActivity> scenario,String label,boolean closing) throws Exception {
        String encoded=js(scenario,"(()=>{window.motionSampling=false;const s=window.motionSamples;let reversals=0,direction=0,vhBacktrack=0;for(let i=1;i<s.length;i++){const delta=s[i].scroll-s[i-1].scroll;if(Math.abs(s[i].vh-s[i-1].vh)>1)direction=0;else if(Math.abs(delta)>1){const sign=Math.sign(delta);if(direction&&sign!==direction)reversals++;direction=sign;}const d=s[i].vh-s[i-1].vh;vhBacktrack=Math.max(vhBacktrack,"+(closing?"-d":"d")+");}const end=s.slice(-10),spread=k=>Math.max(...end.map(r=>r[k]))-Math.min(...end.map(r=>r[k]));return JSON.stringify({samples:s.length,reversals,vhBacktrack,tailY:spread('y'),tailHeight:spread('h'),tailScroll:spread('scroll'),caretPreserved:s.every(r=>r.caret===s[0].caret),trajectory:s.filter((r,i)=>!i||Math.abs(r.scroll-s[i-1].scroll)>1||Math.abs(r.vh-s[i-1].vh)>1).map(r=>[Math.round(r.vh),Math.round(r.y),Math.round(r.h),Math.round(r.scroll)])})})()");
        JSONObject m=new JSONObject(new org.json.JSONTokener(encoded).nextValue().toString());System.out.println("FORM_KEYBOARD_MOTION "+label+" "+m);
        assertTrue("Motion needs real frame samples",m.getInt("samples")>10);
        // Gboard may remove its 34px suggestion row while opening; native inset
        // monotonicity is checked separately with a fixed keyboard layout.
        assertTrue(label+" viewport reverses: "+m,m.getDouble("vhBacktrack")<=40);
        assertTrue(label+" scroll oscillates: "+m,m.getInt("reversals")<=(closing?0:1));
        assertTrue(label+" never settles: "+m,m.getDouble("tailY")<=1&&m.getDouble("tailHeight")<=1&&m.getDouble("tailScroll")<=1);
        assertTrue(label+" moves the caret",m.getBoolean("caretPreserved"));
    }
    @Test public void formKeyboardOpeningAndDismissalStayStable() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            loadFixture(scenario);
            for(String scene:new String[]{"booking-hotel","plan","memo"}){
                show(scenario,scene);
                js(scenario,"window.motionTarget=document.querySelector('dialog[open] textarea');window.motionTarget.setSelectionRange(window.motionTarget.value.length,window.motionTarget.value.length);true");
                double originalHeight=Double.parseDouble(js(scenario,"window.motionTarget.getBoundingClientRect().height"));
                sample(scenario);js(scenario,"window.motionTarget.focus();true");keyboard(scenario);SystemClock.sleep(800);assertMotion(scenario,scene+" opening",false);
                expect(scenario,"(()=>{const r=window.motionTarget.getBoundingClientRect(),f=document.querySelector('dialog[open] form>.primary,dialog[open] footer')?.getBoundingClientRect();return r.bottom<=Math.min(visualViewport.height-8,f?.top??Infinity)+2})()");
                sample(scenario);scenario.onActivity(a->((InputMethodManager)a.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(a.getBridge().getWebView().getWindowToken(),0));
                SystemClock.sleep(1200);assertMotion(scenario,scene+" closing",true);
                if(scene.equals("memo")){
                    double height=Double.parseDouble(js(scenario,"window.motionTarget.getBoundingClientRect().height"));
                    double gap=Double.parseDouble(js(scenario,"document.querySelector('dialog[open] form>.primary').getBoundingClientRect().top-window.motionTarget.getBoundingClientRect().bottom"));
                    System.out.println("MEMO_RESTORED original="+originalHeight+", restored="+height+", saveButtonGap="+gap);
                    assertTrue("Closing keyboard must restore full memo height",Math.abs(originalHeight-height)<=2);
                    assertTrue("Memo must extend to just above the save button",gap>=-1&&gap<=24);
                }
            }
        }
    }

}
