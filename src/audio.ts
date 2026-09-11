import type { Settings } from "./save";
export class Sound {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  bed: GainNode | null = null;
  noise: AudioBuffer | null = null;
  ambience: AudioBufferSourceNode | null = null;
  settings: Settings;
  tracks = ["/music/yque-fue.mp3", "/music/waka-waka.mp3", "/music/daidai.mp3"];
  track = 0;
  soundtrack: HTMLAudioElement | null = null;
  soundtrackSource: MediaElementAudioSourceNode | null = null;
  soundtrackGain: GainNode | null = null;
  musicEnabled = true;
  failedTracks = new Set<number>();
  onMusicChange = () => {};
  constructor(settings: Settings) {
    this.settings = settings;
  }
  async start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.soundtrack = new Audio();
      this.soundtrack.preload = "none";
      this.soundtrackSource = this.context.createMediaElementSource(this.soundtrack);
      this.soundtrackGain = this.context.createGain();
      this.soundtrackSource.connect(this.soundtrackGain);
      this.soundtrackGain.connect(this.master);
      this.soundtrack.onended = () => this.nextTrack();
      this.soundtrack.onplay = () => this.onMusicChange();
      this.soundtrack.onpause = () => this.onMusicChange();
      this.soundtrack.onerror = () => {
        console.warn("Could not load soundtrack:", this.tracks[this.track]);
        this.failedTracks.add(this.track);
        this.nextTrack();
      };
      this.noise = this.context.createBuffer(
        1,
        this.context.sampleRate * 2,
        this.context.sampleRate,
      );
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.bed = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 520;
      this.ambience = this.context.createBufferSource();
      this.ambience.buffer = this.noise;
      this.ambience.loop = true;
      this.ambience.connect(filter);
      filter.connect(this.bed);
      this.bed.connect(this.master);
      this.ambience.start();
    }
    if (this.context.state === "suspended") await this.context.resume();
    this.update(this.settings);
    this.resumeMusic();
  }
  update(s: Settings) {
    this.settings = s;
    if (this.context && this.soundtrackGain)
      this.soundtrackGain.gain.setTargetAtTime(s.music, this.context.currentTime, 0.08);
    if (this.context && this.master && this.bed) {
      this.master.gain.setTargetAtTime(
        s.volume,
        this.context.currentTime,
        0.08,
      );
      this.bed.gain.setTargetAtTime(
        s.crowd * 0.065,
        this.context.currentTime,
        0.3,
      );
    }
  }
  noiseHit(duration: number, gain: number, freq: number) {
    const c = this.context;
    if (!c || !this.master) return;
    const source = c.createBufferSource();
    source.buffer = this.noise;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    source.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    source.start();
    source.stop(c.currentTime + duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }
  tone(
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType = "sine",
  ) {
    const c = this.context;
    if (!c || !this.master) return;
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(
      freq * 0.65,
      c.currentTime + duration,
    );
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(c.currentTime + duration);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  play(event: string) {
    if (!this.context) return;
    if (event === "kick" || event === "shot") {
      this.noiseHit(0.045, event === "shot" ? 0.16 : 0.1, 2200);
      this.tone(190, 0.055, event === "shot" ? 0.075 : 0.045);
    }
    if (event === "receive" || event === "contact")
      this.noiseHit(0.045, 0.075, 1500);
    if (event === "post") {
      this.tone(630, 0.65, 0.3, "triangle");
      this.tone(1230, 0.4, 0.14);
    }
    if (event === "goal") {
      this.noiseHit(3, 1.1 * this.settings.crowd, 1700);
      this.noiseHit(0.35, 0.3, 4000);
      this.tone(440, 0.5, 0.08);
      this.tone(660, 0.9, 0.07);
    }
    if (event === "miss") this.noiseHit(0.9, 0.25 * this.settings.crowd, 370);
    if (event === "ui") this.tone(750, 0.05, 0.06);
    if (event === "whistle") this.tone(2400, 0.3, 0.08);
    if (
      this.settings.vibration &&
      navigator.vibrate &&
      ["kick", "post", "goal"].includes(event)
    )
      navigator.vibrate(event === "goal" ? [25, 40, 35] : 15);
  }
  setMusicEnabled(active: boolean) {
    this.musicEnabled = active;
    if (active) this.resumeMusic();
    else this.soundtrack?.pause();
    this.onMusicChange();
  }
  resumeMusic() {
    const audio = this.soundtrack;
    if (!audio || !this.musicEnabled || this.context?.state !== "running" ||
        this.failedTracks.size === this.tracks.length) return;
    if (!audio.getAttribute("src")) audio.src = this.tracks[this.track];
    if (audio.paused) void audio.play().catch((error: unknown) => {
      // A pause or track change can cancel a pending play request.
      if (!(error instanceof DOMException && error.name === "AbortError"))
        console.warn("Music playback unavailable; retry on the next interaction.", error);
      this.onMusicChange();
    });
  }
  nextTrack() {
    if (!this.soundtrack || this.failedTracks.size === this.tracks.length) return;
    do { this.track = (this.track + 1) % this.tracks.length; }
    while (this.failedTracks.has(this.track));
    this.soundtrack.src = this.tracks[this.track];
    this.onMusicChange();
    this.resumeMusic();
  }
  selectTrack(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.tracks.length) return;
    this.track = index;
    this.failedTracks.delete(index);
    if (this.soundtrack) this.soundtrack.src = this.tracks[index];
    this.onMusicChange();
    this.resumeMusic();
  }
  suspend() {
    this.soundtrack?.pause();
    void this.context?.suspend();
  }
  dispose() {
    this.musicEnabled = false;
    if (this.soundtrack) {
      this.soundtrack.onended = null;
      this.soundtrack.onerror = null;
      this.soundtrack.onplay = null;
      this.soundtrack.onpause = null;
      this.soundtrack.pause();
      this.soundtrack.removeAttribute("src");
      this.soundtrack.load();
      this.soundtrack = null;
    }
    this.soundtrackSource?.disconnect();
    this.onMusicChange = () => {};
    this.soundtrackGain?.disconnect();
    this.ambience?.stop();
    this.ambience?.disconnect();
    this.bed?.disconnect();
    this.master?.disconnect();
    void this.context?.close();
  }
}
