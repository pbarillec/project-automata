# Android Export Baseline

AUT-004 uses Godot's Gradle-enabled Android export path.

- Gradle build directory: `res://android/build`
- Generated Gradle template files: ignored; recreated by `tools/ci/build_android.ps1` when missing
- Debug APK artifact: `build/android/project-automata-debug-api36.apk`
- Debug AAB artifact: `build/android/project-automata-debug-api36.aab`
- Target SDK: API 36
- Min SDK: intentionally left to the Godot template default until native plugin dependencies are pinned

Signing material is generated locally for debug builds only and must not be committed. Production signing, Play package identity, AdMob, Billing, analytics, and store release configuration remain unresolved for later tasks.
