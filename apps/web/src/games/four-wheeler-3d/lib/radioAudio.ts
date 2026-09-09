/** Optional radio owns and releases its nodes; a failed audio device never breaks the game. */
export function startRadio(
  notes: readonly number[],
  wave: OscillatorType,
  unavailable: () => void,
) {
  let context: AudioContext | null = null,
    timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false,
    beat = 0;
  const nodes = new Set<AudioNode>();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
    nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        /* Already released. */
      }
    });
    nodes.clear();
    if (context) {
      try {
        void context.close().catch(() => {});
      } catch {
        /* Device already closed. */
      }
    }
  };
  const fail = () => {
    if (stopped) return;
    stop();
    unavailable();
  };
  const play = () => {
    if (stopped || !context) return;
    try {
      const oscillator = context.createOscillator();
      nodes.add(oscillator);
      const gain = context.createGain();
      nodes.add(gain);
      const time = context.currentTime;
      oscillator.type = wave;
      oscillator.frequency.value = notes[beat++ % notes.length];
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.06, time + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        nodes.delete(oscillator);
        nodes.delete(gain);
      };
      oscillator.start(time);
      oscillator.stop(time + 0.45);
    } catch {
      fail();
    }
  };
  try {
    context = new AudioContext();
    void context
      .resume()
      .then(() => {
        if (stopped) return;
        play();
        if (!stopped) timer = setInterval(play, 450);
      })
      .catch(fail);
  } catch {
    fail();
  }
  return stop;
}
