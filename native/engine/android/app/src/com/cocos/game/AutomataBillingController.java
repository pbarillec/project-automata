package com.cocos.game;

import android.app.Activity;
import android.content.Context;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.cocos.lib.CocosHelper;
import com.cocos.lib.GlobalObject;
import com.cocos.lib.JsbBridgeWrapper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * AUT-060 Google Play Billing provider for the single non-consumable Founder pack (package-private; reached only through
 * AutomataPlatformBridge). Contract with the TypeScript AndroidPurchaseService (see its header for the full wire protocol):
 * - every BillingClient call runs on the UI thread; the synchronous getters read volatile snapshots and never block;
 * - slow work is START-THEN-EVENT: a bridge call returns {"status":"started"} (or a terminal immediate failure) and the result is
 *   dispatched later as a script event (automata.billing.state / product_details / purchase_result / acknowledge_result / query_result);
 * - a purchase is reported "completed" ONLY for a PURCHASED, not yet acknowledged purchase; an already acknowledged owned purchase is
 *   "already_owned" (restore semantics: the grant flow never re-grants Surges for it);
 * - this class NEVER acknowledges on its own: acknowledgePurchase() runs only when the script calls it, after the entitlement is durably
 *   applied (an unacknowledged purchase is auto-refunded by Google after 3 days, so a failed grant is redelivered by restorePurchases()
 *   on the next start instead of being acknowledged blindly); there is no consume (the pack is a non-consumable);
 * - purchases that arrive outside a launchBillingFlow (a PENDING purchase that completes later, a result after the script gave up)
 *   come through PurchasesUpdatedListener and are dispatched with an empty requestId so the script routes them through the same grant path.
 * No secret is needed: the only configuration is the product id below, which must equal PRODUCTS.founderPack in
 * assets/scripts/services/PlatformServiceTypes.ts (pinned by a test) and must be created by the owner in the Play Console.
 */
final class AutomataBillingController {
    static final String EVENT_STATE = "automata.billing.state";
    static final String EVENT_PRODUCT_DETAILS = "automata.billing.product_details";
    static final String EVENT_PURCHASE_RESULT = "automata.billing.purchase_result";
    static final String EVENT_ACKNOWLEDGE_RESULT = "automata.billing.acknowledge_result";
    static final String EVENT_QUERY_RESULT = "automata.billing.query_result";

    /** The Play Console in-app product id (non-consumable, one purchase option). Mirrors PRODUCTS.founderPack. */
    static final String PRODUCT_FOUNDER_PACK = "founder_pack";

    private static final int USED_REQUEST_ID_LIMIT = 64;

    private static final Object LOCK = new Object();

    private static volatile String status = "uninitialized"; // uninitialized | initializing | ready | unavailable | failed
    private static volatile String reason = "";
    private static volatile boolean productQueryInFlight = false;
    private static volatile String activeRequestId = "";

    // Touched on the UI thread only (or under LOCK where noted).
    private static BillingClient client = null;
    private static ProductDetails founderDetails = null;
    private static final Set<String> ACK_IN_FLIGHT = new HashSet<String>();

    private static final Map<String, Boolean> USED_REQUEST_IDS = new LinkedHashMap<String, Boolean>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
            return size() > USED_REQUEST_ID_LIMIT;
        }
    };

    private AutomataBillingController() {
    }

    // ---------------------------------------------------------------- public surface (called from the bridge)

    static String initialize() {
        synchronized (LOCK) {
            if ("initializing".equals(status) || "ready".equals(status)) {
                return statusJson();
            }
            status = "initializing";
            reason = "";
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                connect();
            }
        });
        return statusJson();
    }

    static String getStatus() {
        return statusJson();
    }

    static String queryProductDetails(String productIdsCsv) {
        if (!"ready".equals(status)) {
            return terminalJson(false, status, "ready".equals(status) ? "" : (reason.isEmpty() ? "billing_not_ready" : reason));
        }
        final List<String> requested = new ArrayList<String>();
        if (productIdsCsv != null) {
            for (String part : productIdsCsv.split(",")) {
                String id = part.trim();
                if (!id.isEmpty() && !requested.contains(id)) {
                    requested.add(id);
                }
            }
        }
        synchronized (LOCK) {
            if (productQueryInFlight) {
                return "{\"status\":\"started\"}"; // the running query's event answers every waiter
            }
            productQueryInFlight = true;
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                startProductQuery(requested);
            }
        });
        return "{\"status\":\"started\"}";
    }

    static String purchase(String requestJson) {
        final String productId = AutomataPlatformBridge.extractJsonStringValue(requestJson, "productId");
        final String requestId = AutomataPlatformBridge.extractJsonStringValue(requestJson, "requestId");
        if (requestId.isEmpty()) {
            return purchaseTerminal("failed", productId, requestId, "empty_request_id");
        }
        if (!PRODUCT_FOUNDER_PACK.equals(productId)) {
            return purchaseTerminal("failed", productId, requestId, "unknown_product");
        }
        if (!"ready".equals(status)) {
            return purchaseTerminal("unavailable", productId, requestId, reason.isEmpty() ? "billing_not_ready" : reason);
        }
        synchronized (LOCK) {
            if (USED_REQUEST_IDS.containsKey(requestId)) {
                return purchaseTerminal("failed", productId, requestId, "duplicate_request_id");
            }
            if (!activeRequestId.isEmpty()) {
                return purchaseTerminal("failed", productId, requestId, "purchase_in_progress");
            }
            USED_REQUEST_IDS.put(requestId, Boolean.TRUE);
            activeRequestId = requestId;
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                launch(requestId);
            }
        });
        return "{\"status\":\"started\",\"productId\":\"" + escape(productId) + "\",\"requestId\":\"" + escape(requestId) + "\"}";
    }

    /** Called by the script ONLY after the entitlement is durably applied. */
    static String acknowledge(String requestJson) {
        final String token = AutomataPlatformBridge.extractJsonStringValue(requestJson, "purchaseToken");
        if (token.isEmpty()) {
            return terminalJson(false, "failed", "missing_purchase_token");
        }
        if (!"ready".equals(status)) {
            return terminalJson(false, status, reason.isEmpty() ? "billing_not_ready" : reason);
        }
        synchronized (LOCK) {
            if (!ACK_IN_FLIGHT.add(token)) {
                return "{\"status\":\"started\"}"; // the running acknowledge's event answers
            }
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                sendAcknowledge(token);
            }
        });
        return "{\"status\":\"started\"}";
    }

    /** The store query hook: delivers every owned Founder purchase as a purchase_result event, then one query_result event. */
    static String restore() {
        if (!"ready".equals(status)) {
            return terminalJson(false, status, reason.isEmpty() ? "billing_not_ready" : reason);
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                startQueryPurchases();
            }
        });
        return "{\"status\":\"started\"}";
    }

    // ---------------------------------------------------------------- connection

    private static void connect() {
        Activity activity = GlobalObject.getActivity();
        if (activity == null) {
            setStatus("failed", "no_activity");
            return;
        }
        try {
            if (client == null) {
                Context context = activity.getApplicationContext();
                client = BillingClient.newBuilder(context)
                    .setListener(PURCHASES_LISTENER)
                    .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                    .enableAutoServiceReconnection()
                    .build();
            }
            client.startConnection(new BillingClientStateListener() {
                @Override
                public void onBillingSetupFinished(BillingResult result) {
                    int code = result.getResponseCode();
                    if (code == BillingClient.BillingResponseCode.OK) {
                        setStatus("ready", "");
                    } else if (code == BillingClient.BillingResponseCode.BILLING_UNAVAILABLE
                        || code == BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED) {
                        setStatus("unavailable", "billing_unavailable");
                    } else {
                        setStatus("failed", "setup_error_" + code);
                    }
                }

                @Override
                public void onBillingServiceDisconnected() {
                    // Auto service reconnection retries; until setup finishes again every call answers "unavailable / service_disconnected".
                    setStatus("failed", "service_disconnected");
                }
            });
        } catch (RuntimeException error) {
            setStatus("failed", "setup_exception");
        }
    }

    private static void setStatus(String newStatus, String newReason) {
        synchronized (LOCK) {
            status = newStatus;
            reason = newReason == null ? "" : newReason;
        }
        dispatch(EVENT_STATE, statusJson());
    }

    // ---------------------------------------------------------------- product details

    private static void startProductQuery(final List<String> requested) {
        if (client == null || !client.isReady()) {
            finishProductQuery(false, requested, new ArrayList<ProductDetails>(), "billing_not_ready");
            return;
        }
        List<QueryProductDetailsParams.Product> products = new ArrayList<QueryProductDetailsParams.Product>();
        for (String id : requested) {
            if (PRODUCT_FOUNDER_PACK.equals(id)) {
                products.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build());
            }
        }
        if (products.isEmpty()) {
            finishProductQuery(true, requested, new ArrayList<ProductDetails>(), "");
            return;
        }
        try {
            client.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(products).build(),
                (result, detailsResult) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        finishProductQuery(false, requested, new ArrayList<ProductDetails>(), "query_error_" + result.getResponseCode());
                        return;
                    }
                    List<ProductDetails> found = detailsResult == null ? new ArrayList<ProductDetails>() : detailsResult.getProductDetailsList();
                    finishProductQuery(true, requested, found, "");
                });
        } catch (RuntimeException error) {
            finishProductQuery(false, requested, new ArrayList<ProductDetails>(), "query_exception");
        }
    }

    private static void finishProductQuery(boolean ok, List<String> requested, List<ProductDetails> found, String failure) {
        StringBuilder productsJson = new StringBuilder("[");
        List<String> missing = new ArrayList<String>(requested);
        boolean wrote = false;
        for (ProductDetails details : found) {
            String id = details.getProductId();
            missing.remove(id);
            if (PRODUCT_FOUNDER_PACK.equals(id)) {
                founderDetails = details;
            }
            ProductDetails.OneTimePurchaseOfferDetails offer = details.getOneTimePurchaseOfferDetails();
            // The price text is the store's localized formatted price, verbatim; nothing is ever composed locally.
            String price = offer == null ? "" : offer.getFormattedPrice();
            if (wrote) {
                productsJson.append(',');
            }
            wrote = true;
            productsJson.append("{\"productId\":\"").append(escape(id)).append('"')
                .append(",\"type\":\"durable\"")
                .append(",\"available\":").append(offer != null)
                .append(",\"title\":\"").append(escape(details.getTitle())).append('"')
                .append(",\"description\":\"").append(escape(details.getDescription())).append('"')
                .append(",\"localizedPrice\":\"").append(escape(price)).append('"')
                .append('}');
        }
        productsJson.append(']');
        StringBuilder missingJson = new StringBuilder("[");
        for (int index = 0; index < missing.size(); index += 1) {
            if (index > 0) {
                missingJson.append(',');
            }
            missingJson.append('"').append(escape(missing.get(index))).append('"');
        }
        missingJson.append(']');
        synchronized (LOCK) {
            productQueryInFlight = false;
        }
        StringBuilder json = new StringBuilder("{\"ok\":").append(ok);
        json.append(",\"products\":").append(productsJson);
        json.append(",\"missingProductIds\":").append(missingJson);
        if (!failure.isEmpty()) {
            json.append(",\"reason\":\"").append(escape(failure)).append('"');
        }
        json.append('}');
        dispatch(EVENT_PRODUCT_DETAILS, json.toString());
    }

    // ---------------------------------------------------------------- purchase flow

    private static void launch(final String requestId) {
        if (founderDetails == null) {
            // The script normally queried the metadata first (the shop needs the price); if it is gone, fetch it once and then launch.
            queryThenLaunch(requestId);
            return;
        }
        launchWithDetails(requestId, founderDetails);
    }

    private static void queryThenLaunch(final String requestId) {
        if (client == null || !client.isReady()) {
            finishFlow(requestId, "unavailable", "", "", "service_disconnected");
            return;
        }
        List<QueryProductDetailsParams.Product> products = new ArrayList<QueryProductDetailsParams.Product>();
        products.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PRODUCT_FOUNDER_PACK)
            .setProductType(BillingClient.ProductType.INAPP)
            .build());
        try {
            client.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(products).build(),
                (result, detailsResult) -> {
                    List<ProductDetails> found = detailsResult == null ? null : detailsResult.getProductDetailsList();
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || found == null || found.isEmpty()) {
                        finishFlow(requestId, "unavailable", "", "", "product_unavailable");
                        return;
                    }
                    founderDetails = found.get(0);
                    runOnUi(new Runnable() {
                        @Override
                        public void run() {
                            launchWithDetails(requestId, founderDetails);
                        }
                    });
                });
        } catch (RuntimeException error) {
            finishFlow(requestId, "failed", "", "", "query_exception");
        }
    }

    private static void launchWithDetails(String requestId, ProductDetails details) {
        Activity activity = GlobalObject.getActivity();
        if (activity == null || client == null || !client.isReady()) {
            finishFlow(requestId, "unavailable", "", "", activity == null ? "no_activity" : "service_disconnected");
            return;
        }
        try {
            List<BillingFlowParams.ProductDetailsParams> list = new ArrayList<BillingFlowParams.ProductDetailsParams>();
            list.add(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details).build());
            BillingResult result = client.launchBillingFlow(activity, BillingFlowParams.newBuilder().setProductDetailsParamsList(list).build());
            int code = result.getResponseCode();
            if (code == BillingClient.BillingResponseCode.OK) {
                return; // the outcome arrives through PurchasesUpdatedListener
            }
            if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                resolveAlreadyOwned(requestId);
                return;
            }
            failFlow(requestId, code);
        } catch (RuntimeException error) {
            finishFlow(requestId, "failed", "", "", "launch_exception");
        }
    }

    private static final PurchasesUpdatedListener PURCHASES_LISTENER = new PurchasesUpdatedListener() {
        @Override
        public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
            int code = result.getResponseCode();
            String requestId = activeRequestId;
            if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
                boolean handled = false;
                for (Purchase purchase : purchases) {
                    if (!isFounderPurchase(purchase)) {
                        continue;
                    }
                    // The first Founder purchase answers the waiting flow (if any); anything else is outside a flow.
                    emitPurchase(purchase, handled ? "" : requestId);
                    handled = true;
                }
                if (handled) {
                    clearActive(requestId);
                } else if (!requestId.isEmpty()) {
                    finishFlow(requestId, "failed", "", "", "no_matching_purchase");
                }
                return;
            }
            if (requestId.isEmpty()) {
                return; // an error / cancel outside a flow bought nothing
            }
            if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
                finishFlow(requestId, "cancelled", "", "", "user_canceled");
            } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                resolveAlreadyOwned(requestId);
            } else {
                failFlow(requestId, code);
            }
        }
    };

    private static void failFlow(String requestId, int code) {
        switch (code) {
            case BillingClient.BillingResponseCode.USER_CANCELED:
                finishFlow(requestId, "cancelled", "", "", "user_canceled");
                break;
            case BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE:
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE:
            case BillingClient.BillingResponseCode.SERVICE_DISCONNECTED:
            case BillingClient.BillingResponseCode.NETWORK_ERROR:
            case BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED:
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE:
                finishFlow(requestId, "unavailable", "", "", "billing_error_" + code);
                break;
            default:
                finishFlow(requestId, "failed", "", "", "billing_error_" + code);
                break;
        }
    }

    /** ITEM_ALREADY_OWNED: look at the store state; an unacknowledged owned purchase was never granted (-> completed), otherwise already_owned. */
    private static void resolveAlreadyOwned(final String requestId) {
        if (client == null || !client.isReady()) {
            finishFlow(requestId, "already_owned", "", "", "item_already_owned");
            return;
        }
        try {
            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
                (result, purchases) -> {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
                        for (Purchase purchase : purchases) {
                            if (isFounderPurchase(purchase)) {
                                emitPurchase(purchase, requestId);
                                clearActive(requestId);
                                return;
                            }
                        }
                    }
                    finishFlow(requestId, "already_owned", "", "", "item_already_owned");
                });
        } catch (RuntimeException error) {
            finishFlow(requestId, "already_owned", "", "", "item_already_owned");
        }
    }

    private static void finishFlow(String requestId, String resultStatus, String transactionId, String token, String failure) {
        clearActive(requestId);
        StringBuilder json = new StringBuilder("{\"status\":\"").append(escape(resultStatus)).append('"');
        json.append(",\"productId\":\"").append(PRODUCT_FOUNDER_PACK).append('"');
        json.append(",\"requestId\":\"").append(escape(requestId)).append('"');
        if (!transactionId.isEmpty()) {
            json.append(",\"transactionId\":\"").append(escape(transactionId)).append('"');
        }
        if (!token.isEmpty()) {
            json.append(",\"purchaseToken\":\"").append(escape(token)).append('"');
        }
        if (!failure.isEmpty()) {
            json.append(",\"reason\":\"").append(escape(failure)).append('"');
        }
        json.append('}');
        dispatch(EVENT_PURCHASE_RESULT, json.toString());
    }

    private static void clearActive(String requestId) {
        synchronized (LOCK) {
            if (!requestId.isEmpty() && requestId.equals(activeRequestId)) {
                activeRequestId = "";
            }
        }
    }

    // ---------------------------------------------------------------- purchase events (flow, pending completion, query redelivery)

    private static boolean isFounderPurchase(Purchase purchase) {
        return purchase != null && purchase.getProducts() != null && purchase.getProducts().contains(PRODUCT_FOUNDER_PACK);
    }

    /**
     * PURCHASED + not acknowledged -> completed (grant, then the script acknowledges); PURCHASED + acknowledged -> already_owned (restore,
     * never a grant); PENDING -> pending (nothing granted); any other state is ignored. requestId "" = outside any flow.
     */
    private static void emitPurchase(Purchase purchase, String requestId) {
        int state = purchase.getPurchaseState();
        String resultStatus;
        if (state == Purchase.PurchaseState.PURCHASED) {
            resultStatus = purchase.isAcknowledged() ? "already_owned" : "completed";
        } else if (state == Purchase.PurchaseState.PENDING) {
            resultStatus = "pending";
        } else {
            if (!requestId.isEmpty()) {
                finishFlow(requestId, "failed", "", "", "unspecified_purchase_state");
            }
            return;
        }
        String orderId = purchase.getOrderId() == null ? "" : purchase.getOrderId();
        String token = purchase.getPurchaseToken() == null ? "" : purchase.getPurchaseToken();
        StringBuilder json = new StringBuilder("{\"status\":\"").append(resultStatus).append('"');
        json.append(",\"productId\":\"").append(PRODUCT_FOUNDER_PACK).append('"');
        json.append(",\"requestId\":\"").append(escape(requestId)).append('"');
        if (!orderId.isEmpty()) {
            json.append(",\"transactionId\":\"").append(escape(orderId)).append('"');
        }
        if (!token.isEmpty()) {
            json.append(",\"purchaseToken\":\"").append(escape(token)).append('"');
        }
        json.append('}');
        dispatch(EVENT_PURCHASE_RESULT, json.toString());
    }

    // ---------------------------------------------------------------- acknowledge / query

    private static void sendAcknowledge(final String token) {
        if (client == null || !client.isReady()) {
            finishAcknowledge(token, false, "failed", "service_disconnected");
            return;
        }
        try {
            client.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(),
                (BillingResult result) -> {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        finishAcknowledge(token, true, "acknowledged", "");
                    } else {
                        finishAcknowledge(token, false, "failed", "ack_error_" + result.getResponseCode());
                    }
                });
        } catch (RuntimeException error) {
            finishAcknowledge(token, false, "failed", "ack_exception");
        }
    }

    private static void finishAcknowledge(String token, boolean ok, String resultStatus, String failure) {
        synchronized (LOCK) {
            ACK_IN_FLIGHT.remove(token);
        }
        StringBuilder json = new StringBuilder("{\"purchaseToken\":\"").append(escape(token)).append('"');
        json.append(",\"ok\":").append(ok);
        json.append(",\"status\":\"").append(escape(resultStatus)).append('"');
        if (!failure.isEmpty()) {
            json.append(",\"reason\":\"").append(escape(failure)).append('"');
        }
        json.append('}');
        dispatch(EVENT_ACKNOWLEDGE_RESULT, json.toString());
    }

    private static void startQueryPurchases() {
        if (client == null || !client.isReady()) {
            finishQuery(false, 0, "service_disconnected");
            return;
        }
        try {
            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
                (result, purchases) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || purchases == null) {
                        finishQuery(false, 0, "query_error_" + result.getResponseCode());
                        return;
                    }
                    int count = 0;
                    for (Purchase purchase : purchases) {
                        if (isFounderPurchase(purchase)) {
                            emitPurchase(purchase, "");
                            count += 1;
                        }
                    }
                    finishQuery(true, count, "");
                });
        } catch (RuntimeException error) {
            finishQuery(false, 0, "query_exception");
        }
    }

    private static void finishQuery(boolean ok, int count, String failure) {
        StringBuilder json = new StringBuilder("{\"ok\":").append(ok);
        json.append(",\"status\":\"").append(ok ? "ready" : "failed").append('"');
        json.append(",\"count\":").append(count);
        if (!failure.isEmpty()) {
            json.append(",\"reason\":\"").append(escape(failure)).append('"');
        }
        json.append('}');
        dispatch(EVENT_QUERY_RESULT, json.toString());
    }

    // ---------------------------------------------------------------- helpers

    private static String statusJson() {
        StringBuilder builder = new StringBuilder("{\"ok\":").append("ready".equals(status));
        builder.append(",\"status\":\"").append(escape(status)).append('"');
        if (!reason.isEmpty()) {
            builder.append(",\"reason\":\"").append(escape(reason)).append('"');
        }
        builder.append('}');
        return builder.toString();
    }

    private static String terminalJson(boolean ok, String resultStatus, String failure) {
        StringBuilder builder = new StringBuilder("{\"ok\":").append(ok);
        builder.append(",\"status\":\"").append(escape(resultStatus)).append('"');
        if (failure != null && !failure.isEmpty()) {
            builder.append(",\"reason\":\"").append(escape(failure)).append('"');
        }
        builder.append('}');
        return builder.toString();
    }

    private static String purchaseTerminal(String resultStatus, String productId, String requestId, String failure) {
        return "{\"status\":\"" + escape(resultStatus) + "\",\"productId\":\"" + escape(productId) + "\",\"requestId\":\"" + escape(requestId)
            + "\",\"reason\":\"" + escape(failure) + "\"}";
    }

    private static void runOnUi(Runnable action) {
        try {
            GlobalObject.runOnUiThread(action);
        } catch (RuntimeException error) {
            // Nothing to do: the script backstops end every pending operation.
        }
    }

    private static void dispatch(final String event, final String json) {
        try {
            CocosHelper.runOnGameThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JsbBridgeWrapper.getInstance().dispatchEventToScript(event, json);
                    } catch (RuntimeException error) {
                        // The script side may not be listening yet; a purchase is redelivered by the next store query.
                    }
                }
            });
        } catch (RuntimeException error) {
            // see above
        }
    }

    private static String escape(String value) {
        return AutomataPlatformBridge.escapeJson(value);
    }
}
