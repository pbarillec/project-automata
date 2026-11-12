# AUT-INFRA-002 Live reveal evidence capture

Tooling only (no game, runtime or presentation change). Owner request 2026-11-12: future visual gates should capture enough device evidence to review live construction / reveal and
camera focus automatically where possible, escalating only genuinely subjective decisions (CLAUDE.md "Review policy").

- `npm run device:reveal-capture [-- --label <l> --trigger none|next-goal --serial <id>]` (`tools/device/reveal_capture.ts`, DEBUG FactoryWorld APK already installed): starts logcat, seeds the AUT-043
  `unbuilt` save and launches, waits for `ui_layout`, takes a baseline frame, taps the HUD Next Goal action (coordinates from the `ui_layout` rects), then burst-captures ~9 s of native PNG frames
  (about one frame every 0.5 s, adb screencap latency) together with a timestamped `[AUT-DEVICE]` event timeline. Output: `temp/reveal/<label>-<time>/{frames/NNN-phase.png, timeline.json, summary.md, logcat.txt}`.
- Objective checks (pure, unit-tested in `tests/reveal_capture.test.ts`): `ui_layout` ready, trigger sent, zero `error` events, >= 4 frames, `construction_state` started then activated for the producer
  (gap <= 6 s, sequence is 1.5-3 s), construction after the trigger, `camera_focus` reveal started then settled/cancelled (by event order). Exit code 0 = all PASS.
- Review flow: the frames + timeline go first to the vision-capable `scene-presentation` agent (per-frame presence, framing/clipping, readability, sparks/staging visible during the build, regressions). Motion smoothness,
  perceived timing and "does it feel good" are not provable from ~2 fps stills: those stay HUMAN_REVIEW_REQUIRED (subjective) and are asked as one question.
- Limits: the trigger is the Next Goal action, so it covers breakthrough-driven reveals (AUT-043 Automated Cell; future era/robot reveals). Producer-panel builds (Robot Line) need a producer selection tap and are not
  automated yet; use the seeds (`device:seed-aut04x`) for state stills. Frame cadence is bounded by `adb screencap`; use `adb shell screenrecord` manually if a video is needed.
- The AUT-043 `unbuilt` seed now also owns Factory Control System so that the HUD Next Goal is the Automated Cell Architecture breakthrough (before this the first capture bought Factory Control System).
