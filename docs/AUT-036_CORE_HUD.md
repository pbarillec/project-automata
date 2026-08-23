# AUT-036 Core HUD

The core HUD is a presentation-only projection of an authoritative `GameState` snapshot.
`createHudViewModel(repository, state)` reads the runtime production query, AUT-019 Next Goal
output, and AUT-016 Free Overclock state. It returns display data and compact formatted strings;
the numeric source values remain unchanged.

`CoreHudController` binds that projection to a compact Cocos UI and emits
`{ type: 'activateFreeOverclock' }` through its command emitter only when the snapshot says the
action is ready. Runtime rejection remains authoritative.
