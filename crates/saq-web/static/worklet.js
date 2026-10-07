// SPDX-License-Identifier: MPL-2.0

const PARAM_VOLUME = 0;
const PARAM_SUBWOOFER = 1;

const PARAM_NAMES = ["volume", "subwoofer"];

const PARAM_DEFAULTS = [1, 1];

class SaqProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "volume", defaultValue: 1, minValue: 0, maxValue: 2, automationRate: "k-rate" },
      { name: "subwoofer", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor(options) {
    super();

    const wasm = options.processorOptions?.wasm;
    this.exports = null;
    this.layout = null;
    this.floats = null;
    this.pending = [];

    this.port.onmessage = (event) => this.onMessage(event.data);

    WebAssembly.instantiate(wasm, {})
      .then(({ instance }) => {
        const exports = instance.exports;
        const maxFrames = exports.saq_max_frames();

        const scratchBytes = exports.saq_scratch_ptr() >>> 0;
        const base = scratchBytes >>> 2;
        const freqsBytes = exports.saq_scratch_freqs_ptr() >>> 0;
        const gainsBytes = exports.saq_scratch_gains_ptr() >>> 0;

        this.exports = exports;
        this.layout = {
          inL: base,
          inR: base + maxFrames,
          outL: base + maxFrames * 2,
          outR: base + maxFrames * 3,
          freqs: freqsBytes >>> 2,
          gains: gainsBytes >>> 2,
          freqsBytes,
          gainsBytes,
          maxFrames,
        };

        exports.saq_init();
        this.rebind();

        for (const message of this.pending.splice(0)) {
          this.onMessage(message);
        }

        const engineSampleRate = exports.saq_sample_rate();

        const eqBandCount = exports.saq_eq_band_count();
        const eqBands = new Float32Array(eqBandCount);
        for (let index = 0; index < eqBandCount; index += 1) {
          eqBands[index] = exports.saq_eq_band_frequency(index);
        }

        this.port.postMessage({
          type: "ready",
          sampleRate,
          engineSampleRate,
          rateMatches: sampleRate === engineSampleRate,
          latencyFrames: exports.saq_latency_frames(),
          responseFrames: exports.saq_response_frames(),
          maxFrames,
          presetCount: exports.saq_preset_count(),
          eqPointCount: exports.saq_eq_point_count(),
          eqBandCount,
          eqBands,
        });
      })
      .catch((cause) => {
        this.port.postMessage({ type: "error", message: String(cause) });
        return false;
      });
  }

  rebind() {
    this.floats = new Float32Array(this.exports.memory.buffer);
  }

  onMessage(message) {
    if (!this.exports) {
      this.pending.push(message);
      return;
    }
    switch (message.type) {
      case "eq": {
        const { preset, base, points, freqs, gains } = message;
        this.floats.set(freqs, this.layout.freqs);
        this.floats.set(gains, this.layout.gains);
        this.exports.saq_set_eq(
          preset,
          base,
          points,
          this.layout.freqsBytes,
          this.layout.gainsBytes,
        );
        this.rebind();
        break;
      }
      case "reset": {
        this.exports.saq_reset();
        break;
      }
      case "response": {
        const { preset, frequencies, token } = message;
        this.floats.set(frequencies, this.layout.freqs);
        this.exports.saq_eq_response_db(
          preset,
          this.layout.freqsBytes,
          frequencies.length,
          this.layout.freqsBytes,
        );
        this.rebind();
        const values = this.floats.slice(
          this.layout.freqs,
          this.layout.freqs + frequencies.length,
        );
        this.port.postMessage({ type: "response", token, values }, [values.buffer]);
        break;
      }
      default:
        break;
    }
  }

  param(parameters, index) {
    const fallback = PARAM_DEFAULTS[index] ?? 1;

    const perParam = parameters?.[PARAM_NAMES[index]] ?? parameters?.[index];
    const value = perParam?.[0];
    return Number.isFinite(value) ? value : fallback;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outLeft = output?.[0];
    const outRight = output?.[1];

    if (!outLeft || !outRight) {
      return true;
    }
    if (!this.exports || !this.floats) {
      outLeft.fill(0);
      outRight.fill(0);
      return true;
    }

    const frames = outLeft.length;

    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      outLeft.fill(0);
      outRight.fill(0);
      return true;
    }

    if (frames > this.layout.maxFrames) {
      outLeft.fill(0);
      outRight.fill(0);
      this.port.postMessage({
        type: "error",
        message: `render quantum of ${frames} exceeds the ${this.layout.maxFrames}-frame scratch`,
      });
      return false;
    }

    const view = this.floats;
    const { inL, inR, outL, outR } = this.layout;
    const sourceLeft = input[0];
    const sourceRight = input.length > 1 && input[1] ? input[1] : input[0];

    for (let frame = 0; frame < frames; frame += 1) {
      view[inL + frame] = sourceLeft[frame];
      view[inR + frame] = sourceRight[frame];
    }

    const sub = this.param(parameters, PARAM_SUBWOOFER);
    const vol = this.param(parameters, PARAM_VOLUME);
    this.exports.saq_set_subwoofer(sub);
    this.exports.saq_process(frames, vol);

    outLeft.set(view.subarray(outL, outL + frames));
    outRight.set(view.subarray(outR, outR + frames));

    return true;
  }
}

registerProcessor("saq-processor", SaqProcessor);
