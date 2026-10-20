package com.tripboogie.app;

import static org.junit.Assert.*;
import android.app.KeyguardManager;
import android.content.Context;
import android.os.SystemClock;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import android.webkit.WebView;
import com.getcapacitor.BridgeWebViewClient;
import androidx.test.core.app.ActivityScenario;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Keep the test window interactive and wait for each real page navigation. */
@android.annotation.TargetApi(30)
final class KeyboardTestHost {
    static void ready(ActivityScenario<MainActivity> scenario) {
        scenario.onActivity(a->{
            a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            a.setShowWhenLocked(true);a.setTurnScreenOn(true);
            ((KeyguardManager)a.getSystemService(Context.KEYGUARD_SERVICE)).requestDismissKeyguard(a,null);
        });
        boolean[] loaded={false};
        for(int i=0;i<100&&!loaded[0];i++){
            scenario.onActivity(a->{WebView web=a.getBridge().getWebView();loaded[0]=a.hasWindowFocus()&&web.getProgress()==100&&web.getUrl()!=null&&web.getUrl().startsWith("https://localhost");});
            if(!loaded[0])SystemClock.sleep(100);
        }
        assertTrue("App window must be focused and its first navigation complete",loaded[0]);
    }
    static void keyboard(ActivityScenario<MainActivity> scenario) {
        boolean[] visible={false};
        for(int i=0;i<60;i++){
            scenario.onActivity(a->{WebView w=a.getBridge().getWebView();w.requestFocus();InputMethodManager ime=(InputMethodManager)a.getSystemService(Context.INPUT_METHOD_SERVICE);
                // Chromium establishes its input connection after DOM focus.
                // Retry once it serves this view instead of losing the one show request.
                if(ime.isActive(w))ime.showSoftInput(w,InputMethodManager.SHOW_IMPLICIT);
                WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(w);visible[0]=insets!=null&&insets.isVisible(WindowInsetsCompat.Type.ime());
            });
            if(visible[0])break;SystemClock.sleep(100);
        }
        assertTrue("OS keyboard must open",visible[0]);SystemClock.sleep(400);
    }
    static void html(ActivityScenario<MainActivity> scenario,String source) throws Exception {
        ready(scenario);CountDownLatch loaded=new CountDownLatch(1);
        scenario.onActivity(a->{WebView web=a.getBridge().getWebView();
            web.setWebViewClient(new BridgeWebViewClient(a.getBridge()){
                @Override public void onPageFinished(WebView view,String url){super.onPageFinished(view,url);loaded.countDown();}
            });
            web.loadDataWithBaseURL("https://localhost/",source,"text/html","UTF-8",null);
        });
        assertTrue("Test document did not finish loading",loaded.await(30,TimeUnit.SECONDS));
    }
}
