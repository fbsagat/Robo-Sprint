class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainPeak = 0.12
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const jitter = 0.92 + Math.random() * 0.16; // +-8% pitch variation
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd * jitter), now + duration);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playJump(): void {
    this.playTone(260, 520, 0.14, 'triangle', 0.1);
  }

  playDash(): void {
    this.playTone(480, 210, 0.14, 'sawtooth', 0.08);
  }

  playSpring(): void {
    this.playTone(320, 960, 0.24, 'sine', 0.14);
  }

  playPickup(): void {
    this.playTone(520, 880, 0.12, 'sine', 0.12);
    setTimeout(() => this.playTone(760, 1180, 0.14, 'triangle', 0.1), 55);
  }

  playTurbo(): void {
    this.playTone(180, 640, 0.3, 'sawtooth', 0.09);
  }

  playShield(): void {
    this.playTone(440, 660, 0.2, 'sine', 0.11);
  }

  playEmp(): void {
    this.playTone(720, 110, 0.28, 'sawtooth', 0.12);
  }

  playRocket(): void {
    this.playTone(280, 140, 0.22, 'square', 0.09);
  }

  playFrost(): void {
    this.playTone(920, 420, 0.2, 'sine', 0.1);
  }

  playMagnet(): void {
    this.playTone(340, 820, 0.22, 'triangle', 0.11);
  }

  playGlitch(): void {
    this.playTone(640, 240, 0.16, 'square', 0.08);
    setTimeout(() => this.playTone(260, 720, 0.14, 'square', 0.08), 70);
  }

  playWarp(): void {
    this.playTone(380, 1160, 0.22, 'sine', 0.12);
  }

  playBarrier(): void {
    this.playTone(220, 480, 0.18, 'square', 0.1);
  }

  playGrease(): void {
    this.playTone(340, 150, 0.2, 'sine', 0.11);
  }

  playWhirlwind(): void {
    this.playTone(280, 1240, 0.32, 'sine', 0.14);
    setTimeout(() => this.playTone(620, 1480, 0.22, 'triangle', 0.11), 60);
  }

  playJetpack(): void {
    this.playTone(190, 740, 0.28, 'sawtooth', 0.11);
    setTimeout(() => this.playTone(520, 1120, 0.24, 'triangle', 0.1), 55);
  }

  playCheckpoint(): void {
    this.playTone(587.33, 880, 0.14, 'triangle', 0.11);
    setTimeout(() => this.playTone(880, 1174.66, 0.18, 'triangle', 0.11), 65);
  }

  playBoostRing(): void {
    this.playTone(420, 980, 0.18, 'sine', 0.12);
    setTimeout(() => this.playTone(740, 1320, 0.16, 'triangle', 0.1), 50);
  }

  playBumper(): void {
    this.playTone(300, 760, 0.16, 'triangle', 0.13);
  }

  playCrystal(): void {
    this.playTone(880, 1318.5, 0.09, 'sine', 0.08);
  }

  playHurt(): void {
    this.playTone(210, 75, 0.25, 'sawtooth', 0.14);
  }

  playFinish(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, n * 1.03, 0.22, 'triangle', 0.14), idx * 90);
    });
  }
}

export const soundEngine = new SoundEngine();
