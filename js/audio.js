// The game's sounds through Web Audio: one-shots, and loops (crowd, drums, birdsong) whose
// levels the match sets. Browsers only start audio after a tap, so it waits for one.
const NAMES = ['bat_hard', 'bat_soft', 'edge', 'bounce', 'pad', 'stumps', 'catch', 'swish', 'throw', 'rope', 'cheer', 'roar', 'groan',
  'ooh', 'applause', 'howzat', 'horns', 'wicket', 'lights', 'tap', 'star', 'coin', 'win', 'lose', 'toss'];
const BEDS = ['crowd', 'drums', 'birds'];

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.beds = {};
    this.levels = {};
    this.muted = localStorage.getItem('superover.muted') === '1';
  }

  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.ctx = new Context();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(this.ctx.destination);
    const load = async (name, file) => {
      try {
        const data = await (await fetch(`sounds/${file}.m4a`)).arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(data);
      } catch {
        // A missing sound isn't worth stopping the game for.
      }
    };
    await Promise.all([...NAMES.map((n) => load(n, n)), ...BEDS.map((b) => load('bed_' + b, 'bed_' + b))]);
    for (const bed of BEDS) {
      const buffer = this.buffers['bed_' + bed];
      if (!buffer) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = this.levels[bed] ?? 0;
      source.connect(gain).connect(this.master);
      source.start();
      this.beds[bed] = gain;
    }
  }

  play(name, volume = 1) {
    if (!this.ctx || this.muted) return;
    const buffer = this.buffers[name];
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = Math.min(1, Math.max(0, volume));
    source.connect(gain).connect(this.master);
    source.start();
  }

  bed(name, level) {
    this.levels[name] = level;
    const gain = this.beds[name];
    if (gain && this.ctx) gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.25);
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem('superover.muted', muted ? '1' : '0');
    if (this.master) this.master.gain.value = muted ? 0 : 0.85;
  }
}
