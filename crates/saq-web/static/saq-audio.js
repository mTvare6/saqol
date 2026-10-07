// SPDX-License-Identifier: MPL-2.0

const PARAM_NAMES = ["volume", "subwoofer"];

export class SaqAudio {
  #context = null;
  #node = null;
  #source = null;
  #info = null;
  #ready;
  #pendingResponse = new Map();
  #responseToken = 0;

  constructor({ workletUrl = "./worklet.js", wasmUrl = "./saq.wasm", sampleRate = 48000 } = {}) {
    this.workletUrl = workletUrl;
    this.wasmUrl = wasmUrl;
    this.requestedSampleRate = sampleRate;
    this.#ready = this.#build();
  }

  get info() {
    return this.#info;
  }

  get context() {
    return this.#context;
  }

  get node() {
    return this.#node;
  }

  async ready() {
    await this.#ready;
    return this.#info;
  }

  async #build() {
    this.#context = new AudioContext({ sampleRate: this.requestedSampleRate });

    const [wasm, workletUrl] = await Promise.all([
      fetch(this.wasmUrl).then((response) => {
        if (!response.ok) {
          throw new Error(`fetching ${this.wasmUrl}: ${response.status}`);
        }
        return response.arrayBuffer();
      }),
      new URL(this.workletUrl, import.meta.url).href,
    ]);

    await this.#context.audioWorklet.addModule(workletUrl);

    this.#node = new AudioWorkletNode(this.#context, "saq-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasm },
      parameterData: Object.fromEntries(PARAM_NAMES.map((name) => [name, 1])),
    });

    const ready = new Promise((resolve, reject) => {
      this.#node.port.onmessage = (event) => {
        const message = event.data;
        if (message.type === "ready") {
          resolve(message);
        } else if (message.type === "error") {
          const failure = new Error(message.message);
          for (const pending of this.#pendingResponse.values()) {
            clearTimeout(pending.timer);
            pending.reject(failure);
          }
          this.#pendingResponse.clear();
          reject(failure);
        } else if (message.type === "response") {
          const pending = this.#pendingResponse.get(message.token);
          if (pending) {
            this.#pendingResponse.delete(message.token);
            clearTimeout(pending.timer);
            pending.resolve(message.values);
          }
        }
      };
    });

    this.#node.connect(this.#context.destination);

    this.#info = await ready;
    return this.#info;
  }

  async resume() {
    await this.#ready;
    if (this.#context.state !== "running") {
      await this.#context.resume();
    }
    return this.#context.state;
  }

  async play(buffer) {
    await this.resume();
    this.stop();
    this.#source = this.#context.createBufferSource();
    this.#source.buffer = buffer;
    this.#source.connect(this.#node);
    this.#source.start();
    return this.#source;
  }

  stop() {
    if (this.#source) {
      try {
        this.#source.stop();
      } catch {}
      this.#source.disconnect();
      this.#source = null;
    }
  }

  reset() {
    this.#node.port.postMessage({ type: "reset" });
    return this.latencyMs();
  }

  latencyMs() {
    return this.#framesToMs(this.#info?.latencyFrames ?? 0);
  }

  responseMs() {
    return this.#framesToMs(this.#info?.responseFrames ?? 0);
  }

  #framesToMs(frames) {
    return (frames / (this.#info?.sampleRate ?? 48000)) * 1000;
  }

  param(name, value) {
    const parameter = this.#node?.parameters.get(name);
    if (!parameter) {
      throw new Error(`unknown parameter ${name}`);
    }
    parameter.value = value;
    return parameter;
  }

  getParam(name) {
    return this.#node?.parameters.get(name)?.value;
  }

  setEq({ preset, base = preset, points = 31, freqs, gains }) {
    this.#node.port.postMessage({
      type: "eq",
      preset,
      base,
      points,
      freqs: freqs ?? new Float32Array(points),
      gains: gains ?? new Float32Array(points),
    });
  }

  presetResponse(preset, frequencies) {
    const token = ++this.#responseToken;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pendingResponse.delete(token)) {
          reject(new Error("the audio engine did not answer a preset request"));
        }
      }, 5000);
      this.#pendingResponse.set(token, { resolve, reject, timer });
    });
    this.#node.port.postMessage({
      type: "response",
      preset,
      frequencies: Float32Array.from(frequencies),
      token,
    });
    return promise;
  }
}
