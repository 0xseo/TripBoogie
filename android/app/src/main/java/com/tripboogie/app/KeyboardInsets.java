package com.tripboogie.app;

import android.app.Activity;
import android.graphics.Rect;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Own the WebView's obscured area on Android's enforced edge-to-edge windows. */
final class KeyboardInsets {
    private KeyboardInsets() {}
    static void attach(Activity activity, WebView webView) {
        // Older windows already resize through adjustResize. Capacitor's auto
        // edge-to-edge handler only owns margins starting with Android 15.
        if (Build.VERSION.SDK_INT >= 35)
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> apply(activity, view, insets));
        // onApply receives the final IME bounds before its animation starts.
        // Resizing again from onProgress would alternate final/intermediate
        // layouts and make the WebView (and DOM scroll position) bounce.
        Set<WindowInsetsAnimationCompat> running = new HashSet<>();
        ViewCompat.setWindowInsetsAnimationCallback(webView, new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            private void notifyMotion(boolean active) {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
                boolean visible = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('tripboogie:keyboard-motion',{detail:{running:" + active + ",visible:" + visible + "}}))", null);
            }
            @Override public void onPrepare(WindowInsetsAnimationCompat animation) {
                if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) { running.add(animation);notifyMotion(true); }
            }
            @Override public WindowInsetsCompat onProgress(WindowInsetsCompat insets, List<WindowInsetsAnimationCompat> animations) {
                // Observe animation lifetime without relaying out the WebView.
                return Build.VERSION.SDK_INT >= 35 ? handled(insets) : insets;
            }
            @Override public void onEnd(WindowInsetsAnimationCompat animation) {
                if (running.remove(animation) && running.isEmpty()) notifyMotion(false);
            }
        });
        ViewCompat.requestApplyInsets(webView);
    }
    private static WindowInsetsCompat apply(Activity activity, View view, WindowInsetsCompat insets) {
        if (Build.VERSION.SDK_INT < 35 || !(view.getParent() instanceof View)) return insets;
        View parent = (View) view.getParent();
        int[] location = new int[2];parent.getLocationOnScreen(location);
        Rect window = activity.getWindowManager().getCurrentWindowMetrics().getBounds();
        int bars = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
        Insets safe = insets.getInsets(bars);
        int visibleBottom = window.bottom - (insets.isVisible(WindowInsetsCompat.Type.ime())
            ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : safe.bottom);
        ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
        int left = Math.max(0, window.left + safe.left - location[0]);
        int right = Math.max(0, location[0] + parent.getWidth() - (window.right - safe.right));
        int top = Math.max(0, window.top + safe.top - location[1]);
        int bottom = Math.max(0, location[1] + parent.getHeight() - visibleBottom);
        if (margins.leftMargin != left || margins.topMargin != top || margins.rightMargin != right || margins.bottomMargin != bottom) {
            margins.setMargins(left, top, right, bottom);view.setLayoutParams(margins);
        }
        // These areas are handled by native margins. Zero them explicitly so
        // newer WebViews don't apply the same keyboard/system-bar space twice.
        return handled(insets);
    }
    private static WindowInsetsCompat handled(WindowInsetsCompat insets) {
        return new WindowInsetsCompat.Builder(insets).setInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime(), Insets.NONE).build();
    }
}
