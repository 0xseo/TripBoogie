package com.tripboogie.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.ArrayList;
import java.util.List;
import android.view.View;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class KeyboardInsetsTest {
    private static String js(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>("");
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView JavaScript timed out", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }
    @Test public void keyboardResizesTheActualWebView() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            KeyboardTestHost.html(scenario,
                "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}textarea{position:fixed;bottom:20px;left:16px;width:300px;height:120px;font-size:16px}</style><textarea id='memo'>예약 메모 키보드 검증</textarea>");
            for (int i=0;i<40 && !js(scenario,"!!document.getElementById('memo')").equals("true");i++) SystemClock.sleep(100);
            int[] originalHeight={0};scenario.onActivity(a->originalHeight[0]=a.getBridge().getWebView().getHeight());
            js(scenario,"document.getElementById('memo').focus();true");
            KeyboardTestHost.keyboard(scenario);
            AtomicReference<String> bounds = new AtomicReference<>();
            boolean[] visible={false};
            for(int i=0;i<60;i++){
                scenario.onActivity(a -> {WebView w=a.getBridge().getWebView();WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(w);visible[0]=insets!=null&&insets.isVisible(WindowInsetsCompat.Type.ime());if(visible[0]){int[] p=new int[2];w.getLocationOnScreen(p);int top=a.getWindowManager().getCurrentWindowMetrics().getBounds().bottom-insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;bounds.set("webBottom="+(p[1]+w.getHeight())+", imeTop="+top);}});
                if(visible[0])break;SystemClock.sleep(150);
            }
            assertTrue("The software keyboard did not open",visible[0]);SystemClock.sleep(600);
            boolean[] clear={false};
            scenario.onActivity(a->{WebView w=a.getBridge().getWebView();WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(w);int[] p=new int[2];w.getLocationOnScreen(p);Rect window=a.getWindowManager().getCurrentWindowMetrics().getBounds();int top=window.bottom-insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;clear[0]=p[1]+w.getHeight()<=top+2;bounds.set("webBottom="+(p[1]+w.getHeight())+", imeTop="+top+", webHeight="+w.getHeight());});
            System.out.println("KEYBOARD_NATIVE_BOUNDS "+bounds.get()+", visualViewport="+js(scenario,"visualViewport.height"));
            assertTrue("The keyboard overlays the WebView: "+bounds.get(),clear[0]);
            js(scenario,"document.activeElement.blur();true");
            scenario.onActivity(a->((InputMethodManager)a.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(a.getBridge().getWebView().getWindowToken(),0));
            boolean[] restored={false};for(int i=0;i<40;i++){
                scenario.onActivity(a->{WebView w=a.getBridge().getWebView();WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(w);restored[0]=insets!=null&&!insets.isVisible(WindowInsetsCompat.Type.ime())&&Math.abs(w.getHeight()-originalHeight[0])<3;});
                if(restored[0])break;SystemClock.sleep(100);
            }
            assertTrue("Closing the keyboard must restore the full WebView height",restored[0]);
        }
    }
    @Test public void keyboardHeightMovesInOneDirectionWhileOpeningAndClosing() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            KeyboardTestHost.html(scenario,"<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><textarea id='memo' style='font-size:16px'>keyboard animation</textarea>");
            for(int i=0;i<40&&!js(scenario,"!!document.getElementById('memo')").equals("true");i++)SystemClock.sleep(100);
            List<Integer> opening=new ArrayList<>(),closing=new ArrayList<>(),openingIme=new ArrayList<>(),closingIme=new ArrayList<>();
            View.OnLayoutChangeListener openListener=(v,l,t,r,b,ol,ot,or,ob)->{opening.add(b-t);openingIme.add(ViewCompat.getRootWindowInsets(v).getInsets(WindowInsetsCompat.Type.ime()).bottom);};
            View.OnLayoutChangeListener closeListener=(v,l,t,r,b,ol,ot,or,ob)->{closing.add(b-t);closingIme.add(ViewCompat.getRootWindowInsets(v).getInsets(WindowInsetsCompat.Type.ime()).bottom);};
            scenario.onActivity(a->{WebView w=a.getBridge().getWebView();opening.add(w.getHeight());openingIme.add(ViewCompat.getRootWindowInsets(w).getInsets(WindowInsetsCompat.Type.ime()).bottom);w.addOnLayoutChangeListener(openListener);});
            js(scenario,"document.getElementById('memo').focus();true");
            KeyboardTestHost.keyboard(scenario);
            SystemClock.sleep(1200);
            scenario.onActivity(a->{WebView w=a.getBridge().getWebView();w.removeOnLayoutChangeListener(openListener);closing.add(w.getHeight());closingIme.add(ViewCompat.getRootWindowInsets(w).getInsets(WindowInsetsCompat.Type.ime()).bottom);w.addOnLayoutChangeListener(closeListener);((InputMethodManager)a.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(w.getWindowToken(),0);});
            SystemClock.sleep(1200);
            scenario.onActivity(a->a.getBridge().getWebView().removeOnLayoutChangeListener(closeListener));
            int openBacktrack=0,closeBacktrack=0;
            // Gboard may change its actual height by hiding its suggestion row.
            // Only a reversal beyond the simultaneous OS IME target change is
            // app-induced oscillation; a constant target retains the strict 3px check.
            for(int i=1;i<opening.size();i++)openBacktrack=Math.max(openBacktrack,opening.get(i)-opening.get(i-1)-Math.max(0,openingIme.get(i-1)-openingIme.get(i)));
            for(int i=1;i<closing.size();i++)closeBacktrack=Math.max(closeBacktrack,closing.get(i-1)-closing.get(i)-Math.max(0,closingIme.get(i)-closingIme.get(i-1)));
            System.out.println("KEYBOARD_MOTION opening="+opening+", openingIme="+openingIme+", closing="+closing+", closingIme="+closingIme+", openBacktrack="+openBacktrack+", closeBacktrack="+closeBacktrack);
            assertTrue("Keyboard must actually resize the WebView",opening.get(0)-opening.get(opening.size()-1)>100);
            assertTrue("Opening must not repeatedly expand the WebView: "+opening,openBacktrack<=3);
            assertTrue("Closing must not repeatedly collapse the WebView: "+closing,closeBacktrack<=3);
        }
    }

}
