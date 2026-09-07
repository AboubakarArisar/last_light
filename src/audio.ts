import type { Settings } from "./save";
export class Sound {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  bed: GainNode | null = null;
  noise: AudioBuffer | null = null;
  ambience: AudioBufferSourceNode | null = null;
  settings: Settings;
  musicTimer: number | undefined;
  notes = 0;
  constructor(settings: Settings) {
    this.settings = settings;
  }
  async start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
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
  }
  update(s: Settings) {
    this.settings = s;
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
      this.noiseHit(0.14, event === "shot" ? 0.55 : 0.25, 1400);
      this.tone(110, 0.18, 0.28);
    }
    if (event === "receive" || event === "contact")
      this.noiseHit(0.13, 0.2, 750);
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
  menu(active: boolean) {
    window.clearInterval(this.musicTimer);
    if (!active) return;
    this.musicTimer = window.setInterval(() => {
      if (this.context?.state === "running" && this.settings.music > 0) {
        this.tone(
          [110, 130.81, 146.83, 98][Math.floor(this.notes / 4) % 4],
          0.4,
          0.07 * this.settings.music,
          "triangle",
        );
        if (this.notes % 2 === 0)
          this.noiseHit(0.035, 0.055 * this.settings.music, 2600);
        this.notes++;
      }
    }, 420);
  }
  suspend() {
    void this.context?.suspend();
  }
  dispose() {
    clearInterval(this.musicTimer);
    this.ambience?.stop();
    this.ambience?.disconnect();
    this.bed?.disconnect();
    this.master?.disconnect();
    void this.context?.close();
  }
}
