const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

test('cue set is exactly the seven AUT-052 cues', async () => {
    const { AUDIO_CUES } = await imp('assets/scripts/services/AudioService.ts');
    assert.deepEqual([...AUDIO_CUES], ['purchase', 'milestone', 'robot_built', 'era_transition', 'overclock', 'reboot', 'ui_tap']);
});

test('MockAudioService records cues, honours the SFX flag and the music flag', async () => {
    const { MockAudioService } = await imp('assets/scripts/platform/mock/MockAudioService.ts');
    const audio = new MockAudioService();
    audio.playSfx('purchase');
    audio.playSfx('milestone');
    assert.deepEqual(audio.playedCues, ['purchase', 'milestone']);
    audio.setSfxEnabled(false);
    audio.playSfx('reboot');
    assert.deepEqual(audio.playedCues, ['purchase', 'milestone'], 'SFX off: nothing recorded');
    audio.setSfxEnabled(true);
    audio.playSfx('ui_tap');
    assert.equal(audio.playedCues.length, 3);
    audio.startMusic();
    assert.equal(audio.musicPlaying, true);
    audio.setMusicEnabled(false);
    assert.equal(audio.musicPlaying, false, 'disabling music stops it');
    audio.startMusic();
    assert.equal(audio.musicPlaying, false, 'music off: start is ignored');
    audio.applySettings({ musicEnabled: true, sfxEnabled: false });
    assert.equal(audio.musicEnabled, true);
    assert.equal(audio.sfxEnabled, false);
    audio.startMusic();
    audio.stopMusic();
    assert.equal(audio.musicPlaying, false);
});

test('SilentAudioService never throws, even for bad input, and remembers the flags', async () => {
    const { SilentAudioService } = await imp('assets/scripts/platform/noop/SilentAudioService.ts');
    const audio = new SilentAudioService();
    assert.doesNotThrow(() => {
        audio.playSfx('purchase');
        audio.playSfx('not_a_cue');
        audio.startMusic();
        audio.stopMusic();
        audio.setMusicEnabled(false);
        audio.setSfxEnabled(false);
        audio.applySettings({ musicEnabled: true, sfxEnabled: true });
        audio.applySettings({});
    });
    audio.applySettings({ musicEnabled: false, sfxEnabled: true });
    assert.equal(audio.isMusicEnabled(), false);
    assert.equal(audio.isSfxEnabled(), true);
});

test('cue mapper: table of event type to cue; unmapped events (and bad input) give null', async () => {
    const { mapEventToCue, mapEventsToCues, AUDIO_CUE_BY_EVENT_TYPE } = await imp('assets/scripts/presentation/AudioCueMapper.ts');
    const { AUDIO_CUES } = await imp('assets/scripts/services/AudioService.ts');
    assert.deepEqual({ ...AUDIO_CUE_BY_EVENT_TYPE }, {
        producerLevelsPurchased: 'purchase',
        breakthroughPurchased: 'purchase',
        permanentUpgradePurchased: 'purchase',
        producerMilestoneReached: 'milestone',
        producerConstructed: 'milestone',
        firstRobotProduced: 'robot_built',
        robotsBuiltThresholdReached: 'robot_built',
        eraChanged: 'era_transition',
        temporaryBoostActivated: 'overclock',
        rebootCompleted: 'reboot',
    });
    for (const cue of Object.values(AUDIO_CUE_BY_EVENT_TYPE)) assert.ok(AUDIO_CUES.includes(cue));
    for (const [type, cue] of Object.entries(AUDIO_CUE_BY_EVENT_TYPE)) assert.equal(mapEventToCue({ type }), cue, type);
    for (const type of ['industrialOutputChanged', 'productionGranted', 'aiCoreBalanceChanged', 'civilizationChanged', 'temporaryBoostExpired', 'toString', '__proto__']) assert.equal(mapEventToCue({ type }), null, type);
    for (const bad of [null, undefined, {}, { type: 5 }]) assert.equal(mapEventToCue(bad), null);
    assert.deepEqual(mapEventsToCues([{ type: 'productionGranted' }, { type: 'aiCoreBalanceChanged' }, { type: 'permanentUpgradePurchased' }, { type: 'breakthroughPurchased' }, { type: 'rebootCompleted' }]), ['purchase', 'reboot'], 'consecutive duplicates collapse');
    assert.equal(AUDIO_CUES.includes('ui_tap') && Object.values(AUDIO_CUE_BY_EVENT_TYPE).includes('ui_tap'), false, 'ui_tap is UI-driven, not event-driven');
});

test('the cue mapper is pure and the audio service has no engine import', () => {
    for (const rel of ['assets/scripts/presentation/AudioCueMapper.ts', 'assets/scripts/services/AudioService.ts', 'assets/scripts/services/HapticsService.ts', 'assets/scripts/platform/noop/SilentAudioService.ts', 'assets/scripts/platform/mock/MockAudioService.ts']) {
        assert.doesNotMatch(stripComments(read(rel)), /from\s+['"]cc['"]|AudioSource|native\./, rel);
    }
});

test('gameplay modules never import audio, haptics or settings (the runtime is unaware of them)', () => {
    const dirs = ['config', 'domain', 'state', 'economy', 'progression', 'runtime', 'persistence', 'time', 'offline', 'lifecycle', 'simulation'];
    for (const dir of dirs) {
        for (const file of walk(path.join(repoRoot, 'assets', 'scripts', dir))) {
            assert.doesNotMatch(stripComments(fs.readFileSync(file, 'utf8')), /AudioService|HapticsService|AudioCue|SilentAudio|MockAudio|\/settings\/|SettingsStore|UserSettings/, path.relative(repoRoot, file));
        }
    }
});

test('presentation wires audio only through the mapper: observeDomainEvents plays cues, no GameCommand is involved, no asset or bridge is added', () => {
    const bootstrap = stripComments(read('assets/scripts/presentation/FactoryWorldBootstrap.ts'));
    assert.match(bootstrap, /private readonly audio: AudioService = new SilentAudioService\(\);/);
    assert.match(bootstrap, /for \(const cue of mapEventsToCues\(events\)\) this\.audio\.playSfx\(cue\);/);
    assert.doesNotMatch(bootstrap, /AudioSource|AudioClip|resources\.load/);
    assert.equal(fs.existsSync(path.join(repoRoot, 'assets', 'audio')), false, 'no audio asset ships');
});
