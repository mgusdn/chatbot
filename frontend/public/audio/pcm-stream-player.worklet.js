class PcmStreamPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0;
    this.receivedAudio = false;
    this.reportedDrained = true;
    this.port.onmessage = (event) => {
      if (event.data?.type === "push" && event.data.samples?.length) {
        this.chunks.push(event.data.samples);
        this.receivedAudio = true;
        this.reportedDrained = false;
      } else if (event.data?.type === "reset") {
        this.chunks = [];
        this.offset = 0;
        this.receivedAudio = false;
        this.reportedDrained = true;
      } else if (event.data?.type === "check-drain") {
        if (this.chunks.length === 0) {
          // The producer may finish immediately after a temporary underrun.
          // Re-confirm the empty state even when that underrun was reported.
          this.port.postMessage({ type: "drained" });
        } else {
          this.reportDrainIfNeeded();
        }
      }
    };
  }

  reportDrainIfNeeded() {
    if (this.chunks.length === 0 && this.receivedAudio && !this.reportedDrained) {
      this.reportedDrained = true;
      this.receivedAudio = false;
      this.port.postMessage({ type: "drained" });
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    let destination = 0;
    while (destination < output.length && this.chunks.length > 0) {
      const chunk = this.chunks[0];
      const count = Math.min(output.length - destination, chunk.length - this.offset);
      output.set(chunk.subarray(this.offset, this.offset + count), destination);
      destination += count;
      this.offset += count;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    this.reportDrainIfNeeded();
    return true;
  }
}

registerProcessor("pcm-stream-player", PcmStreamPlayer);
