import { test } from "node:test";
import assert from "node:assert/strict";
import { Sound } from "../src/audio.ts";

test("site soundtrack starts in menus, selects tracks, preserves pause and releases audio", async () => {
  class AudioMock {
    src = "";
    preload = "";
    paused = true;
    currentTime = 0;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    getAttribute() { return this.src || null; }
    removeAttribute() { this.src = ""; }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    load() {}
  }
  const nodes: { disconnected: boolean; value: number }[] = [];
  const node = () => {
    const state = { disconnected: false, value: 0 };
    nodes.push(state);
    return {
      gain: { setTargetAtTime(value: number) { state.value = value; } },
      frequency: { value: 0 }, connect() {},
      disconnect() { state.disconnected = true; }, start() {}, stop() {},
    };
  };
  class ContextMock {
    state = "running";
    currentTime = 0;
    sampleRate = 2;
    destination = {};
    createGain = node;
    createMediaElementSource = node;
    createBiquadFilter = node;
    createBufferSource = node;
    createBuffer() { return { getChannelData: () => new Float32Array(4) }; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
  }
  const originals = [Object.getOwnPropertyDescriptor(globalThis, "Audio"),
    Object.getOwnPropertyDescriptor(globalThis, "AudioContext")];
  Object.assign(globalThis, { Audio: AudioMock, AudioContext: ContextMock });
  const settings = { volume: 0.6, music: 0.3, crowd: 0.5, vibration: false,
    graphics: "auto" as const, reducedMotion: false };
  const sound = new Sound(settings);
  try {
    await sound.start();
    const audio = sound.soundtrack!;
    assert.equal(audio.getAttribute("src"), "/music/yque-fue.mp3", "music starts without gameplay");
    assert.equal(audio.src, "/music/yque-fue.mp3");
    assert.equal(audio.paused, false);
    audio.currentTime = 42;
    await sound.start();
    assert.equal(audio.currentTime, 42, "retries keep playback position");
    audio.onended!.call(audio, new Event("ended"));
    assert.equal(audio.src, "/music/waka-waka.mp3");
    audio.onended!.call(audio, new Event("ended"));
    assert.equal(audio.src, "/music/daidai.mp3");
    audio.onended!.call(audio, new Event("ended"));
    assert.equal(audio.src, "/music/yque-fue.mp3");
    sound.suspend();
    assert.equal(audio.paused, true);
    await sound.start();
    assert.equal(audio.paused, false);
    sound.update({ ...settings, music: 0 });
    assert.equal(nodes[2].value, 0, "music gain can mute independently");
    assert.equal(nodes[0].value, 0.6, "master volume remains applied");
    sound.setMusicEnabled(false);
    assert.equal(audio.paused, true);
    await sound.start();
    assert.equal(audio.paused, true, "menu interactions do not resume gameplay music");
    sound.selectTrack(2);
    assert.equal(audio.src, "/music/daidai.mp3");
    assert.equal(audio.paused, true, "selecting tracks preserves explicit pause");
    sound.selectTrack(99);
    assert.equal(sound.track, 2, "invalid track indexes are ignored");
    sound.setMusicEnabled(true);
    assert.equal(audio.paused, false);
    sound.dispose();
    assert.equal(audio.onended, null);
    assert.equal(audio.onerror, null);
    assert.equal(audio.src, "");
    assert.equal(nodes[1].disconnected, true);
    assert.equal(nodes[2].disconnected, true);
    assert.equal(sound.context!.state, "closed");
  } finally {
    if (sound.soundtrack) sound.dispose();
    ["Audio", "AudioContext"].forEach((key, i) => {
      if (originals[i]) Object.defineProperty(globalThis, key, originals[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
