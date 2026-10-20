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
            scenario.onActivity(a -> a.getBridge().getWebView().loadDataWithBaseURL("https://localhost/",
                "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}textarea{position:fixed;bottom:20px;left:16px;width:300px;height:120px;font-size:16px}</style><textarea id='memo'>예약 메모 키보드 검증</textarea>","text/html","UTF-8",null));
            for (int i=0;i<40 && !js(scenario,"!!document.getElementById('memo')").equals("true");i++) SystemClock.sleep(100);
            int[] originalHeight={0};scenario.onActivity(a->originalHeight[0]=a.getBridge().getWebView().getHeight());
            js(scenario,"document.getElementById('memo').focus();true");
            scenario.onActivity(a -> {WebView w=a.getBridge().getWebView();w.requestFocus();((InputMethodManager)a.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(w,InputMethodManager.SHOW_IMPLICIT);});
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
}
