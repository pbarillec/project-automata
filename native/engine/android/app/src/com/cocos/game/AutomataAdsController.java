package com.cocos.game;

import android.app.Activity;
import android.app.Application;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import com.cocos.lib.CocosHelper;
import com.cocos.lib.GlobalObject;
import com.cocos.lib.JsbBridgeWrapper;
import com.google.ads.mediation.admob.AdMobAdapter;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.OnUserEarnedRewardListener;
import com.google.android.gms.ads.initialization.InitializationStatus;
import com.google.android.gms.ads.initialization.OnInitializationCompleteListener;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * AUT-057 Android AdMob rewarded provider (package-private; reached only through AutomataPlatformBridge).
 *
 * Contract with the TypeScript AndroidAdsService:
 * - every Ads SDK call runs on the UI thread; the synchronous getters read volatile snapshots and never block;
 * - showRewarded is START-THEN-EVENT: it returns {"status":"started"} (or a terminal immediate failure) and the single final
 *   result JSON is dispatched later as the script event "automata.ads.rewarded_result" (emitted at dismissal, never at the reward moment);
 * - debuggable builds ALWAYS use Google's public sample IDs; non-debuggable builds read injected manifest meta-data and an
 *   empty / malformed / sample value means "not configured" (no SDK init, no crash). No production ID is ever committed.
 */
final class AutomataAdsController {
    static final String EVENT_REWARDED_RESULT = "automata.ads.rewarded_result";
    static final String EVENT_OVERLAY = "automata.platform.overlay";

    static final String PLACEMENT_OFFLINE_DOUBLE = "rewarded.offline_double";
    static final String PLACEMENT_EXTENDED_OVERCLOCK = "rewarded.extended_overclock";

    // Google's public sample IDs (https://developers.google.com/admob/android/test-ads). Never production values.
    private static final String SAMPLE_APP_ID = "ca-app-pub-3940256099942544~3347511713";
    private static final String SAMPLE_REWARDED_UNIT_ID = "ca-app-pub-3940256099942544/5224354917";
    private static final String SAMPLE_PUBLISHER = "3940256099942544";

    private static final String META_APP_ID = "com.google.android.gms.ads.APPLICATION_ID";
    private static final String META_UNIT_OFFLINE_DOUBLE = "com.projectautomata.ads.unit.offline_double";
    private static final String META_UNIT_EXTENDED_OVERCLOCK = "com.projectautomata.ads.unit.extended_overclock";

    private static final Pattern APP_ID_PATTERN = Pattern.compile("^ca-app-pub-\\d{16}~\\d{10}$");
    private static final Pattern UNIT_ID_PATTERN = Pattern.compile("^ca-app-pub-\\d{16}/\\d{10}$");

    private static final long STALE_AFTER_MS = 50L * 60L * 1000L;
    private static final long SHOW_START_WATCHDOG_MS = 8000L;
    private static final long RETRY_BASE_MS = 15000L;
    private static final long RETRY_CAP_MS = 5L * 60L * 1000L;
    private static final int USED_REQUEST_ID_LIMIT = 64;

    private static final int LOADING = 1;
    private static final int READY = 2;
    private static final int FAILED = 3;
    private static final int SHOWING = 4;
    private static final int IDLE = 0;

    private static final Object LOCK = new Object();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static volatile boolean configResolved = false;
    private static volatile boolean configured = false;
    private static volatile String configReason = "not_initialized";
    private static volatile String offlineUnitId = "";
    private static volatile String extendedUnitId = "";

    private static volatile String sdkStatus = "uninitialized"; // uninitialized | initializing | ready | failed | unavailable
    private static volatile String sdkReason = "";
    private static volatile boolean lifecycleRegistered = false;
    private static volatile boolean foreground = true;
    private static volatile boolean showInProgress = false;

    private static final Placement OFFLINE_DOUBLE = new Placement(PLACEMENT_OFFLINE_DOUBLE);
    private static final Placement EXTENDED_OVERCLOCK = new Placement(PLACEMENT_EXTENDED_OVERCLOCK);

    private static final Map<String, Boolean> USED_REQUEST_IDS = new LinkedHashMap<String, Boolean>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
            return size() > USED_REQUEST_ID_LIMIT;
        }
    };

    private AutomataAdsController() {
    }

    private static final class Placement {
        final String id;
        volatile int state = IDLE;
        volatile String reason = "";
        volatile long loadedAtMs = 0L;
        // Touched on the UI thread only.
        RewardedAd ad = null;
        int failures = 0;
        boolean retryPending = false;

        Placement(String id) {
            this.id = id;
        }

        String unitId() {
            return PLACEMENT_OFFLINE_DOUBLE.equals(id) ? offlineUnitId : extendedUnitId;
        }

        boolean isStale() {
            return state == READY && SystemClock.elapsedRealtime() - loadedAtMs > STALE_AFTER_MS;
        }
    }

    private static final class ShowRequest {
        final Placement placement;
        final String requestId;
        final AtomicBoolean completed = new AtomicBoolean(false);
        volatile boolean earned = false;
        volatile boolean showed = false;
        volatile boolean overlayBegun = false;
        Runnable watchdog = null;

        ShowRequest(Placement placement, String requestId) {
            this.placement = placement;
            this.requestId = requestId;
        }
    }

    // ---------------------------------------------------------------- public surface (called from the bridge)

    static String initialize() {
        synchronized (LOCK) {
            resolveConfigLocked();
            if (!configured) {
                sdkStatus = "unavailable";
                sdkReason = configReason;
                return statusJson();
            }
            if ("initializing".equals(sdkStatus) || "ready".equals(sdkStatus)) {
                return statusJson();
            }
            sdkStatus = "initializing";
            sdkReason = "";
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                startSdk();
            }
        });
        return statusJson();
    }

    static String status() {
        synchronized (LOCK) {
            resolveConfigLocked();
            if (!configured && "uninitialized".equals(sdkStatus)) {
                return statusJson("unavailable", configReason);
            }
            return statusJson();
        }
    }

    static String availability(String placementId) {
        Placement placement = placementFor(placementId);
        if (placement == null) {
            return availabilityJson(false, "unavailable", placementId, "unknown_placement");
        }
        String reason = unavailableReason(placement);
        if (reason == null) {
            return availabilityJson(true, "ready", placementId, null);
        }
        return availabilityJson(false, "unavailable", placementId, reason);
    }

    static String preload(String placementId) {
        final Placement placement = placementFor(placementId);
        if (placement == null) {
            return operationJson(false, "unavailable", "unknown_placement");
        }
        synchronized (LOCK) {
            resolveConfigLocked();
            if (!configured) {
                return operationJson(false, "unavailable", configReason);
            }
            if (!"ready".equals(sdkStatus)) {
                return operationJson(false, "initializing".equals(sdkStatus) ? "initializing" : "unavailable", "not_initialized");
            }
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                loadPlacement(placement);
            }
        });
        return operationJson(true, "ready", null);
    }

    static String show(String requestJson) {
        final String placementId = extractJsonString(requestJson, "placementId");
        final String requestId = extractJsonString(requestJson, "requestId");
        final Placement placement = placementFor(placementId);
        if (placement == null) {
            return terminalJson("unavailable", placementId, requestId, "unknown_placement", null);
        }
        if (requestId.isEmpty()) {
            return terminalJson("failed", placementId, requestId, "invalid_request_id", null);
        }
        final ShowRequest request = new ShowRequest(placement, requestId);
        final Activity activity;
        synchronized (LOCK) {
            resolveConfigLocked();
            if (!configured) {
                return terminalJson("unavailable", placementId, requestId, configReason, null);
            }
            if (USED_REQUEST_IDS.containsKey(requestId)) {
                return terminalJson("failed", placementId, requestId, "duplicate_request_id", null);
            }
            if (showInProgress) {
                return terminalJson("unavailable", placementId, requestId, "show_in_progress", null);
            }
            String reason = unavailableReason(placement);
            if (reason != null) {
                return terminalJson("unavailable", placementId, requestId, reason, null);
            }
            activity = GlobalObject.getActivity();
            if (activity == null) {
                return terminalJson("unavailable", placementId, requestId, "no_activity", null);
            }
            USED_REQUEST_IDS.put(requestId, Boolean.TRUE);
            showInProgress = true;
            placement.state = SHOWING;
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                startShow(activity, request);
            }
        });
        return "{\"status\":\"started\",\"placementId\":\"" + escape(placementId) + "\",\"requestId\":\"" + escape(requestId) + "\"}";
    }

    // ---------------------------------------------------------------- configuration

    private static boolean isDebuggable(Activity activity) {
        try {
            return (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        } catch (Throwable t) {
            return false;
        }
    }

    private static void resolveConfigLocked() {
        if (configResolved) {
            return;
        }
        Activity activity = GlobalObject.getActivity();
        if (activity == null) {
            configReason = "not_initialized";
            return; // try again later; not cached
        }
        configResolved = true;
        if (isDebuggable(activity)) {
            // Debuggable builds ignore any injected value: sample IDs only.
            offlineUnitId = SAMPLE_REWARDED_UNIT_ID;
            extendedUnitId = SAMPLE_REWARDED_UNIT_ID;
            configured = true;
            configReason = "";
            return;
        }
        String appId = "";
        String offline = "";
        String extended = "";
        try {
            ApplicationInfo info = activity.getPackageManager().getApplicationInfo(activity.getPackageName(), PackageManager.GET_META_DATA);
            Bundle meta = info.metaData;
            if (meta != null) {
                appId = metaString(meta, META_APP_ID);
                offline = metaString(meta, META_UNIT_OFFLINE_DOUBLE);
                extended = metaString(meta, META_UNIT_EXTENDED_OVERCLOCK);
            }
        } catch (Throwable t) {
            // fall through: not configured
        }
        if (APP_ID_PATTERN.matcher(appId).matches() && UNIT_ID_PATTERN.matcher(offline).matches()
            && UNIT_ID_PATTERN.matcher(extended).matches()
            && !appId.contains(SAMPLE_PUBLISHER) && !offline.contains(SAMPLE_PUBLISHER) && !extended.contains(SAMPLE_PUBLISHER)) {
            offlineUnitId = offline;
            extendedUnitId = extended;
            configured = true;
            configReason = "";
        } else {
            configured = false;
            configReason = "ads_not_configured";
        }
    }

    private static String metaString(Bundle meta, String key) {
        Object value = meta.get(key);
        return value instanceof String ? ((String) value).trim() : "";
    }

    /** Single consent hook; AUT-065 wires the UMP flow here. Until then ads may be requested (non-personalized only). */
    private static boolean canRequestAds() {
        return true;
    }

    // ---------------------------------------------------------------- SDK init / load (UI thread)

    private static void startSdk() {
        final Activity activity = GlobalObject.getActivity();
        if (activity == null) {
            failSdk("no_activity");
            return;
        }
        try {
            registerLifecycle(activity);
            MobileAds.initialize(activity, new OnInitializationCompleteListener() {
                @Override
                public void onInitializationComplete(InitializationStatus initializationStatus) {
                    MAIN.post(new Runnable() {
                        @Override
                        public void run() {
                            sdkStatus = "ready";
                            sdkReason = "";
                            loadPlacement(OFFLINE_DOUBLE);
                            loadPlacement(EXTENDED_OVERCLOCK);
                        }
                    });
                }
            });
        } catch (Throwable t) {
            failSdk("init_exception");
        }
    }

    private static void failSdk(String reason) {
        sdkStatus = "failed";
        sdkReason = reason;
    }

    private static void registerLifecycle(Activity activity) {
        if (lifecycleRegistered) {
            return;
        }
        lifecycleRegistered = true;
        Application application = activity.getApplication();
        if (application == null) {
            return;
        }
        application.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override
            public void onActivityResumed(Activity resumed) {
                if (resumed == GlobalObject.getActivity()) {
                    foreground = true;
                    resumeRetries();
                }
            }

            @Override
            public void onActivityPaused(Activity paused) {
                if (paused == GlobalObject.getActivity()) {
                    foreground = false;
                }
            }

            @Override
            public void onActivityCreated(Activity a, Bundle b) {
            }

            @Override
            public void onActivityStarted(Activity a) {
            }

            @Override
            public void onActivityStopped(Activity a) {
            }

            @Override
            public void onActivitySaveInstanceState(Activity a, Bundle b) {
            }

            @Override
            public void onActivityDestroyed(Activity a) {
            }
        });
    }

    private static void resumeRetries() {
        if (!"ready".equals(sdkStatus)) {
            return;
        }
        for (Placement placement : new Placement[] {OFFLINE_DOUBLE, EXTENDED_OVERCLOCK}) {
            if (placement.state == FAILED && !placement.retryPending) {
                scheduleRetry(placement);
            }
        }
    }

    private static void loadPlacement(final Placement placement) {
        if (!"ready".equals(sdkStatus) || !configured) {
            return;
        }
        if (placement.state == LOADING || placement.state == SHOWING) {
            return;
        }
        if (placement.state == READY) {
            if (!placement.isStale()) {
                return;
            }
            placement.ad = null; // stale: drop and reload
        }
        if (!canRequestAds()) {
            placement.state = IDLE;
            placement.reason = "consent_pending";
            return;
        }
        final Activity activity = GlobalObject.getActivity();
        if (activity == null) {
            return;
        }
        placement.state = LOADING;
        placement.reason = "loading";
        try {
            Bundle extras = new Bundle();
            extras.putString("npa", "1"); // non-personalized ads only until AUT-065
            AdRequest request = new AdRequest.Builder().addNetworkExtrasBundle(AdMobAdapter.class, extras).build();
            RewardedAd.load(activity, placement.unitId(), request, new RewardedAdLoadCallback() {
                @Override
                public void onAdLoaded(RewardedAd loaded) {
                    placement.ad = loaded;
                    placement.failures = 0;
                    placement.loadedAtMs = SystemClock.elapsedRealtime();
                    placement.reason = "";
                    placement.state = READY;
                }

                @Override
                public void onAdFailedToLoad(LoadAdError error) {
                    onLoadFailed(placement, error == null ? -1 : error.getCode());
                }
            });
        } catch (Throwable t) {
            onLoadFailed(placement, -1);
        }
    }

    private static void onLoadFailed(Placement placement, int code) {
        placement.ad = null;
        placement.state = FAILED;
        placement.reason = code == 3 ? "no_fill" : (code == 2 ? "network" : "load_error_" + code);
        scheduleRetry(placement);
    }

    private static void scheduleRetry(final Placement placement) {
        if (placement.retryPending) {
            return;
        }
        placement.retryPending = true;
        long delay = RETRY_BASE_MS;
        for (int i = 0; i < placement.failures && delay < RETRY_CAP_MS; i += 1) {
            delay *= 2;
        }
        if (delay > RETRY_CAP_MS) {
            delay = RETRY_CAP_MS;
        }
        placement.failures += 1;
        MAIN.postDelayed(new Runnable() {
            @Override
            public void run() {
                placement.retryPending = false;
                if (!foreground) {
                    return; // resumeRetries() restarts it when the activity returns
                }
                if (placement.state == FAILED) {
                    placement.state = IDLE;
                    loadPlacement(placement);
                }
            }
        }, delay);
    }

    // ---------------------------------------------------------------- show state machine (UI thread)

    private static void startShow(final Activity activity, final ShowRequest request) {
        final Placement placement = request.placement;
        final RewardedAd ad = placement.ad;
        placement.ad = null; // consumed immediately: one RewardedAd is one show
        if (ad == null) {
            finishShow(request, "failed", "ad_missing", null);
            return;
        }
        request.watchdog = new Runnable() {
            @Override
            public void run() {
                if (!request.showed) {
                    finishShow(request, "timeout", "show_timeout", null);
                }
            }
        };
        MAIN.postDelayed(request.watchdog, SHOW_START_WATCHDOG_MS);
        try {
            ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                @Override
                public void onAdShowedFullScreenContent() {
                    request.showed = true; // no timeout once showing
                }

                @Override
                public void onAdFailedToShowFullScreenContent(AdError error) {
                    finishShow(request, "failed", "show_error_" + (error == null ? -1 : error.getCode()), error == null ? null : error.getMessage());
                }

                @Override
                public void onAdDismissedFullScreenContent() {
                    if (request.earned) {
                        finishShow(request, "rewarded", null, null);
                    } else {
                        finishShow(request, "closed", null, null);
                    }
                }
            });
            dispatchOverlay("begin", request);
            request.overlayBegun = true;
            ad.show(activity, new OnUserEarnedRewardListener() {
                @Override
                public void onUserEarnedReward(RewardItem rewardItem) {
                    request.earned = true; // never emits; the single result is sent at dismissal
                }
            });
        } catch (Throwable t) {
            finishShow(request, "failed", "show_exception", null);
        }
    }

    /** The ONLY place a final result is emitted; completed.compareAndSet guarantees exactly one emission per request. */
    private static void finishShow(ShowRequest request, String status, String reason, String message) {
        if (!request.completed.compareAndSet(false, true)) {
            return;
        }
        if (request.watchdog != null) {
            MAIN.removeCallbacks(request.watchdog);
        }
        boolean verified = "rewarded".equals(status) && request.earned;
        if (request.overlayBegun) {
            dispatchOverlay("end", request);
        }
        dispatch(EVENT_REWARDED_RESULT, terminalJson(status, request.placement.id, request.requestId, reason, message, verified));
        synchronized (LOCK) {
            showInProgress = false;
        }
        request.placement.state = IDLE;
        request.placement.reason = "";
        loadPlacement(request.placement); // preload the next ad
    }

    // ---------------------------------------------------------------- helpers

    private static Placement placementFor(String placementId) {
        if (PLACEMENT_OFFLINE_DOUBLE.equals(placementId)) {
            return OFFLINE_DOUBLE;
        }
        if (PLACEMENT_EXTENDED_OVERCLOCK.equals(placementId)) {
            return EXTENDED_OVERCLOCK;
        }
        return null;
    }

    /** Null when the placement can be shown now; otherwise the reason it cannot. Pure snapshot read. */
    private static String unavailableReason(Placement placement) {
        synchronized (LOCK) {
            resolveConfigLocked();
        }
        if (!configured) {
            return configReason;
        }
        if (!"ready".equals(sdkStatus)) {
            return "not_initialized";
        }
        if (showInProgress) {
            return "show_in_progress";
        }
        int state = placement.state;
        if (state == READY) {
            if (placement.isStale()) {
                final Placement stale = placement;
                runOnUi(new Runnable() {
                    @Override
                    public void run() {
                        loadPlacement(stale);
                    }
                });
                return "loading";
            }
            return null;
        }
        if (state == FAILED) {
            String reason = placement.reason;
            return reason == null || reason.isEmpty() ? "no_fill" : reason;
        }
        if (state == SHOWING) {
            return "show_in_progress";
        }
        return "loading";
    }

    private static void runOnUi(Runnable action) {
        try {
            GlobalObject.runOnUiThread(action);
        } catch (Throwable t) {
            MAIN.post(action);
        }
    }

    private static void dispatchOverlay(String phase, ShowRequest request) {
        dispatch(EVENT_OVERLAY, "{\"phase\":\"" + phase + "\",\"kind\":\"rewarded_ad\",\"requestId\":\"" + escape(request.requestId) + "\"}");
    }

    private static void dispatch(final String event, final String json) {
        try {
            CocosHelper.runOnGameThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JsbBridgeWrapper.getInstance().dispatchEventToScript(event, json);
                    } catch (Throwable t) {
                        // a failed dispatch never crashes the game; the JS backstop resolves the request
                    }
                }
            });
        } catch (Throwable t) {
            // ignore
        }
    }

    private static String statusJson() {
        return statusJson(sdkStatus, sdkReason);
    }

    private static String statusJson(String status, String reason) {
        StringBuilder builder = new StringBuilder("{\"ok\":");
        builder.append("ready".equals(status) || "initializing".equals(status) ? "true" : "false");
        builder.append(",\"status\":\"").append(escape(status)).append('"');
        if (reason != null && !reason.isEmpty()) {
            builder.append(",\"reason\":\"").append(escape(reason)).append('"');
        }
        return builder.append('}').toString();
    }

    private static String operationJson(boolean ok, String status, String reason) {
        StringBuilder builder = new StringBuilder("{\"ok\":").append(ok ? "true" : "false");
        builder.append(",\"status\":\"").append(escape(status)).append('"');
        if (reason != null && !reason.isEmpty()) {
            builder.append(",\"reason\":\"").append(escape(reason)).append('"');
        }
        return builder.append('}').toString();
    }

    private static String availabilityJson(boolean available, String status, String placementId, String reason) {
        StringBuilder builder = new StringBuilder("{\"available\":").append(available ? "true" : "false");
        builder.append(",\"status\":\"").append(escape(status)).append('"');
        builder.append(",\"placementId\":\"").append(escape(placementId)).append('"');
        if (reason != null && !reason.isEmpty()) {
            builder.append(",\"reason\":\"").append(escape(reason)).append('"');
        }
        return builder.append('}').toString();
    }

    private static String terminalJson(String status, String placementId, String requestId, String reason, String message) {
        return terminalJson(status, placementId, requestId, reason, message, false);
    }

    private static String terminalJson(String status, String placementId, String requestId, String reason, String message, boolean rewardVerified) {
        StringBuilder builder = new StringBuilder("{\"status\":\"").append(escape(status)).append('"');
        builder.append(",\"placementId\":\"").append(escape(placementId)).append('"');
        builder.append(",\"requestId\":\"").append(escape(requestId)).append('"');
        builder.append(",\"rewardVerified\":").append(rewardVerified ? "true" : "false");
        if (reason != null && !reason.isEmpty()) {
            builder.append(",\"reason\":\"").append(escape(reason)).append('"');
        }
        if (message != null && !message.isEmpty()) {
            builder.append(",\"message\":\"").append(escape(message)).append('"');
        }
        return builder.append('}').toString();
    }

    private static String extractJsonString(String json, String key) {
        return AutomataPlatformBridge.extractJsonStringValue(json, key);
    }

    private static String escape(String value) {
        return AutomataPlatformBridge.escapeJson(value);
    }
}
