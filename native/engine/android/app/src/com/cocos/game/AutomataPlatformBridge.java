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

    public static String initializePurchases() {
        return unavailableOperation();
    }

    public static String getPurchaseStatus() {
        return unavailableService();
    }

    public static String queryProductDetails(String productIdsCsv) {
        return "{"
            + "\"ok\":false,"
            + "\"status\":\"unavailable\","
            + "\"products\":[],"
            + "\"missingProductIds\":" + csvToJsonArray(productIdsCsv) + ","
            + "\"reason\":\"" + COMPILE_ONLY_REASON + "\""
            + "}";
    }

    public static String purchaseProduct(String requestJson) {
        String productId = extractJsonString(requestJson, "productId");
        String requestId = extractJsonString(requestJson, "requestId");

        return "{"
            + "\"status\":\"unavailable\","
            + "\"productId\":\"" + escape(productId) + "\","
            + "\"requestId\":\"" + escape(requestId) + "\","
            + "\"reason\":\"" + COMPILE_ONLY_REASON + "\""
            + "}";
    }

    public static String restorePurchases() {
        return unavailableOperation();
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

    private static String csvToJsonArray(String csv) {
        if (csv == null || csv.trim().isEmpty()) {
            return "[]";
        }

        StringBuilder builder = new StringBuilder("[");
        String[] parts = csv.split(",");
        boolean wroteItem = false;

        for (String part : parts) {
            String value = part.trim();
            if (value.isEmpty()) {
                continue;
            }

            if (wroteItem) {
                builder.append(',');
            }
            builder.append('"').append(escape(value)).append('"');
            wroteItem = true;
        }

        builder.append(']');
        return builder.toString();
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
