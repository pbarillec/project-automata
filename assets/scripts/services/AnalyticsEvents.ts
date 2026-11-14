/**
 * Central analytics event catalogue (TECHNICAL_DESIGN 24.1). Ids are snake_case and unique.
 * No domain-event mapper lives here; mapping is a later task.
 */
export const ANALYTICS_EVENTS = {
    producerUnlock: 'producer_unlock',
    breakthroughPurchase: 'breakthrough_purchase',
    eraReached: 'era_reached',
    firstRobot: 'first_robot',
    rebootPreview: 'reboot_preview',
    rebootCompleted: 'reboot_completed',
    offlineReportShown: 'offline_report_shown',
    offlineCollected: 'offline_collected',
    rewardedOpportunity: 'rewarded_opportunity',
    rewardedStart: 'rewarded_start',
    rewardedComplete: 'rewarded_complete',
    rewardedFailure: 'rewarded_failure',
    purchaseStart: 'purchase_start',
    purchaseComplete: 'purchase_complete',
    purchaseCancel: 'purchase_cancel',
    purchaseFailure: 'purchase_failure',
    purchaseRestore: 'purchase_restore',
} as const;

export type AnalyticsEventId = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
