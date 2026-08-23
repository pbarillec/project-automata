# AUT-037 Producer Panel

The selected-producer panel is a presentation projection over `GameConfigRepository`
and an immutable `GameState` snapshot. `ProducerPanelViewModel` delegates purchase
resolution to AUT-008/AUT-013 progression APIs, including construction-adjusted costs
and authoritative MAX resolution. It does not mutate state or calculate economy
formulas.

The Cocos controller renders one compact card and emits `buyProducerLevels` or
`buyMaxProducerLevels` through its command emitter. The runtime remains responsible
for success/rejection and state refresh. Milestone previews read the configured,
ordered milestone list and safely expose a completed state after the last entry.

Player-facing text is represented by localization-ready keys. The panel is attached
once below `CoreHudCanvas/ProducerPanel`; AUT-036 Core HUD remains a separate node.
