package com.cocos.game;

import com.android.billingclient.api.BillingClient;
import com.google.android.gms.ads.MobileAds;

public final class AutomataPlatformBridge {
    private static final String COMPILE_ONLY_REASON = "compile_only_bridge";

    private AutomataPlatformBridge() {
    }

    public static String getCommercialSdkBaselineJson() {
        return "{"
            + "\"playServicesAdsVersion\":\"25.4.0\","
            + "\"billingVersion\":\"9.1.0\","
            + "\"adsClass\":\"" + escape(MobileAds.class.getName()) + "\","
            + "\"billingClass\":\"" + escape(BillingClient.class.getName()) + "\","
            + "\"mode\":\"compile_only\""
            + "}";
    }

    // AUT-057: rewarded ads are served by AutomataAdsController (AdMob). Every method returns immediately; showRewarded is
    // start-then-event (the final result arrives as the "automata.ads.rewarded_result" script event).
    public static String initializeAds() {
        return AutomataAdsController.initialize();
    }

    public static String getAdsStatus() {
        return AutomataAdsController.status();
    }

    public static String getRewardedAvailability(String placementId) {
        return AutomataAdsController.availability(placementId);
    }

    public static String preloadRewarded(String placementId) {
        return AutomataAdsController.preload(placementId);
    }

    public static String showRewarded(String requestJson) {
        return AutomataAdsController.show(requestJson);
    }

    // AUT-065: Google UMP consent is served by AutomataConsentController. Every method returns immediately; the slow results (consent state, privacy options
    // result) arrive as "automata.consent.*" script events. canRequestAds() gates the ads provider natively.
    public static String initializeConsent(String optionsJson) {
        return AutomataConsentController.initialize(optionsJson);
    }

    public static String getConsentState() {
        return AutomataConsentController.status();
    }

    public static String showPrivacyOptions() {
        return AutomataConsentController.showPrivacyOptions();
    }

    // AUT-060: Google Play Billing is served by AutomataBillingController. Every method returns immediately; the slow results
    // (connection state, product metadata, purchase result, acknowledge, store query) arrive as "automata.billing.*" script events.
    public static String initializePurchases() {
        return AutomataBillingController.initialize();
    }

    public static String getPurchaseStatus() {
        return AutomataBillingController.getStatus();
    }

    public static String queryProductDetails(String productIdsCsv) {
        return AutomataBillingController.queryProductDetails(productIdsCsv);
    }

    public static String purchaseProduct(String requestJson) {
        return AutomataBillingController.purchase(requestJson);
    }

    // Called by the script ONLY after the entitlement is durably applied.
    public static String acknowledgePurchase(String requestJson) {
        return AutomataBillingController.acknowledge(requestJson);
    }

    public static String restorePurchases() {
        return AutomataBillingController.restore();
    }

    public static String initializeEntitlements() {
        return unavailableOperation();
    }

    public static String getEntitlementServiceStatus() {
        return unavailableService();
    }

    public static String getEntitlementStatus(String entitlementId) {
        return "{"
            + "\"entitlementId\":\"" + escape(entitlementId) + "\","
            + "\"owned\":false,"
            + "\"source\":\"none\","
            + "\"reason\":\"" + COMPILE_ONLY_REASON + "\""
            + "}";
    }

    public static String reconcileEntitlements() {
        return unavailableOperation();
    }

    private static String unavailableService() {
        return "{"
            + "\"ok\":false,"
            + "\"status\":\"unavailable\","
            + "\"reason\":\"" + COMPILE_ONLY_REASON + "\""
            + "}";
    }

    private static String unavailableOperation() {
        return unavailableService();
    }

    static String extractJsonStringValue(String json, String key) {
        return extractJsonString(json, key);
    }

    static String escapeJson(String value) {
        return escape(value);
    }

    private static String extractJsonString(String json, String key) {
        if (json == null || key == null || key.isEmpty()) {
            return "";
        }

        String marker = "\"" + key + "\"";
        int keyIndex = json.indexOf(marker);
        if (keyIndex < 0) {
            return "";
        }

        int colonIndex = json.indexOf(':', keyIndex + marker.length());
        if (colonIndex < 0) {
            return "";
        }

        int valueStart = json.indexOf('"', colonIndex + 1);
        if (valueStart < 0) {
            return "";
        }

        StringBuilder builder = new StringBuilder();
        boolean escaping = false;
        for (int index = valueStart + 1; index < json.length(); index += 1) {
            char character = json.charAt(index);

            if (escaping) {
                builder.append(character);
                escaping = false;
                continue;
            }

            if (character == '\\') {
                escaping = true;
                continue;
            }

            if (character == '"') {
                return builder.toString();
            }

            builder.append(character);
        }

        return "";
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }

        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }
}
