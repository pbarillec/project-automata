# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in E:\developSoftware\Android\SDK/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# AUT-073 keep rules for the release (minifyEnabled true, shrinkResources true) build. Each rule says WHY it exists.
# A violated rule shows up as a NoSuchMethodError / JNI "method not found" at runtime; tools/ci/release_checks.js verifies the bridge survives in R8's mapping.txt.

# 1. The JS side calls the bridge by NAME through JNI (jsb.reflection.callStaticMethod('com/cocos/game/AutomataPlatformBridge', '<method>', '<signature>')
#    in assets/scripts/platform/android/AndroidNativeBridge.ts). R8 cannot see these calls: the class name, every public static method name and its
#    signature must stay exactly as written (renaming/inlining/removal would make every ads / billing / consent call fail only in release).
-keep class com.cocos.game.AutomataPlatformBridge {
    public static <methods>;
}

# 2. The three controllers hold the static SDK state (AdMob rewarded ads, Play Billing client + purchase listeners, UMP consent) that the bridge and their
#    anonymous SDK callbacks share, and they dispatch results back to JS through JsbBridgeWrapper script events keyed by string names. Kept whole so a future
#    reflective/JNI access or event wiring cannot be shrunk away; the classes are small, so the size cost is negligible.
-keep class com.cocos.game.AutomataAdsController { *; }
-keep class com.cocos.game.AutomataBillingController { *; }
-keep class com.cocos.game.AutomataConsentController { *; }

# 3. The native C++ layer finds the Java<->JS bridge by class/method name over JNI (JsbBridge, JsbBridgeWrapper, JsbBridge$ICallback) and the
#    activity/engine classes by name as well; covered by 'com.cocos.**' below but pinned explicitly because release breakage would be silent until a Java -> JS event.
-keep class com.cocos.lib.JsbBridge { *; }
-keep class com.cocos.lib.JsbBridgeWrapper { *; }
-keep interface com.cocos.lib.JsbBridge$ICallback { *; }
-keep class com.cocos.game.AppActivity { *; }

# 4. Google Play Billing 9.1.0: the library talks to the Play Store through AIDL / protobuf-lite message classes and ships its own consumer rules; keep its
#    public API and the vending AIDL stubs explicitly so a stale or missing consumer rule can never strip the purchase flow.
-keep class com.android.billingclient.api.** { *; }
-keep class com.android.vending.billing.** { *; }
-dontwarn com.android.billingclient.**

# 5. AdMob (play-services-ads 25.4.0) and Google UMP (user-messaging-platform 4.0.0): the app calls their public API and they reflect over their own
#    internals; 'com.google.**' below already keeps public classes, these name the two SDKs we depend on so the intent survives if that broad rule is narrowed.
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.android.ump.** { *; }

# 6. Stack traces for Play Console / Android vitals: line numbers kept, source file name hidden. (AGP bundles mapping.txt into the AAB; Play de-obfuscates from it.)
-keepattributes SourceFile,LineNumberTable,Signature,InnerClasses,EnclosingMethod,*Annotation*
-renamesourcefileattribute SourceFile

# Proguard Cocos2d-x-lite for release

-keep class com.cocos.game.AutomataPlatformBridge {
    public static *;
}
-keep public class com.cocos.** { *; }
-dontwarn com.cocos.**

# Proguard Apache HTTP for release
-keep class org.apache.http.** { *; }
-dontwarn org.apache.http.**

# Proguard okhttp for release
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**

-keep class okio.** { *; }
-dontwarn okio.**

# Proguard Android Webivew for release. you can comment if you are not using a webview
-keep public class android.net.http.SslError
-keep public class android.webkit.WebViewClient

-keep public class com.google.** { *; }

-dontwarn android.webkit.WebView
-dontwarn android.net.http.SslError
-dontwarn android.webkit.WebViewClient

# This is generated automatically by the Android Gradle plugin.
-dontwarn android.hardware.BatteryState
-dontwarn android.hardware.lights.Light
-dontwarn android.hardware.lights.LightState$Builder
-dontwarn android.hardware.lights.LightState
-dontwarn android.hardware.lights.LightsManager$LightsSession
-dontwarn android.hardware.lights.LightsManager
-dontwarn android.hardware.lights.LightsRequest$Builder
-dontwarn android.hardware.lights.LightsRequest
-dontwarn android.net.ssl.SSLSockets
-dontwarn android.os.VibratorManager
