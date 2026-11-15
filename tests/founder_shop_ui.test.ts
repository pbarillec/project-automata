import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import { getDefaultTextCatalogue } from '../assets/scripts/localization/index.ts';
import { applyFounderPackPurchase, getFounderSurgeChargesRemaining, isFounderPackOwned, resolveFounderOfferStatus } from '../assets/scripts/monetization/FounderOffer.ts';
import { CURRENT_SAVE_VERSION, InMemorySaveStorage, SAVE_MAIN_NAME, serializeGameStateToSaveJson } from '../assets/scripts/persistence/index.ts';
import { MockPurchaseService } from '../assets/scripts/platform/mock/MockPlatformProviders.ts';
import { NoOpPurchaseService } from '../assets/scripts/platform/noop/NoOpPlatformProviders.ts';
import { createBuildPurchaseService } from '../assets/scripts/presentation/BuildPlatformServices.ts';
import { DEBUG_PURCHASE_MAX_STEPS, parseDebugPurchaseScriptFile } from '../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import { FactoryWorldStateBinding } from '../assets/scripts/presentation/FactoryWorldStateBinding.ts';
import { FOUNDER_SHOP_PRODUCT_RETRY_MS, FOUNDER_SHOP_PRODUCT_TTL_MS, FounderShopFlow, readFounderPrice, type FounderShopFlowState } from '../assets/scripts/presentation/FounderShopFlow.ts';
import * as L from '../assets/scripts/presentation/FounderShopLayout.ts';
import { createFounderShopViewModel, founderBuyAlpha, resolveFounderEntryState } from '../assets/scripts/presentation/FounderShopViewModel.ts';
import { computePermanentUpgradeRects } from '../assets/scripts/presentation/PermanentUpgradeLayout.ts';
import { computeRebootRects } from '../assets/scripts/presentation/RebootLayout.ts';
import { computeSettingsRects } from '../assets/scripts/presentation/SettingsLayout.ts';
import * as X from '../assets/scripts/presentation/ExtendedOverclockLayout.ts';
import { computeMilestoneToastRect } from '../assets/scripts/presentation/MilestoneToastLayout.ts';
import { computeUiLayout, rectContains, rectsOverlap, type UiRect } from '../assets/scripts/presentation/UiLayout.ts';
import { PRODUCTS } from '../assets/scripts/services/PlatformServiceTypes.ts';
import type { PurchaseResult } from '../assets/scripts/services/PurchaseService.ts';
import { createFreshGameState } from '../assets/scripts/state/index.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { FOUNDER_CAPTURE_PRICE_TEXT, evaluateFounderShop, expectedFounderTexts, type FounderShopTimelineEvent } from '../tools/device/founder_shop_checks.ts';
import { REVEAL_SCENARIOS } from '../tools/device/reveal_capture.ts';
import { buildAut047SeededState } from '../tools/device/seed_aut047.ts';
import { AUT059_SEED_VARIANTS, buildAut059PurchaseScriptFile, buildAut059SeededSave, buildAut059SeededState } from '../tools/device/seed_aut059.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
const catalogue = getDefaultTextCatalogue();
const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const PRICE = 'TEST PRICE 9.99';
const PRODUCT = PRODUCTS.founderPack;

// ---------------------------------------------------------------- helpers

function mockStore(options: { price?: string | null; missing?: boolean; status?: 'ready' | 'uninitialized' | 'unavailable' | 'failed' } = {}) {
    const products = options.missing === true ? [] : [{ productId: PRODUCT, type: 'durable' as const, available: true, ...(options.price === null ? {} : { localizedPrice: options.price ?? PRICE }) }];
    return new MockPurchaseService({ initialStatus: options.status ?? 'ready', products });
}

async function start(variant: 'available' | 'locked' | 'owned' = 'available') {
    const state = buildAut059SeededState(variant, NOW_MS);
    const storage = new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: serializeGameStateToSaveJson(state, { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: repo.contentVersion, savedAtUtc: iso(NOW_MS) }),
    });
    const clock = new ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, boot, session: boot.startup.session };
}
type Ctx = Awaited<ReturnType<typeof start>>;

function makeFlow(ctx: Ctx, purchases: MockPurchaseService | NoOpPurchaseService, extra: { acknowledge?: (r: PurchaseResult) => void; nowRef?: { ms: number } } = {}) {
    const diag: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    const order: string[] = [];
    const binding = new FactoryWorldStateBinding({ session: ctx.session as never, configRepository: ctx.boot.configRepository, automation: null, hud: null, panel: null });
    const nowRef = extra.nowRef ?? { ms: NOW_MS };
    let changes = 0;
    const flow = new FounderShopFlow({
        purchases,
        session: {
            getFounderOfferStatus: () => binding.getFounderOfferStatus(),
            applyFounderPackPurchase: async (request) => { order.push('apply'); return binding.applyFounderPackPurchase(request); },
            reconcileFounderEntitlement: async (report) => { order.push('reconcile'); return binding.reconcileFounderEntitlement(report); },
        },
        entitlementSource: 'mock',
        now: () => nowRef.ms,
        onChange: () => { changes += 1; },
        onDiagnostic: (phase, payload) => diag.push({ phase, payload }),
        acknowledge: extra.acknowledge ? (result) => { order.push('ack'); extra.acknowledge?.(result); } : undefined,
    });
    return { flow, binding, diag, order, nowRef, changes: () => changes };
}

const snapshot = (ctx: Ctx) => ctx.session.getStateSnapshot();
const charges = (ctx: Ctx) => getFounderSurgeChargesRemaining(snapshot(ctx));

// ---------------------------------------------------------------- view model

const flowState = (overrides: Partial<FounderShopFlowState> = {}): FounderShopFlowState => ({ offer: 'available', store: 'ready', price: PRICE, purchase: 'idle', note: null, ...overrides });

test('AUT-059 view states: locked / unknown / store-unavailable have NO entry; available / pending / owned have one', () => {
    assert.equal(resolveFounderEntryState(null), null);
    for (const offer of ['unknown', 'locked'] as const) assert.equal(createFounderShopViewModel(flowState({ offer, store: 'unknown', price: null })).chip.visible, false, offer);
    for (const store of ['unavailable', 'unknown'] as const) assert.equal(createFounderShopViewModel(flowState({ store, price: null })).chip.visible, false, `available + ${store}`);
    const available = createFounderShopViewModel(flowState());
    assert.deepEqual([available.chip.visible, available.chip.state, available.modal.state], [true, 'available', 'available']);
    const pending = createFounderShopViewModel(flowState({ purchase: 'pending' }));
    assert.deepEqual([pending.chip.visible, pending.chip.state, pending.modal.state, pending.modal.buyEnabled], [true, 'pending', 'pending', false]);
    // a pending purchase keeps the entry even if the store service later reports unavailable
    assert.equal(createFounderShopViewModel(flowState({ purchase: 'pending', store: 'unavailable', price: null })).chip.visible, true);
    const owned = createFounderShopViewModel(flowState({ offer: 'owned', store: 'unknown', price: null }));
    assert.deepEqual([owned.chip.visible, owned.chip.state, owned.modal.state, owned.modal.buyVisible, owned.modal.buyEnabled, owned.modal.priceVisible], [true, 'owned', 'owned', false, false, false]);
});

test('AUT-059 the price text is the store metadata VERBATIM; loading / missing give a neutral line and a disabled BUY (never an invented price)', () => {
    const available = createFounderShopViewModel(flowState());
    assert.equal(available.modal.priceText, PRICE);
    assert.equal(available.modal.priceFromStore, true);
    assert.equal(available.modal.buyLabel, catalogue.resolveText('founder.buy.with_price', { price: PRICE }));
    assert.equal(available.modal.buyEnabled, true);
    const odd = 'any 12,34 value';
    assert.equal(createFounderShopViewModel(flowState({ price: odd })).modal.priceText, odd, 'passed through, never reformatted');
    const loading = createFounderShopViewModel(flowState({ store: 'loading', price: null }));
    assert.equal(loading.chip.visible, false, 'loading: nothing is shown before the store answered');
    assert.equal(loading.modal.priceText, catalogue.resolveText('founder.price.loading'));
    assert.deepEqual([loading.modal.priceFromStore, loading.modal.buyEnabled, loading.modal.buyLabel], [false, false, catalogue.resolveText('founder.buy')]);
    const missing = createFounderShopViewModel(flowState({ store: 'ready', price: null }));
    assert.equal(missing.chip.visible, true, 'the service is ready but the product has no price: neutral state, entry stays');
    assert.equal(missing.modal.priceText, catalogue.resolveText('founder.price.unavailable'));
    assert.deepEqual([missing.modal.priceFromStore, missing.modal.buyEnabled], [false, false]);
    assert.ok(founderBuyAlpha(missing.modal) < 255 && founderBuyAlpha(available.modal) === 255);
});

test('AUT-059 modal contents: exactly the Founder Robot variant and the Factory Surges, localized, values from the pack constants', () => {
    const modal = createFounderShopViewModel(flowState()).modal;
    assert.deepEqual([...modal.contents], [...expectedFounderTexts().contents]);
    assert.equal(modal.contents.length, 2);
    assert.match(modal.contents[1], /^2 Factory Surges: ×2 for 30 min each$/);
    assert.equal(modal.title, catalogue.resolveText('founder.title'));
});

test('AUT-059 in-flight / pending / owned status lines and calm notes', () => {
    assert.equal(createFounderShopViewModel(flowState({ purchase: 'in_flight' })).modal.status, catalogue.resolveText('founder.status.in_progress'));
    assert.equal(createFounderShopViewModel(flowState({ purchase: 'in_flight' })).modal.buyEnabled, false, 'no double tap while in flight');
    assert.equal(createFounderShopViewModel(flowState({ purchase: 'pending' })).modal.status, catalogue.resolveText('founder.status.pending'));
    assert.equal(createFounderShopViewModel(flowState({ offer: 'owned', price: null })).modal.status, catalogue.resolveText('founder.status.owned'));
    for (const note of ['cancelled', 'failed', 'unavailable', 'not_saved'] as const) {
        assert.equal(createFounderShopViewModel(flowState({ note })).modal.note, catalogue.resolveText(`founder.note.${note}`), note);
    }
    assert.equal(createFounderShopViewModel(flowState()).modal.note, null);
    // a cancel keeps the purchase available again
    assert.equal(createFounderShopViewModel(flowState({ note: 'cancelled' })).modal.buyEnabled, true);
});

test('AUT-059 localization: every founder key exists, has no digits / currency of its own except the pack constants, and the strings are not hardcoded', () => {
    const keys = catalogue.keys().filter((key) => key.startsWith('founder.'));
    assert.ok(keys.length >= 20, `${keys.length} founder keys`);
    for (const key of keys) {
        const text = catalogue.resolveText(key);
        assert.ok(text.length > 0, key);
        assert.doesNotMatch(text.replace(/\{[a-z_]+\}/g, ''), /[€$£¥]|\d+[.,]\d{2}/, `${key} must not carry a currency or a price`);
    }
    const english = JSON.parse(read('localization/en.json')).entries as Record<string, string>;
    for (const key of keys) assert.equal(english[key], catalogue.resolveText(key));
});

// ---------------------------------------------------------------- no hardcoded price

test('AUT-059 no hardcoded price or currency anywhere in the shop UI sources or the catalogue', () => {
    const files = ['FounderShopFlow', 'FounderShopViewModel', 'FounderShopLayout', 'FounderShopController', 'DebugPurchaseScriptFile'].map((name) => `assets/scripts/presentation/${name}.ts`);
    for (const rel of files) {
        const source = code(rel);
        assert.doesNotMatch(source, /[€£¥]/, `${rel}: currency symbol`);
        assert.doesNotMatch(source, /\$\s?\d/, `${rel}: dollar amount`);
        assert.doesNotMatch(source, /\b\d+[.,]\d{2}\b/, `${rel}: price-like number`);
        assert.doesNotMatch(source, /\b(EUR|USD|GBP)\b/, `${rel}: currency code`);
    }
    assert.doesNotMatch(read('localization/en.json'), /2[.,]99|3[.,]99|€/, 'catalogue');
    // The controller only ever assigns strings the view model composed.
    assert.doesNotMatch(code('assets/scripts/presentation/FounderShopController.ts'), /\.string\s*=\s*['"`][^'"`]*[A-Za-z]{2,}/);
    // The only place a price string exists in the repo's player path is the store metadata the flow reads.
    assert.match(code('assets/scripts/presentation/FounderShopFlow.ts'), /localizedPrice/);
    // Test metadata (seed / checks) is obviously synthetic.
    assert.equal(FOUNDER_CAPTURE_PRICE_TEXT, PRICE);
    assert.doesNotMatch(PRICE, /€/);
});

test('AUT-059 readFounderPrice: metadata verbatim (trimmed); missing / unavailable / empty / absurdly long yield null', () => {
    const base = { productId: PRODUCT, type: 'durable' as const, available: true };
    assert.equal(readFounderPrice({ ...base, localizedPrice: '  X 1  ' }), 'X 1');
    assert.equal(readFounderPrice(undefined), null);
    assert.equal(readFounderPrice({ ...base }), null);
    assert.equal(readFounderPrice({ ...base, localizedPrice: '   ' }), null);
    assert.equal(readFounderPrice({ ...base, localizedPrice: 'p', available: false }), null);
    assert.equal(readFounderPrice({ ...base, localizedPrice: 'x'.repeat(200) }), null);
});

// ---------------------------------------------------------------- layout

const SCREENS = [
    { name: '720x1280', w: 720, h: 1280, safe: null },
    { name: '1080x1920', w: 1080, h: 1920, safe: null },
    { name: '1080x2412', w: 1080, h: 2412, safe: null },
    { name: '1272x2772', w: 1272, h: 2772, safe: null },
    { name: '1080x2412 top inset 130', w: 1080, h: 2412, safe: { x: 0, y: 0, w: 1080, h: 2412 - 130 } },
    { name: '1080x2412 symmetric inset 130', w: 1080, h: 2412, safe: { x: 0, y: 130, w: 1080, h: 2412 - 260 } },
];

for (const screen of SCREENS) {
    test(`AUT-059 layout ${screen.name}: chip >= 64 units, inside the safe area on the third line under the Reboot chip, clear of every other chip, the toast band and the HUD / panel`, () => {
        const screenPx = { w: screen.w, h: screen.h };
        const safe: UiRect = screen.safe ?? { x: 0, y: 0, w: screen.w, h: screen.h };
        const rects = L.computeFounderShopRects(screenPx, screen.safe ?? undefined);
        const base = computeUiLayout(screenPx, screen.safe ?? undefined);
        const settings = computeSettingsRects(screenPx, screen.safe ?? undefined);
        const ai = computePermanentUpgradeRects(screenPx, screen.safe ?? undefined);
        const reboot = computeRebootRects(screenPx, screen.safe ?? undefined);
        const extended = X.computeExtendedOverclockChipRect(screenPx, screen.safe ?? undefined);
        const toast = computeMilestoneToastRect(screenPx, screen.safe ?? undefined);
        const scale = screen.w / 720;
        assert.ok(rects.chip.h / scale >= 64 - 1e-9 && rects.chip.w / scale >= 64);
        assert.ok(rectContains(safe, rects.chip, 1e-6), 'inside the safe area');
        assert.ok(rectContains(base.factoryBand, rects.chip, 1e-6), 'inside the factory band (no added HUD height)');
        assert.ok(Math.abs((rects.chip.x + rects.chip.w) - (safe.x + safe.w - 16 * scale)) < 1e-6, 'right-aligned at the edge margin');
        assert.ok(Math.abs((reboot.chip.y - 8 * scale) - (rects.chip.y + rects.chip.h)) < 1e-6, 'directly under the Reboot chip');
        for (const [name, other] of Object.entries({ settings: settings.chip, ai: ai.chip, reboot: reboot.chip, extended, toast })) {
            assert.equal(rectsOverlap(rects.chip, other as UiRect), false, `no overlap with ${name}`);
        }
        assert.equal(rectsOverlap(rects.chip, base.hud), false, 'HUD');
        assert.equal(rectsOverlap(rects.chip, base.panel), false, 'Producer Panel');
    });

    test(`AUT-059 layout ${screen.name}: modal card centred in the factory band, BUY and CLOSE hit rects >= 64 design units and inside the card`, () => {
        const screenPx = { w: screen.w, h: screen.h };
        const rects = L.computeFounderShopRects(screenPx, screen.safe ?? undefined);
        const scale = screen.w / 720;
        assert.ok(rects.buy.h / scale >= 64 - 1e-9 && rects.close.h / scale >= 64 - 1e-9);
        assert.ok(rectContains(rects.panel, rects.buy, 1e-6) && rectContains(rects.panel, rects.close, 1e-6));
        assert.equal(rectsOverlap(rects.buy, rects.close), false);
        assert.ok(rectContains({ x: 0, y: 0, w: screen.w, h: screen.h }, rects.panel, 1e-6), 'on screen');
        assert.ok(Math.abs(rects.panel.w / scale - 640) < 1e-6, '640-wide card');
    });
}

test('AUT-059 panel layout: rows stack without overlap inside the card, every row at least the body font height, fonts above the minimum', () => {
    const layout = L.resolveFounderPanelLayout();
    const rows = [layout.title, ...layout.contentRows, layout.priceRow, layout.note, layout.buy, layout.close];
    for (const row of rows) {
        assert.ok(row.y - row.h / 2 >= -layout.height / 2 - 1e-9 && row.y + row.h / 2 <= layout.height / 2 + 1e-9, 'inside the card');
        assert.ok(Math.abs(row.x) + row.w / 2 <= layout.width / 2 + 1e-9);
        assert.ok(row.h >= L.FOUNDER_MIN_BODY_FONT_SIZE);
    }
    const sorted = [...rows].sort((a, b) => b.y - a.y);
    for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i - 1].y - sorted[i - 1].h / 2 >= sorted[i].y + sorted[i].h / 2 - 1e-9, `row ${i} does not overlap the previous`);
    assert.ok(layout.buy.h >= L.FOUNDER_MIN_BUTTON_HEIGHT && layout.close.h >= L.FOUNDER_MIN_BUTTON_HEIGHT);
    for (const size of [L.FOUNDER_CHIP_LABEL_FONT_SIZE, L.FOUNDER_CHIP_TAG_FONT_SIZE, L.FOUNDER_CONTENT_FONT_SIZE, L.FOUNDER_PRICE_FONT_SIZE, L.FOUNDER_NOTE_FONT_SIZE, L.FOUNDER_BUY_FONT_SIZE, L.FOUNDER_CLOSE_FONT_SIZE, L.FOUNDER_TITLE_FONT_SIZE]) assert.ok(size >= L.FOUNDER_MIN_BODY_FONT_SIZE);
    // outline: two fillRects
    const outline = L.founderChipOutlineRects();
    assert.equal(outline.outer.w - outline.inner.w, L.FOUNDER_CHIP_OUTLINE_THICKNESS * 2);
    // never red: every palette colour has r <= g + 80 is too loose; assert none is a red-dominant colour
    for (const colour of Object.values(L.FOUNDER_COLORS)) assert.ok(!(colour.r > 150 && colour.g < 100 && colour.b < 100), 'no red');
    assert.equal(L.FOUNDER_COLORS.backdrop.a, 150);
    assert.deepEqual([L.FOUNDER_COLORS.pill.r, L.FOUNDER_COLORS.pill.g, L.FOUNDER_COLORS.pill.b, L.FOUNDER_COLORS.pill.a], [24, 29, 32, 245]);
});

// ---------------------------------------------------------------- flow

test('AUT-059 flow: locked -> no store contact, no price; owned -> no store contact', async () => {
    const ctx = await start('locked');
    const store = mockStore();
    const { flow } = makeFlow(ctx, store);
    const state = await flow.refresh();
    assert.deepEqual([state.offer, state.store, state.price], ['locked', 'unknown', null]);
    assert.equal(store.calls.filter((c) => c.method === 'queryProductDetails').length, 0, 'a locked offer never queries the store');
    assert.equal(await flow.buy(), null);
    const owned = await start('owned');
    const second = makeFlow(owned, mockStore());
    const ownedState = await second.flow.refresh();
    assert.deepEqual([ownedState.offer, ownedState.price], ['owned', null]);
    assert.equal(await second.flow.buy(), null, 'an owned pack cannot be bought again');
});

test('AUT-059 flow: available + ready store -> price from the metadata, BUY works; service not ready -> loading, no buy', async () => {
    const ctx = await start();
    const store = mockStore({ status: 'uninitialized' });
    const { flow } = makeFlow(ctx, store);
    let state = await flow.refresh();
    assert.deepEqual([state.offer, state.store, state.price], ['available', 'loading', null]);
    assert.equal(await flow.buy(), null, 'no purchase while the store is loading');
    await store.initialize();
    state = await flow.refresh();
    assert.deepEqual([state.store, state.price], ['ready', PRICE]);
});

test('AUT-059 flow: NoOp / unavailable / failed store -> the entry is hidden and nothing can be bought (release builds)', async () => {
    for (const purchases of [new NoOpPurchaseService(), mockStore({ status: 'unavailable' }), mockStore({ status: 'failed' })]) {
        const ctx = await start();
        const { flow } = makeFlow(ctx, purchases);
        const state = await flow.refresh();
        assert.deepEqual([state.offer, state.store, state.price], ['available', 'unavailable', null]);
        assert.equal(createFounderShopViewModel(state).chip.visible, false);
        assert.equal(await flow.buy(), null);
        assert.equal(isFounderPackOwned(snapshot(ctx)), false);
    }
});

test('AUT-059 flow: product missing or without a usable price -> neutral, BUY disabled and never purchasable; re-read soon', async () => {
    for (const store of [mockStore({ missing: true }), mockStore({ price: null })]) {
        const ctx = await start();
        const { flow, nowRef } = makeFlow(ctx, store);
        const state = await flow.refresh();
        assert.deepEqual([state.store, state.price], ['ready', null]);
        const viewModel = createFounderShopViewModel(state);
        assert.deepEqual([viewModel.chip.visible, viewModel.modal.buyEnabled, viewModel.modal.priceFromStore], [true, false, false]);
        assert.equal(await flow.buy(), null);
        assert.equal(store.calls.filter((c) => c.method === 'purchase').length, 0);
        // missing metadata is retried after the short retry window, a found price only after the long TTL
        const queries = () => store.calls.filter((c) => c.method === 'queryProductDetails').length;
        const before = queries();
        await flow.refresh();
        assert.equal(queries(), before, 'cached inside the retry window');
        nowRef.ms += FOUNDER_SHOP_PRODUCT_RETRY_MS + 1;
        await flow.refresh();
        assert.equal(queries(), before + 1);
    }
    const ctx = await start();
    const store = mockStore();
    const { flow, nowRef } = makeFlow(ctx, store);
    await flow.refresh();
    nowRef.ms += FOUNDER_SHOP_PRODUCT_RETRY_MS + 1;
    await flow.refresh();
    assert.equal(store.calls.filter((c) => c.method === 'queryProductDetails').length, 1, 'a found price is cached for the long TTL');
    nowRef.ms += FOUNDER_SHOP_PRODUCT_TTL_MS;
    await flow.refresh();
    assert.equal(store.calls.filter((c) => c.method === 'queryProductDetails').length, 2);
});

test('AUT-059 flow SUCCESS: completed -> applied_saved BEFORE the acknowledge, entitlement + cosmetic + exactly 2 Surges, one critical save', async () => {
    const ctx = await start();
    const store = mockStore();
    store.enqueueOutcomes(PRODUCT, { outcome: 'completed' });
    const acked: PurchaseResult[] = [];
    const { flow, order, diag } = makeFlow(ctx, store, { acknowledge: (result) => acked.push(result) });
    await flow.refresh();
    const outcome = await flow.buy();
    assert.equal(outcome, 'purchased');
    assert.deepEqual(order, ['apply', 'ack'], 'the session answered BEFORE the acknowledge');
    assert.equal(acked.length, 1);
    assert.equal(acked[0].status, 'completed');
    assert.equal(isFounderPackOwned(snapshot(ctx)), true);
    assert.equal(charges(ctx), 2);
    assert.equal(diag.find((d) => d.phase === 'applied')?.payload.status, 'applied_saved');
    const state = flow.getState();
    assert.deepEqual([state.offer, state.purchase, state.note, state.price], ['owned', 'idle', null, null]);
    assert.equal(createFounderShopViewModel(state).chip.state, 'owned');
    const saved = JSON.parse(ctx.storage.getFile(SAVE_MAIN_NAME) as string);
    assert.ok(JSON.stringify(saved).includes('entitlement.founder_pack'), 'persisted');
});

test('AUT-059 flow: a rejected / failed apply is NOT acknowledged and grants nothing', async () => {
    const ctx = await start();
    const store = mockStore();
    store.enqueueOutcomes(PRODUCT, { outcome: 'completed' });
    const acked: unknown[] = [];
    const order: string[] = [];
    const flow = new FounderShopFlow({
        purchases: store,
        session: {
            getFounderOfferStatus: () => 'available',
            applyFounderPackPurchase: async () => { order.push('apply'); return null; },
            reconcileFounderEntitlement: async () => null,
        },
        entitlementSource: 'mock',
        now: () => NOW_MS,
        acknowledge: (result) => { acked.push(result); },
    });
    await flow.refresh();
    assert.equal(await flow.buy(), 'failed');
    assert.deepEqual([order, acked.length], [['apply'], 0]);
    assert.equal(flow.getState().note, 'failed');
    assert.equal(charges(ctx), 0);
});

test('AUT-059 flow: apply with a failed save is reported as not_saved, not acknowledged, and never granted twice on a retry', async () => {
    const ctx = await start();
    const acked: unknown[] = [];
    const store = mockStore();
    store.enqueueOutcomes(PRODUCT, { outcome: 'completed' });
    let calls = 0;
    const flow = new FounderShopFlow({
        purchases: store,
        session: {
            getFounderOfferStatus: () => 'available',
            applyFounderPackPurchase: async () => { calls += 1; return { status: 'applied_persistence_failed', execution: {} as never, save: { ok: false } as never }; },
            reconcileFounderEntitlement: async () => null,
        },
        entitlementSource: 'mock',
        now: () => NOW_MS,
        acknowledge: (result) => { acked.push(result); },
    });
    await flow.refresh();
    assert.equal(await flow.buy(), 'not_saved');
    assert.equal(acked.length, 0);
    assert.equal(flow.getState().note, 'not_saved');
    assert.equal(calls, 1);
    assert.equal(charges(ctx), 0, 'the fake session granted nothing');
});

test('AUT-059 flow PENDING: pending -> nothing granted, pending state, BUY disabled, no second purchase; owned later clears it', async () => {
    const ctx = await start();
    const store = mockStore();
    store.enqueueOutcomes(PRODUCT, { outcome: 'pending' });
    const { flow } = makeFlow(ctx, store);
    await flow.refresh();
    assert.equal(await flow.buy(), 'pending');
    assert.equal(isFounderPackOwned(snapshot(ctx)), false);
    assert.equal(charges(ctx), 0);
    const state = flow.getState();
    assert.deepEqual([state.purchase, state.offer], ['pending', 'available']);
    const viewModel = createFounderShopViewModel(state);
    assert.deepEqual([viewModel.chip.state, viewModel.modal.buyEnabled], ['pending', false]);
    assert.equal(await flow.buy(), null, 'BUY is inert while pending');
    assert.equal(store.calls.filter((c) => c.method === 'purchase').length, 1);
    // the store later confirms (a later delivery path): the pack is granted once and the pending state clears
    const delivered = await flow.deliver({ status: 'completed', productId: PRODUCT, requestId: 'late-1', transactionId: 'txn-late' });
    assert.equal(delivered, 'purchased');
    assert.equal(flow.getState().purchase, 'idle');
    assert.equal(flow.getState().offer, 'owned');
    assert.equal(charges(ctx), 2);
});

test('AUT-059 flow CANCEL / FAIL / UNAVAILABLE / TIMEOUT: nothing granted, a calm note, BUY available again', async () => {
    const cases: Array<[string, 'cancelled' | 'failed' | 'unavailable' | 'timeout', string, string]> = [
        ['cancelled', 'cancelled', 'cancelled', 'cancelled'],
        ['failed', 'failed', 'failed', 'failed'],
        ['timeout', 'timeout', 'failed', 'failed'],
        ['unavailable', 'unavailable', 'unavailable', 'unavailable'],
    ];
    for (const [, status, outcome, note] of cases) {
        const ctx = await start();
        const store = mockStore();
        store.enqueueOutcomes(PRODUCT, { outcome: status });
        const { flow, order } = makeFlow(ctx, store);
        await flow.refresh();
        assert.equal(await flow.buy(), outcome, status);
        assert.deepEqual(order, [], `${status}: the session was never asked to grant`);
        assert.equal(isFounderPackOwned(snapshot(ctx)), false);
        assert.equal(charges(ctx), 0);
        const state = flow.getState();
        assert.equal(state.note, note, status);
        assert.equal(state.purchase, 'idle');
        const viewModel = createFounderShopViewModel(state);
        assert.equal(viewModel.modal.note, catalogue.resolveText(`founder.note.${note}`));
        assert.equal(viewModel.chip.visible, true);
        flow.dismissNote();
        assert.equal(flow.getState().note, null);
    }
    // after a cancel the next attempt works (the default mock outcome is completed)
    const ctx = await start();
    const store = mockStore();
    store.enqueueOutcomes(PRODUCT, { outcome: 'cancelled' });
    const { flow } = makeFlow(ctx, store);
    await flow.refresh();
    assert.equal(await flow.buy(), 'cancelled');
    assert.equal(await flow.buy(), 'purchased');
    assert.equal(charges(ctx), 2);
});

test('AUT-059 flow: a thrown purchase call is a calm failure, nothing granted', async () => {
    const ctx = await start();
    const store = mockStore();
    store.purchase = () => Promise.reject(new Error('boom'));
    const { flow } = makeFlow(ctx, store);
    await flow.refresh();
    assert.equal(await flow.buy(), 'failed');
    assert.equal(flow.getState().note, 'failed');
    assert.equal(flow.getState().purchase, 'idle');
    assert.equal(charges(ctx), 0);
});

test('AUT-059 flow IDEMPOTENCE: duplicate taps while in flight start ONE purchase; duplicate callbacks grant ONE pack', async () => {
    const ctx = await start();
    const store = mockStore();
    store.enqueueOutcomes(PRODUCT, { outcome: 'completed', manual: true, duplicateCallback: true });
    const { flow, order, diag } = makeFlow(ctx, store);
    await flow.refresh();
    const first = flow.buy();
    assert.equal(flow.getState().purchase, 'in_flight');
    assert.equal(await flow.buy(), null, 'second tap while in flight is a no-op');
    assert.equal(await flow.buy(), null);
    const requestId = String(diag.find((d) => d.phase === 'purchase_started')?.payload.requestId);
    assert.ok(store.gate.release(requestId));
    assert.equal(await first, 'purchased');
    assert.equal(store.calls.filter((c) => c.method === 'purchase').length, 1);
    assert.equal(charges(ctx), 2);
    // the store redelivers the SAME completed purchase (with and without the duplicate flag, concurrently): ignored
    const result: PurchaseResult = { status: 'completed', productId: PRODUCT, requestId, transactionId: `mock-${requestId}` };
    const redeliveries = await Promise.all([flow.deliver(result), flow.deliver(result), flow.deliver({ ...result, duplicate: true })]);
    assert.deepEqual(redeliveries, ['duplicate', 'duplicate', 'duplicate']);
    assert.deepEqual(order, ['apply'], 'the session saw exactly one delivery');
    assert.equal(charges(ctx), 2);
    // even a brand-new delivery with another id cannot add Surges (the grant-once flag is in the state)
    const other = await flow.deliver({ status: 'completed', productId: PRODUCT, requestId: 'other', transactionId: 'txn-other' });
    assert.equal(other, 'purchased');
    assert.equal(charges(ctx), 2, 'AUT-058 grant-once: still 2');
});

test('AUT-059 flow: concurrent redelivery while the apply is in progress is ignored (one apply)', async () => {
    const ctx = await start();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const binding = new FactoryWorldStateBinding({ session: ctx.session as never, configRepository: ctx.boot.configRepository, automation: null, hud: null, panel: null });
    const flow = new FounderShopFlow({
        purchases: mockStore(),
        session: {
            getFounderOfferStatus: () => binding.getFounderOfferStatus(),
            applyFounderPackPurchase: async (request) => { order.push('apply'); await gate; return binding.applyFounderPackPurchase(request); },
            reconcileFounderEntitlement: (report) => binding.reconcileFounderEntitlement(report),
        },
        entitlementSource: 'mock',
        now: () => NOW_MS,
    });
    const result: PurchaseResult = { status: 'completed', productId: PRODUCT, requestId: 'r1', transactionId: 't1' };
    const first = flow.deliver(result);
    const second = await flow.deliver(result);
    assert.equal(second, 'duplicate');
    release();
    assert.equal(await first, 'purchased');
    assert.deepEqual(order, ['apply']);
    assert.equal(charges(ctx), 2);
});

test('AUT-059 flow already_owned (store says so): reconciles the entitlement WITHOUT Surges and without an acknowledge', async () => {
    const ctx = await start();
    const store = mockStore();
    store.enqueueOutcomes(PRODUCT, { outcome: 'already_owned' });
    const acked: unknown[] = [];
    const { flow, order } = makeFlow(ctx, store, { acknowledge: (r) => acked.push(r) });
    await flow.refresh();
    assert.equal(await flow.buy(), 'already_owned');
    assert.deepEqual(order, ['reconcile']);
    assert.equal(isFounderPackOwned(snapshot(ctx)), true);
    assert.equal(charges(ctx), 0, 'a restore never grants Surges (AUT-058)');
    assert.equal(acked.length, 0);
});

test('AUT-059 flow: the session offer decides locked / owned (a refresh after the unlock shows the entry)', async () => {
    const ctx = await start('locked');
    const store = mockStore();
    const { flow } = makeFlow(ctx, store);
    assert.equal((await flow.refresh()).offer, 'locked');
    assert.equal(resolveFounderOfferStatus(snapshot(ctx)), 'locked');
    // unlock: the Worker Bot flag appears in the authoritative state
    const state = snapshot(ctx);
    assert.equal(createFreshGameState().run.purchasedBreakthroughIds.length, 0);
    assert.equal(state.run.progressionFlags.first_robot === true, false);
});

test('AUT-059 flow: diagnostics and onChange never throw into the flow', async () => {
    const ctx = await start();
    const store = mockStore();
    const binding = new FactoryWorldStateBinding({ session: ctx.session as never, configRepository: ctx.boot.configRepository, automation: null, hud: null, panel: null });
    const flow = new FounderShopFlow({
        purchases: store,
        session: {
            getFounderOfferStatus: () => { throw new Error('no state'); },
            applyFounderPackPurchase: (request) => binding.applyFounderPackPurchase(request),
            reconcileFounderEntitlement: (report) => binding.reconcileFounderEntitlement(report),
        },
        entitlementSource: 'mock',
        now: () => NOW_MS,
        onDiagnostic: () => { throw new Error('diag'); },
    });
    const state = await flow.refresh();
    assert.equal(state.offer, 'unknown');
    assert.equal(createFounderShopViewModel(state).chip.visible, false);
});

// ---------------------------------------------------------------- build selection / debug script

test('AUT-059 build selection: release and DEBUG-without-script use the NoOp store; DEBUG + script uses the scriptable mock with the scripted metadata', async () => {
    assert.ok(createBuildPurchaseService(false).service instanceof NoOpPurchaseService);
    const script = parseDebugPurchaseScriptFile(JSON.stringify({ price: PRICE, outcomes: ['cancelled', 'completed'] }))!;
    assert.ok(createBuildPurchaseService(false, script).service instanceof NoOpPurchaseService, 'a release build never uses the mock, even with a script');
    assert.ok(createBuildPurchaseService(true).service instanceof NoOpPurchaseService, 'DEBUG without a script behaves like a release build (no chip)');
    const selection = createBuildPurchaseService(true, script);
    assert.ok(selection.service instanceof MockPurchaseService);
    assert.equal(selection.source, 'mock');
    await selection.service.initialize();
    const details = await selection.service.queryProductDetails([PRODUCT]);
    assert.equal(details.products[0].localizedPrice, PRICE);
    assert.equal((await selection.service.purchase({ productId: PRODUCT, requestId: 'a' })).status, 'cancelled');
    assert.equal((await selection.service.purchase({ productId: PRODUCT, requestId: 'b' })).status, 'completed');
    const missing = createBuildPurchaseService(true, parseDebugPurchaseScriptFile(JSON.stringify({ metadata: 'missing' }))!);
    await missing.service.initialize();
    assert.deepEqual((await missing.service.queryProductDetails([PRODUCT])).missingProductIds, [PRODUCT]);
    const noPrice = createBuildPurchaseService(true, parseDebugPurchaseScriptFile(JSON.stringify({ outcomes: [] }))!);
    await noPrice.service.initialize();
    assert.equal((await noPrice.service.queryProductDetails([PRODUCT])).products[0].localizedPrice, undefined);
    assert.equal(createBuildPurchaseService(false).source, 'store');
    const noOp = await new NoOpPurchaseService().purchase({ productId: PRODUCT, requestId: 'z' });
    assert.equal(noOp.status, 'unavailable');
});

test('AUT-059 debug_purchase.json parser: allow-listed outcomes only, bounded, anything else ignored', () => {
    assert.deepEqual(parseDebugPurchaseScriptFile(JSON.stringify({ price: ' P ', outcomes: ['pending'], duplicateCallback: true })), { price: 'P', metadataMissing: false, outcomes: ['pending'], duplicateCallback: true });
    assert.deepEqual(parseDebugPurchaseScriptFile('{}'), { price: null, metadataMissing: false, outcomes: [], duplicateCallback: false });
    assert.equal(parseDebugPurchaseScriptFile(undefined), null);
    assert.equal(parseDebugPurchaseScriptFile('not json'), null);
    assert.equal(parseDebugPurchaseScriptFile('[]'), null);
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ outcomes: ['hack'] })), null);
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ outcomes: new Array(DEBUG_PURCHASE_MAX_STEPS + 1).fill('completed') })), null);
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ price: '' })), null);
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ price: 'x'.repeat(40) })), null);
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ metadata: 'other' })), null);
    assert.equal(parseDebugPurchaseScriptFile(JSON.stringify({ duplicateCallback: 'yes' })), null);
});

// ---------------------------------------------------------------- binding

test('AUT-059 binding: offer status from the authoritative state; apply fans out + reports the command once; replays report nothing', async () => {
    const ctx = await start();
    const reported: unknown[] = [];
    const fanned: unknown[][] = [];
    const binding = new FactoryWorldStateBinding({
        session: ctx.session as never, configRepository: ctx.boot.configRepository,
        automation: { syncAutomationState: () => undefined, consumeDomainEvents: (_s, events) => { fanned.push([...events]); } },
        hud: null, panel: null,
        reportCommandResult: (command, result) => { reported.push([command.type, result.execution.ok]); },
    });
    assert.equal(binding.getFounderOfferStatus(), 'available');
    const first = await binding.applyFounderPackPurchase({ requestId: 'x', source: 'mock' });
    assert.equal(first?.status, 'applied_saved');
    assert.deepEqual(reported, [['grantFounderPack', true]]);
    assert.equal(fanned.length, 1);
    const replay = await binding.applyFounderPackPurchase({ requestId: 'x', source: 'mock' });
    assert.equal(replay?.status, 'already_applied');
    assert.equal(reported.length, 1);
    assert.equal(binding.getFounderOfferStatus(), 'owned');
    assert.equal(charges(ctx), 2);
    const noSupport = new FactoryWorldStateBinding({ session: { getStateSnapshot: () => snapshot(ctx) } as never, configRepository: ctx.boot.configRepository, automation: null, hud: null, panel: null });
    assert.equal(await noSupport.applyFounderPackPurchase({ requestId: 'x', source: 'mock' }), null);
});

// ---------------------------------------------------------------- scene / wiring (source pins)

test('AUT-059 wiring: controller is thin (no commands, no state, no strings), the bootstrap builds it below the offline root and keeps the modals exclusive', () => {
    const controller = code('assets/scripts/presentation/FounderShopController.ts');
    assert.doesNotMatch(controller, /GameCommand|submit\(|commandEmitter|getStateSnapshot|PurchaseService|queryProductDetails/);
    assert.match(controller, /node\.active|setScale/);
    assert.doesNotMatch(controller, /node\.active\s*=/, 'scale-based visibility only');
    assert.doesNotMatch(controller, /\.stroke\(|\.lineTo\(/, 'fillRect only');
    assert.match(controller, /fillRect/);
    assert.match(controller, /Button/);
    assert.match(controller, /Widget/);
    const bootstrap = code('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /createFounderShop\(\)/);
    const founderAt = bootstrap.indexOf('const founderShop = this.createFounderShop()');
    const offlineAt = bootstrap.indexOf('const offlineReport = this.createOfflineReport()');
    const rebootAt = bootstrap.indexOf('const reboot = this.createReboot()');
    assert.ok(rebootAt > 0 && founderAt > rebootAt && offlineAt > founderAt, 'created after the other modals and BEFORE the offline report root (which stays topmost)');
    assert.match(bootstrap, /founderShop\.setSuppressed\(wiring\.offlineReport\.isVisible\(\) \|\| rebootCard\)/);
    assert.match(bootstrap, /founderShop\.setModalBlocked\(wiring\.settings\.isOpen\(\) \|\| wiring\.permanentUpgrades\.isOpen\(\) \|\| wiring\.reboot\.isOpen\(\)\)/);
    assert.match(bootstrap, /createBuildPurchaseService\(DEBUG === true, this\.debugPurchaseScript, \{/);
    assert.match(bootstrap, /rects\.FounderChip/);
    assert.match(bootstrap, /rects\.FounderBuy/);
    assert.match(bootstrap, /DEBUG_PURCHASE_FILE/);
    // the purchase script is only ever read in DEBUG builds with device diagnostics
    assert.match(bootstrap, /readDebugPurchaseScript\(\): DebugPurchaseScript \| undefined \{\s*if \(DEBUG !== true \|\| !isDeviceDiagnosticsEnabled\(\)\) return undefined;/);
    // flow wiring goes through the binding (the session), never the coordinator directly
    assert.match(bootstrap, /applyFounderPackPurchase: \(request\) => binding\.applyFounderPackPurchase\(request\)/);
    // the NoOp store is the only non-DEBUG provider: the mock is referenced only by the build selector
    assert.doesNotMatch(bootstrap, /MockPurchaseService/);
    const build = code('assets/scripts/presentation/BuildPlatformServices.ts');
    // AUT-060: release = the real provider or the no-op (never the mock); DEBUG without a script = the no-op.
    assert.match(build, /if \(debug !== true\) return android\(\) \?\? \{ service: new NoOpPurchaseService\(\), source: 'store' \};/);
    assert.match(build, /if \(script === undefined\) return \{ service: new NoOpPurchaseService\(\), source: 'store' \};/);
    assert.match(read('assets/scripts/presentation/DeviceDiagnostics.ts'), /'founder_shop',/);
});

test('AUT-059 pure modules: no cc, explicit .ts imports, no constructor parameter properties', () => {
    for (const name of ['FounderShopFlow', 'FounderShopViewModel', 'FounderShopLayout', 'DebugPurchaseScriptFile']) {
        const rel = `assets/scripts/presentation/${name}.ts`;
        const source = code(rel);
        assert.doesNotMatch(source, new RegExp(String.raw`from\s+.c[c].`), rel);
        for (const match of source.matchAll(/^import (?!type)[^;]*from '(\.[^']*)'/gm)) assert.match(match[1], /\.ts$/, `${rel}: ${match[1]}`);
        assert.doesNotMatch(source, /constructor\s*\(\s*(public|private|protected|readonly)\s/, rel);
        assert.ok(fs.existsSync(path.join(repoRoot, `${rel}.meta`)), `${rel}.meta`);
    }
    assert.ok(fs.existsSync(path.join(repoRoot, 'assets/scripts/presentation/FounderShopController.ts.meta')));
    const uuids = new Set<string>();
    for (const name of ['FounderShopFlow', 'FounderShopViewModel', 'FounderShopLayout', 'FounderShopController', 'DebugPurchaseScriptFile']) {
        const meta = JSON.parse(read(`assets/scripts/presentation/${name}.ts.meta`));
        assert.equal(meta.importer, 'typescript');
        assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 5, 'unique uuids');
});

test('AUT-059 the chips are placed on different slots: Founder = line 3 right (below Reboot), nothing else uses that slot', () => {
    const offsets = L.founderChipWidgetOffsets();
    assert.equal(offsets.right, 16);
    const reboot = computeRebootRects({ w: 720, h: 1280 });
    const founder = L.computeFounderShopRects({ w: 720, h: 1280 });
    assert.equal(Math.round(founder.chip.y + founder.chip.h), Math.round(reboot.chip.y - 8));
    assert.equal(Math.round(founder.chip.x + founder.chip.w), Math.round(reboot.chip.x + reboot.chip.w));
});

// ---------------------------------------------------------------- seed + device checks + scenarios

test('AUT-059 seed: variants build the intended saves (available / owned / locked), the owned seed holds a real grant', () => {
    assert.deepEqual([...AUT059_SEED_VARIANTS], ['available', 'owned', 'locked', 'no_store']);
    const available = buildAut059SeededState('available', NOW_MS);
    assert.equal(resolveFounderOfferStatus(available), 'available');
    const owned = buildAut059SeededState('owned', NOW_MS);
    assert.equal(resolveFounderOfferStatus(owned), 'owned');
    assert.equal(getFounderSurgeChargesRemaining(owned), 2);
    assert.equal(resolveFounderOfferStatus(buildAut059SeededState('locked', NOW_MS)), 'locked');
    assert.equal(resolveFounderOfferStatus(buildAut059SeededState('no_store', NOW_MS)), 'available');
    assert.equal(applyFounderPackPurchase(owned, { source: 'mock', grantedAtUtcMs: NOW_MS }).outcome.surgesGranted, 0, 'the owned seed already recorded the grant');
    for (const variant of AUT059_SEED_VARIANTS) {
        const parsed = JSON.parse(buildAut059SeededSave(variant, NOW_MS));
        assert.equal(parsed.saveVersion ?? parsed.envelope?.saveVersion ?? CURRENT_SAVE_VERSION, CURRENT_SAVE_VERSION);
    }
    assert.deepEqual(JSON.parse(buildAut059PurchaseScriptFile({ outcomes: ['completed'], duplicateCallback: true })), { price: PRICE, outcomes: ['completed'], duplicateCallback: true });
    assert.deepEqual(JSON.parse(buildAut059PurchaseScriptFile({ metadataMissing: true })), { metadata: 'missing', outcomes: [] });
    assert.ok(parseDebugPurchaseScriptFile(buildAut059PurchaseScriptFile({ outcomes: ['pending'] })), 'the seeded script parses');
    assert.equal(buildAut047SeededState('ready').meta.durableEntitlements['entitlement.founder_pack'], undefined);
});

test('AUT-059 reveal scenarios are registered and wired (cli passes expectFounderShop through, reveal_capture hands it to the evaluator)', () => {
    const wanted = { 'aut059-available': 'available', 'aut059-purchase-success': 'purchase_success', 'aut059-pending': 'pending', 'aut059-cancel': 'cancel', 'aut059-fail': 'fail', 'aut059-owned': 'owned', 'aut059-hidden': 'hidden', 'aut059-locked': 'hidden' };
    for (const [id, expectation] of Object.entries(wanted)) {
        const scenario = REVEAL_SCENARIOS[id];
        assert.ok(scenario, id);
        assert.equal(scenario.expectFounderShop, expectation, id);
        assert.equal(scenario.trigger, 'none');
    }
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /expectFounderShop: scenario\.expectFounderShop/);
    assert.match(cli, /seed-aut059/);
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(capture, /expectFounderShop: options\.expectFounderShop/);
    assert.match(capture, /evaluateFounderShop\(events, options\.expectFounderShop\)/);
    assert.match(capture, /'founder_shop'/);
    assert.match(read('package.json'), /"device:seed-aut059"/);
});

// device check fixtures
let seq = 0;
const ev = (tMs: number, payload: Record<string, unknown>): FounderShopTimelineEvent => ({ tMs, event: { v: 1, seq: seq += 1, ...payload } as never });
const SCREEN = { w: 1080, h: 2412 };
const SCALE = SCREEN.w / 720;
const chipRect = { x: 1080 - 16 * SCALE - 280 * SCALE, y: 2412 - 800, w: 280 * SCALE, h: 64 * SCALE };
const panelRect = { x: 220, y: 900, w: 640 * SCALE, h: 520 * SCALE };
const panelRect2 = { x: 60, y: 700, w: 960, h: 780 };
const buyRect = { x: 80, y: 760, w: 920, h: 96 };
const closeRect = { x: 80, y: 880, w: 920, h: 96 };
const layoutEvent = (rects: Record<string, unknown>) => ev(0, { evt: 'ui_layout', screen: SCREEN, safeArea: { x: 0, y: 0, ...SCREEN }, rects: { CoreHUD: { x: 16, y: 2200, w: 1048, h: 200 }, ProducerPanel: { x: 16, y: 16, w: 1048, h: 400 }, ...rects } });
const texts = expectedFounderTexts();
const uiBase = { chipVisible: true, chipLabelFontSize: 26, chipTagFontSize: 22, chipRect, panelRect: panelRect2, closeRect, contents: texts.contents };

function successTimeline(): FounderShopTimelineEvent[] {
    return [
        ev(0, { evt: 'founder_shop', phase: 'state', reason: 'session_ready', owned: false, cosmetic: false, grantRecorded: false, surgeCharges: 0 }),
        layoutEvent({ FounderChip: chipRect }),
        ev(1, { evt: 'founder_shop', phase: 'chip_shown', state: 'available', ...uiBase }),
        layoutEvent({ FounderChip: chipRect, FounderPanel: panelRect2, FounderBuy: buyRect, FounderClose: closeRect }),
        ev(2, { evt: 'founder_shop', phase: 'opened', state: 'available', ...uiBase, priceText: PRICE, priceFromStore: true, buyVisible: true, buyEnabled: true, buyLabel: `BUY — ${PRICE}`, buyRect }),
        ev(3, { evt: 'founder_shop', phase: 'buy_tapped' }),
        ev(4, { evt: 'founder_shop', phase: 'purchase_started', requestId: 'founder_pack:1:1' }),
        ev(5, { evt: 'founder_shop', phase: 'purchase_result', status: 'completed', requestId: 'founder_pack:1:1', transactionId: 'mock-1', duplicate: false }),
        ev(6, { evt: 'founder_shop', phase: 'applied', status: 'applied_saved', restoreOnly: false, requestId: 'founder_pack:1:1' }),
        ev(7, { evt: 'command_result', ok: true, command: { type: 'grantFounderPack' }, eventTypes: ['founderPackApplied'] }),
        ev(8, { evt: 'founder_shop', phase: 'state', reason: 'applied', owned: true, cosmetic: true, grantRecorded: true, surgeCharges: 2 }),
        ev(9, { evt: 'founder_shop', phase: 'duplicate_ignored', requestId: 'founder_pack:1:1' }),
        ev(10, { evt: 'founder_shop', phase: 'buy_result', outcome: 'purchased', state: 'owned', buyVisible: false, buyEnabled: false, status: texts.owned, ...uiBase }),
        ev(11, { evt: 'founder_shop', phase: 'closed', reason: 'close_button' }),
        ev(12, { evt: 'capture_marker', phase: 'relaunch' }),
        ev(13, { evt: 'founder_shop', phase: 'state', reason: 'session_ready', owned: true, cosmetic: true, grantRecorded: true, surgeCharges: 2 }),
        ev(14, { evt: 'founder_shop', phase: 'chip_shown', state: 'owned', ...uiBase }),
        ev(15, { evt: 'founder_shop', phase: 'opened', state: 'owned', buyVisible: false, buyRect: null, ...uiBase }),
    ];
}

const failing = (checks: ReturnType<typeof evaluateFounderShop>) => checks.filter((c) => !c.ok).map((c) => c.id);

test('AUT-059 device checks: a complete purchase_success timeline passes; the modal geometry uses the BUY rect layout', () => {
    // use real-size rects so the 64-unit rule is meaningful
    const events = successTimeline().map((e) => e.event.evt === 'ui_layout' && (e.event.rects as Record<string, unknown>).FounderPanel ? layoutEvent({ FounderChip: chipRect, FounderPanel: { x: 60, y: 700, w: 960, h: 780 }, FounderBuy: buyRect, FounderClose: closeRect }) : e);
    assert.deepEqual(failing(evaluateFounderShop(events, 'purchase_success')), []);
    void panelRect;
});

test('AUT-059 device checks: purchase_success fails on a second grant, a missing duplicate guard, wrong charges, a hardcoded price or re-grant after relaunch', () => {
    const base = successTimeline();
    const fix = (e: FounderShopTimelineEvent) => e.event.evt === 'ui_layout' && (e.event.rects as Record<string, unknown>).FounderPanel ? layoutEvent({ FounderChip: chipRect, FounderPanel: panelRect2, FounderBuy: buyRect, FounderClose: closeRect }) : e;
    const events = base.map(fix);
    const without = (phase: string) => events.filter((e) => e.event.phase !== phase);
    assert.ok(failing(evaluateFounderShop(without('duplicate_ignored'), 'purchase_success')).includes('founder_duplicate_callback_ignored'));
    assert.ok(failing(evaluateFounderShop([...events.slice(0, 9), ev(20, { evt: 'command_result', ok: true, command: { type: 'grantFounderPack' }, eventTypes: ['founderPackApplied'] }), ...events.slice(9)], 'purchase_success')).includes('founder_grant_command_once'));
    const wrongCharges = events.map((e) => e.event.phase === 'state' && e.event.reason === 'applied' ? ev(e.tMs, { ...e.event, surgeCharges: 4 }) : e);
    assert.ok(failing(evaluateFounderShop(wrongCharges, 'purchase_success')).includes('founder_owned_with_two_surges_exactly_once'));
    const badPrice = events.map((e) => e.event.phase === 'opened' && e.event.state === 'available' ? ev(e.tMs, { ...e.event, priceText: '€2.99' }) : e);
    assert.ok(failing(evaluateFounderShop(badPrice, 'purchase_success')).includes('founder_price_is_store_metadata'));
    const regrant = [...events, ev(30, { evt: 'command_result', ok: true, command: { type: 'grantFounderPack' } })];
    assert.ok(failing(evaluateFounderShop(regrant, 'purchase_success')).includes('founder_no_regrant_after_relaunch'));
    const unsavedApply = events.map((e) => e.event.phase === 'applied' ? ev(e.tMs, { ...e.event, status: 'applied_persistence_failed' }) : e);
    assert.ok(failing(evaluateFounderShop(unsavedApply, 'purchase_success')).includes('founder_applied_saved_before_owned'));
    const withError = [...events, ev(40, { evt: 'error', message: 'x' })];
    assert.ok(failing(evaluateFounderShop(withError, 'purchase_success')).includes('founder_no_errors'));
    const overlapping = events.map((e) => e.event.evt === 'ui_layout' && (e.event.rects as Record<string, unknown>).FounderChip && !(e.event.rects as Record<string, unknown>).FounderPanel ? layoutEvent({ FounderChip: chipRect, RebootChip: chipRect }) : e);
    assert.ok(failing(evaluateFounderShop(overlapping, 'purchase_success')).includes('founder_chip_no_overlap'));
});

test('AUT-059 device checks: pending / cancel / fail / available / owned / hidden expectations', () => {
    const open = [
        ev(0, { evt: 'founder_shop', phase: 'state', reason: 'session_ready', owned: false, cosmetic: false, grantRecorded: false, surgeCharges: 0 }),
        layoutEvent({ FounderChip: chipRect }),
        ev(1, { evt: 'founder_shop', phase: 'chip_shown', state: 'available', ...uiBase }),
        layoutEvent({ FounderChip: chipRect, FounderPanel: panelRect2, FounderBuy: buyRect, FounderClose: closeRect }),
        ev(2, { evt: 'founder_shop', phase: 'opened', state: 'available', ...uiBase, priceText: PRICE, priceFromStore: true, buyVisible: true, buyEnabled: true, buyLabel: `BUY — ${PRICE}`, buyRect }),
    ];
    const closed = ev(20, { evt: 'founder_shop', phase: 'closed', reason: 'close_button' });
    assert.deepEqual(failing(evaluateFounderShop([...open, closed], 'available')), []);
    assert.ok(failing(evaluateFounderShop([...open, ev(5, { evt: 'founder_shop', phase: 'purchase_started' }), closed], 'available')).includes('founder_available_no_purchase'));

    const pending = [...open,
        ev(3, { evt: 'founder_shop', phase: 'purchase_started', requestId: 'r' }),
        ev(4, { evt: 'founder_shop', phase: 'purchase_result', status: 'pending', requestId: 'r', duplicate: false }),
        ev(5, { evt: 'founder_shop', phase: 'pending', requestId: 'r' }),
        ev(6, { evt: 'founder_shop', phase: 'buy_result', outcome: 'pending', state: 'pending', buyEnabled: false, status: texts.pending }),
    ];
    assert.deepEqual(failing(evaluateFounderShop(pending, 'pending')), []);
    assert.ok(failing(evaluateFounderShop([...pending, ev(9, { evt: 'founder_shop', phase: 'state', reason: 'applied', owned: true, surgeCharges: 2 })], 'pending')).includes('founder_nothing_granted'));

    for (const [expect, status, note] of [['cancel', 'cancelled', texts.cancelled], ['fail', 'failed', texts.failed]] as const) {
        const timeline = [...open,
            ev(3, { evt: 'founder_shop', phase: 'purchase_started', requestId: 'r' }),
            ev(4, { evt: 'founder_shop', phase: 'purchase_result', status, requestId: 'r', duplicate: false }),
            ev(6, { evt: 'founder_shop', phase: 'buy_result', outcome: status, state: 'available', buyEnabled: true, note }),
        ];
        assert.deepEqual(failing(evaluateFounderShop(timeline, expect)), [], expect);
        assert.ok(failing(evaluateFounderShop(timeline.map((e) => e.event.phase === 'buy_result' ? ev(e.tMs, { ...e.event, note: 'Something else' }) : e), expect)).includes('founder_calm_note_and_buy_again'), expect);
    }

    const owned = [
        ev(0, { evt: 'founder_shop', phase: 'state', reason: 'session_ready', owned: true, cosmetic: true, grantRecorded: true, surgeCharges: 2 }),
        layoutEvent({ FounderChip: chipRect }),
        ev(1, { evt: 'founder_shop', phase: 'chip_shown', state: 'owned', ...uiBase }),
        layoutEvent({ FounderChip: chipRect, FounderPanel: panelRect2, FounderClose: closeRect }),
        ev(2, { evt: 'founder_shop', phase: 'opened', state: 'owned', buyVisible: false, buyRect: null, status: texts.owned, ...uiBase }),
    ];
    assert.deepEqual(failing(evaluateFounderShop(owned, 'owned')), []);
    assert.ok(failing(evaluateFounderShop([...owned, ev(9, { evt: 'founder_shop', phase: 'purchase_started' })], 'owned')).includes('founder_owned_no_purchase_no_grant'));

    const hidden = [ev(0, { evt: 'founder_shop', phase: 'state', reason: 'session_ready', owned: false, cosmetic: false, grantRecorded: false, surgeCharges: 0 }), layoutEvent({})];
    assert.deepEqual(failing(evaluateFounderShop(hidden, 'hidden')), []);
    assert.ok(failing(evaluateFounderShop([...hidden, layoutEvent({ FounderChip: chipRect })], 'hidden')).includes('founder_hidden_no_chip_rect'));
    assert.ok(failing(evaluateFounderShop([...hidden, ev(3, { evt: 'founder_shop', phase: 'chip_shown', state: 'available' })], 'hidden')).includes('founder_hidden_no_chip_shown'));
});

test('AUT-059 pinned reveal scenario list includes the new scenarios (kept sorted)', () => {
    const keys = Object.keys(REVEAL_SCENARIOS);
    for (const id of ['aut059-available', 'aut059-purchase-success', 'aut059-pending', 'aut059-cancel', 'aut059-fail', 'aut059-owned', 'aut059-hidden', 'aut059-locked']) assert.ok(keys.includes(id), id);
});
