package com.tripboogie.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
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
    private static void keyboard(ActivityScenario<MainActivity> scenario) throws Exception {
        scenario.onActivity(a->{WebView w=a.getBridge().getWebView();w.requestFocus();((InputMethodManager)a.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(w,InputMethodManager.SHOW_IMPLICIT);});
        boolean[] visible={false};for(int i=0;i<40;i++){scenario.onActivity(a->{WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(a.getBridge().getWebView());visible[0]=insets!=null&&insets.isVisible(WindowInsetsCompat.Type.ime());});if(visible[0])break;SystemClock.sleep(100);}assertTrue("OS keyboard must open",visible[0]);SystemClock.sleep(400);
    }
    private static final String FIELDS="[...document.querySelectorAll('dialog[open] input,dialog[open] textarea,main input')].filter(e=>!e.disabled&&!e.readOnly&&!['checkbox','radio','file','hidden','button','submit'].includes(e.type)&&e.getClientRects().length)";
    private static int audit(ActivityScenario<MainActivity> scenario,String label) throws Exception {
        int count=Integer.parseInt(js(scenario,FIELDS+".length"));assertTrue("No editable field in "+label,count>0);
        for(int index=0;index<count;index++){
            js(scenario,"(()=>{const e="+FIELDS+"["+index+"];e.focus();if(e.tagName==='TEXTAREA')e.setSelectionRange(e.value.length,e.value.length);e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
            keyboard(scenario);
            String bounds=js(scenario,"(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),d=e.closest('dialog'),v=visualViewport;let top=v.offsetTop+8,bottom=v.offsetTop+v.height-8;const h=d?.querySelector('header');if(h)top=Math.max(top,h.getBoundingClientRect().bottom);for(const f of d?.querySelectorAll('footer,form>.primary:last-child')||[]){const b=f.getBoundingClientRect();if(/sticky|fixed/.test(getComputedStyle(f).position)&&b.top>top)bottom=Math.min(bottom,b.top);}return JSON.stringify({label:e.getAttribute('aria-label')||e.placeholder||e.tagName,top:r.top,bottom:r.bottom,limitTop:top,limitBottom:bottom,clear:r.top>=top-2&&r.bottom<=bottom+2,scrollTop:e.scrollTop})})()");
            JSONObject result=new JSONObject(new org.json.JSONTokener(bounds).nextValue().toString());
            System.out.println("FORM_KEYBOARD "+label+" #"+index+" "+result);
            assertTrue(label+" input hidden: "+result,result.getBoolean("clear"));
        }
        return count;
    }
    @Test public void allFormInputsClearKeyboardAndStickyActions() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getContext();
        String script=new String(context.getAssets().open("fixture.js").readAllBytes(),StandardCharsets.UTF_8);
        String css=new String(context.getAssets().open("fixture.css").readAllBytes(),StandardCharsets.UTF_8);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            expect(scenario,"document.readyState==='complete'&&!!document.getElementById('root')");
            scenario.onActivity(a->{
                WebView web=a.getBridge().getWebView();web.stopLoading();
                web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage message){System.out.println("FIXTURE_CONSOLE "+message.message().substring(0,Math.min(700,message.message().length())));return true;}});
                web.loadDataWithBaseURL("https://localhost/","<!doctype html><html class='native-app'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>"+css+"</style><body><div id='root'></div><div id='fixture-loaded'></div></body></html>","text/html","UTF-8",null);
            });
            expect(scenario,"document.readyState==='complete'&&!!document.getElementById('fixture-loaded')");
            js(scenario,script);
            expect(scenario,"!!window.keyboardFixture?.ready");
            expect(scenario,"(()=>{const t=document.querySelector('body>.toast')?.getBoundingClientRect(),n=document.querySelector('.mobile-trip-nav')?.getBoundingClientRect();return !!t&&!!n&&t.bottom<n.top})()");
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
}
