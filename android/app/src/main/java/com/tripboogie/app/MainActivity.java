package com.tripboogie.app;

import com.getcapacitor.BridgeActivity;
import androidx.core.splashscreen.SplashScreen;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle state) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(TripBoogieAuthPlugin.class);
        super.onCreate(state);
        KeyboardInsets.attach(this, getBridge().getWebView());
    }
}
