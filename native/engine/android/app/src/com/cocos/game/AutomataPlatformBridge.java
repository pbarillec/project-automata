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

    public static String initializeAds() {
        return unavailableOperation();
    }

    public static String getAdsStatus() {
        return unavailableService();
    }

    public static String getRewardedAvailability(String placementId) {
        return "{"
            + "\"available\":false,"
            + "\"status\":\"unavailable\","
            + "\"placementId\":\"" + escape(placementId) + "\","
            + "\"reason\":\"" + COMPILE_ONLY_REASON + "\""
            + "}";
    }

    public static String preloadRewarded(String placementId) {
        return unavailableOperation();
    }

    public static String showRewarded(String requestJson) {
        String placementId = extractJsonString(requestJson, "placementId");
        String requestId = extractJsonString(requestJson, "requestId");

        return "{"
            + "\"status\":\"unavailable\","
            + "\"placementId\":\"" + escape(placementId) + "\","
            + "\"requestId\":\"" + escape(requestId) + "\","
            + "\"rewardVerified\":false,"
            + "\"reason\":\"" + COMPILE_ONLY_REASON + "\""
            + "}";
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
            .replace("\"", "\\\"");
    }
}
