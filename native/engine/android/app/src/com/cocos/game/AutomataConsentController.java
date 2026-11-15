package com.cocos.game;

import android.app.Activity;
import android.app.Application;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.cocos.lib.CocosHelper;
import com.cocos.lib.GlobalObject;
import com.cocos.lib.JsbBridgeWrapper;
import com.google.android.ump.ConsentDebugSettings;
import com.google.android.ump.ConsentForm;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.FormError;
import com.google.android.ump.UserMessagingPlatform;

/**
 * AUT-065 Google User Messaging Platform (UMP) consent controller (package-private; reached only through AutomataPlatformBridge).
 *
 * Contract with the TypeScript ConsentCoordinator:
 * - every UMP call runs on the UI thread; the synchronous getters read volatile snapshots and never block;
 * - initialize / showPrivacyOptions are START-THEN-EVENT: they return a snapshot / {"status":"started"} at once and the slow results arrive as the script
 *   events "automata.consent.state" (state snapshot, incl. formVisible) and "automata.consent.privacy_result", hopped onto the game thread;
 * - the form is shown only AFTER the script was told (state event with formVisible:true was dispatched), so the script can bracket the activity pause the
 *   form causes as a platform overlay (never an offline absence / suspend / report). loadConsentForm + show is used instead of
 *   loadAndShowConsentFormIfRequired precisely because the latter gives no "about to show" moment;
 * - fail-open for gameplay, fail-closed for ads: canRequestAds() is false until UMP says true (or the previous session's stored consent allows it when the
 *   update fails); AutomataAdsController consults it before any SDK init / ad load;
 * - the debug geography / force-testing settings are honoured ONLY when the app is debuggable (ApplicationInfo.FLAG_DEBUGGABLE); a release build ignores them;
 * - nothing here needs a production AdMob app id: when ads are not configured (release without injected ids) consent is "unavailable" and UMP is never started.
 *
 * MVP decision: ads stay non-personalized (npa=1, see AutomataAdsController) whatever the consent status; consent only decides whether ads may be requested.
 */
final class AutomataConsentController {
    static final String EVENT_STATE = "automata.consent.state";
    static final String EVENT_PRIVACY_RESULT = "automata.consent.privacy_result";

    /** The consent info update gets this long natively before the state becomes "error" (a late success still applies). */
    private static final long UPDATE_WATCHDOG_MS = 15000L;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static volatile String status = "unknown"; // unknown | not_required | required | obtained | unavailable | error
    private static volatile String reason = "";
    private static volatile boolean canRequest = false;
    private static volatile boolean privacyOptionsRequired = false;
    private static volatile boolean formVisible = false;
    private static volatile boolean settled = false;

    private static volatile boolean started = false;
    private static volatile boolean privacyInProgress = false;
    private static volatile boolean foreground = true;
    private static volatile boolean lifecycleRegistered = false;

    // UI thread only.
    private static ConsentInformation info = null;
    private static Runnable updateWatchdog = null;
    private static boolean updateAnswered = false;
    private static ConsentForm pendingForm = null;

    private AutomataConsentController() {
    }

    // ---------------------------------------------------------------- public surface (called from the bridge)

    /** Starts the consent flow once. optionsJson may carry {"debugGeography":"eea|not_eea|us_state"}, honoured ONLY in debuggable builds. */
    static String initialize(String optionsJson) {
        final String geography = AutomataPlatformBridge.extractJsonStringValue(optionsJson, "debugGeography");
        synchronized (AutomataConsentController.class) {
            if (started) {
                return snapshotJson();
            }
            started = true;
            if (!AutomataAdsController.isConfigured()) {
                // Nothing to consent for: ads are not configured (release without injected AdMob ids). UMP would need the app id, so it is never started.
                status = "unavailable";
                reason = "ads_not_configured";
                canRequest = false;
                settled = true;
                return snapshotJson();
            }
            status = "unknown";
            reason = "";
            settled = false;
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                startUpdate(geography);
            }
        });
        return snapshotJson();
    }

    static String status() {
        return snapshotJson();
    }

    static boolean canRequestAds() {
        return canRequest;
    }

    /** Reopens the privacy options form (only when UMP says it is required). Returns {"status":"started"} or a terminal answer. */
    static String showPrivacyOptions() {
        synchronized (AutomataConsentController.class) {
            if (!started || !settled) {
                return terminalJson("unavailable", "consent_not_ready");
            }
            if (!privacyOptionsRequired) {
                return terminalJson("unavailable", "privacy_options_not_required");
            }
            if (formVisible || privacyInProgress) {
                return terminalJson("unavailable", "form_in_progress");
            }
            if (GlobalObject.getActivity() == null) {
                return terminalJson("unavailable", "no_activity");
            }
            privacyInProgress = true;
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                startPrivacyOptions();
            }
        });
        return "{\"status\":\"started\"}";
    }

    // ---------------------------------------------------------------- consent info update (UI thread)

    private static boolean isDebuggable(Activity activity) {
        try {
            return (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        } catch (Throwable t) {
            return false;
        }
    }

    private static int debugGeographyOf(String name) {
        if ("not_eea".equals(name)) {
            return ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_NOT_EEA;
        }
        if ("us_state".equals(name)) {
            return ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_REGULATED_US_STATE;
        }
        if ("eea".equals(name)) {
            return ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA;
        }
        return ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_DISABLED;
    }

    private static void startUpdate(String geography) {
        final Activity activity = GlobalObject.getActivity();
        if (activity == null) {
            publishError("no_activity");
            return;
        }
        try {
            registerLifecycle(activity);
            info = UserMessagingPlatform.getConsentInformation(activity);
            ConsentRequestParameters.Builder builder = new ConsentRequestParameters.Builder().setTagForUnderAgeOfConsent(false);
            // Debug geography / force testing: debuggable builds ONLY. A release build ignores the options entirely.
            if (isDebuggable(activity) && geography != null && !geography.isEmpty()) {
                int debugGeography = debugGeographyOf(geography);
                if (debugGeography != ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_DISABLED) {
                    builder.setConsentDebugSettings(new ConsentDebugSettings.Builder(activity)
                        .setDebugGeography(debugGeography)
                        .setForceTesting(true)
                        .build());
                }
            }
            updateAnswered = false;
            updateWatchdog = new Runnable() {
                @Override
                public void run() {
                    if (!updateAnswered) {
                        // Late callbacks are still applied; until then the player plays and ads stay closed (unless a previous session already granted them).
                        publishError("consent_timeout");
                    }
                }
            };
            MAIN.postDelayed(updateWatchdog, UPDATE_WATCHDOG_MS);
            info.requestConsentInfoUpdate(activity, builder.build(), new ConsentInformation.OnConsentInfoUpdateSuccessListener() {
                @Override
                public void onConsentInfoUpdateSuccess() {
                    onUpdateSuccess();
                }
            }, new ConsentInformation.OnConsentInfoUpdateFailureListener() {
                @Override
                public void onConsentInfoUpdateFailure(FormError error) {
                    onUpdateFailure(error);
                }
            });
        } catch (Throwable t) {
            publishError("init_exception");
        }
    }

    private static void onUpdateSuccess() {
        updateAnswered = true;
        if (updateWatchdog != null) {
            MAIN.removeCallbacks(updateWatchdog);
        }
        final Activity activity = GlobalObject.getActivity();
        try {
            if (info.getConsentStatus() == ConsentInformation.ConsentStatus.REQUIRED && info.isConsentFormAvailable() && activity != null) {
                loadForm(activity);
                return;
            }
            publishFinal(info.getConsentStatus() == ConsentInformation.ConsentStatus.REQUIRED ? "form_unavailable" : null);
        } catch (Throwable t) {
            publishError("update_exception");
        }
    }

    private static void onUpdateFailure(FormError error) {
        updateAnswered = true;
        if (updateWatchdog != null) {
            MAIN.removeCallbacks(updateWatchdog);
        }
        // No network / SDK error: gameplay is unaffected. canRequestAds() keeps the previous session's stored consent (UMP answers from its cache).
        publishError("update_error_" + (error == null ? -1 : error.getErrorCode()));
    }

    private static void loadForm(Activity activity) {
        UserMessagingPlatform.loadConsentForm(activity, new UserMessagingPlatform.OnConsentFormLoadSuccessListener() {
            @Override
            public void onConsentFormLoadSuccess(ConsentForm form) {
                if (foreground) {
                    showConsentForm(form);
                } else {
                    pendingForm = form; // shown when the activity returns to the foreground
                }
            }
        }, new UserMessagingPlatform.OnConsentFormLoadFailureListener() {
            @Override
            public void onConsentFormLoadFailure(FormError error) {
                publishFinal("form_load_error_" + (error == null ? -1 : error.getErrorCode()));
            }
        });
    }

    /** Tells the script a form is about to appear, THEN shows it (so the script brackets the activity pause as a platform overlay). */
    private static void showConsentForm(final ConsentForm form) {
        formVisible = true;
        settled = false;
        status = info == null ? status : mapStatus(info.getConsentStatus());
        dispatchThen(EVENT_STATE, stateJson(), new Runnable() {
            @Override
            public void run() {
                Activity activity = GlobalObject.getActivity();
                if (activity == null) {
                    formVisible = false;
                    publishFinal("no_activity");
                    return;
                }
                try {
                    form.show(activity, new ConsentForm.OnConsentFormDismissedListener() {
                        @Override
                        public void onConsentFormDismissed(FormError error) {
                            formVisible = false;
                            publishFinal(error == null ? null : "form_error_" + error.getErrorCode());
                        }
                    });
                } catch (Throwable t) {
                    formVisible = false;
                    publishFinal("form_show_exception");
                }
            }
        });
    }

    private static void startPrivacyOptions() {
        final Activity activity = GlobalObject.getActivity();
        if (activity == null) {
            privacyInProgress = false;
            dispatch(EVENT_PRIVACY_RESULT, "{\"status\":\"unavailable\",\"reason\":\"no_activity\"}");
            return;
        }
        formVisible = true;
        dispatchThen(EVENT_STATE, stateJson(), new Runnable() {
            @Override
            public void run() {
                try {
                    UserMessagingPlatform.showPrivacyOptionsForm(activity, new ConsentForm.OnConsentFormDismissedListener() {
                        @Override
                        public void onConsentFormDismissed(FormError error) {
                            formVisible = false;
                            privacyInProgress = false;
                            publishFinal(null); // state first, then the privacy result (the script ends the overlay on either)
                            dispatch(EVENT_PRIVACY_RESULT, error == null
                                ? "{\"status\":\"dismissed\"}"
                                : "{\"status\":\"failed\",\"reason\":\"form_error_" + error.getErrorCode() + "\"}");
                        }
                    });
                } catch (Throwable t) {
                    formVisible = false;
                    privacyInProgress = false;
                    publishFinal(null);
                    dispatch(EVENT_PRIVACY_RESULT, "{\"status\":\"failed\",\"reason\":\"privacy_options_exception\"}");
                }
            }
        });
    }

    // ---------------------------------------------------------------- state publishing

    /** Final state from UMP's own answers (consent status, canRequestAds, privacy options requirement). */
    private static void publishFinal(String finalReason) {
        try {
            if (info != null) {
                status = mapStatus(info.getConsentStatus());
                canRequest = info.canRequestAds();
                privacyOptionsRequired = info.getPrivacyOptionsRequirementStatus() == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
            }
        } catch (Throwable t) {
            status = "error";
            canRequest = false;
            finalReason = "state_exception";
        }
        if (finalReason == null && "required".equals(status) && !canRequest) {
            finalReason = "consent_not_given";
        }
        reason = finalReason == null ? "" : finalReason;
        formVisible = false;
        settled = true;
        dispatch(EVENT_STATE, stateJson());
        AutomataAdsController.onConsentChanged();
    }

    /** A failure that never blocks gameplay: ads open only when UMP already allows them (stored consent), otherwise they stay closed. */
    private static void publishError(String errorReason) {
        boolean allowed = false;
        boolean optionsRequired = privacyOptionsRequired;
        try {
            if (info != null) {
                allowed = info.canRequestAds();
                optionsRequired = info.getPrivacyOptionsRequirementStatus() == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
            }
        } catch (Throwable t) {
            allowed = false;
        }
        status = "error";
        reason = errorReason;
        canRequest = allowed;
        privacyOptionsRequired = optionsRequired;
        formVisible = false;
        settled = true;
        dispatch(EVENT_STATE, stateJson());
        AutomataAdsController.onConsentChanged();
    }

    private static String mapStatus(int umpStatus) {
        if (umpStatus == ConsentInformation.ConsentStatus.NOT_REQUIRED) {
            return "not_required";
        }
        if (umpStatus == ConsentInformation.ConsentStatus.REQUIRED) {
            return "required";
        }
        if (umpStatus == ConsentInformation.ConsentStatus.OBTAINED) {
            return "obtained";
        }
        return "unknown";
    }

    // ---------------------------------------------------------------- lifecycle (a form that loaded while backgrounded shows on resume)

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
                    ConsentForm form = pendingForm;
                    if (form != null) {
                        pendingForm = null;
                        showConsentForm(form);
                    }
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

    // ---------------------------------------------------------------- helpers

    private static void runOnUi(Runnable action) {
        try {
            GlobalObject.runOnUiThread(action);
        } catch (Throwable t) {
            MAIN.post(action);
        }
    }

    private static void dispatch(final String event, final String json) {
        try {
            CocosHelper.runOnGameThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JsbBridgeWrapper.getInstance().dispatchEventToScript(event, json);
                    } catch (Throwable t) {
                        // a failed dispatch never crashes the game; the script's start timeout settles the state
                    }
                }
            });
        } catch (Throwable t) {
            // ignore
        }
    }

    /** Dispatches on the game thread and runs `after` on the UI thread ONLY once the script has received the event (also when the dispatch fails). */
    private static void dispatchThen(final String event, final String json, final Runnable after) {
        try {
            CocosHelper.runOnGameThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JsbBridgeWrapper.getInstance().dispatchEventToScript(event, json);
                    } catch (Throwable t) {
                        // continue anyway: the form must not hang on a failed dispatch
                    } finally {
                        runOnUi(after);
                    }
                }
            });
        } catch (Throwable t) {
            runOnUi(after);
        }
    }

    private static String snapshotJson() {
        return stateJson();
    }

    private static String stateJson() {
        StringBuilder builder = new StringBuilder("{\"status\":\"").append(AutomataPlatformBridge.escapeJson(status)).append('"');
        builder.append(",\"canRequestAds\":").append(canRequest ? "true" : "false");
        builder.append(",\"privacyOptionsRequired\":").append(privacyOptionsRequired ? "true" : "false");
        builder.append(",\"formVisible\":").append(formVisible ? "true" : "false");
        builder.append(",\"settled\":").append(settled ? "true" : "false");
        String why = reason;
        if (why != null && !why.isEmpty()) {
            builder.append(",\"reason\":\"").append(AutomataPlatformBridge.escapeJson(why)).append('"');
        }
        return builder.append('}').toString();
    }

    private static String terminalJson(String terminalStatus, String terminalReason) {
        return "{\"status\":\"" + AutomataPlatformBridge.escapeJson(terminalStatus) + "\",\"reason\":\"" + AutomataPlatformBridge.escapeJson(terminalReason) + "\"}";
    }
}
