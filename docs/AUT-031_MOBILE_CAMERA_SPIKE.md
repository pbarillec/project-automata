# AUT-031 Mobile Camera Spike

## Purpose

This spike validates a bounded mobile touch camera for the placeholder Cocos Creator 3.8.8 factory scene. It is not the production FactoryWorld implementation and does not add economy, GameState, producer selection, Discord, auth, payments, analytics or final HUD behavior.

## Scene

Dedicated scene:

```text
assets/scenes/camera/CameraSpike.scene
```

The scene uses `CameraSpikeBootstrap` to create placeholder geometry at runtime:

- factory floor and bounded focus area;
- simple block placeholders for Fabricator, Assembly Station, Robot Line, Automated Cell and Advanced Robotics;
- a focus target marker for the Robot Line;
- lightweight UI blocker panels.

The Android debug build config starts from `CameraSpike.scene` for this spike so the existing wrapper can produce a real-device APK for the camera gate.

## Control Scheme

- One-finger drag: orbit around the current focus target.
- Pinch: zoom camera distance.
- Two-finger drag: pan the focus point in camera-relative ground-plane space.
- Tap: emitted only when the touch ends below the drag threshold.
- UI touch consumption: touches beginning inside registered UI blocker nodes do not orbit, pan, zoom or emit world taps.
- Focus demo: the bottom `FOCUS ROBOT LINE` control starts a bounded programmatic focus move.

## Spike Tuning Values

Default values are centralized in `assets/scripts/camera/CameraMath.ts` and exposed on `MobileCameraController`:

| Value | Initial spike setting |
|---|---:|
| Drag threshold | 12 px |
| Pitch range | 30 to 62 degrees |
| Distance range | 7 to 24 world units |
| Default yaw | 135 degrees |
| Default pitch | 48 degrees |
| Default distance | 15 world units |
| Focus X bounds | -9 to 9 |
| Focus Z bounds | -6 to 8 |
| Orbit yaw sensitivity | 0.18 deg/px |
| Orbit pitch sensitivity | 0.12 deg/px |
| Pan sensitivity | 0.0018 units/px/distance |
| Programmatic focus duration | 0.45 s |
| Yaw behavior | deterministic wrap to 0..360 |

These are spike values, not product constants.

## Implementation Notes

- Pure camera math and touch interpretation live under `assets/scripts/camera` and do not import Cocos runtime or GameState.
- `MobileCameraController` adapts Cocos touch events to the pure model and applies camera transforms.
- Pinch zoom ignores invalid or zero previous distances rather than producing non-finite distance.
- Multi-touch entry cancels one-finger tap candidates and locks one-finger handling until all touches are released.
- Manual orbit/pan/zoom cancels active programmatic focus through the same focus-transition helper covered by tests.
- Pan is camera-relative and uses a "content follows the fingers" model: screen-space drag maps to bounded ground-plane focus translation.
- Focus-to-target clamps to the same focus rectangle as manual pan.

## Automated Coverage

Added tests cover:

- pitch, distance and focus clamp math;
- invalid pinch zoom safety;
- camera-relative bounded pan;
- bounded focus target and transition math;
- user-input focus interruption helper;
- tap-vs-drag threshold;
- drag cannot later emit tap;
- multi-touch transition reset/lock behavior;
- UI-consumed touch suppression;
- structural scene/build inclusion smoke check;
- camera/presentation scripts avoid gameplay state and economy references.

## Known Limitations

- No production art or final FactoryWorld layout is included.
- The placeholder tap is only a debug-level signal in the controller; AUT-035 owns real producer raycast/selection.
- The UI blockers are simple rectangular Cocos UI nodes, not the final HUD.
- Automated tests cannot validate camera feel, readability, safe-area ergonomics or device-specific touch conflicts.

## Real Android Device Checklist

Final AUT-031 approval must be deferred until a human runs the debug APK on a physical Android device and verifies:

1. One-finger orbit feels readable from the default three-quarter view.
2. Pitch bounds prevent broken top-down or low editor-like angles.
3. Pinch zoom stays useful and never clips into the placeholder factory.
4. Two-finger pan feels intentional and remains inside the visible factory area.
5. Tap does not fire after a deliberate drag.
6. Multi-touch start/end/cancel does not leave stale one-finger drag state.
7. `FOCUS ROBOT LINE` frames the marker and can be interrupted immediately by direct touch input.
8. Touches starting on the status panel or focus button do not move the camera or emit world taps.
9. The factory remains spatially readable on the target phone.
10. If the camera feels too much like a 3D editor, first constrain in this order: reduce pan range, reduce yaw sensitivity/range, narrow zoom range, then consider fixed focus presets.

No automated result should be treated as camera UX acceptance.
