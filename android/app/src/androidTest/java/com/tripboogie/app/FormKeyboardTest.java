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
                if(!type.equals("flight"))expect(scenario,"document.querySelector('.booking-add-plan input').checked===false");
                if(!type.equals("flight"))click(scenario,"다음");
                count+=audit(scenario,type+" booking payment");click(scenario,"예약 저장");
                expect(scenario,"window.keyboardFixture.saved.at(-1)?.[4]===false");
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
