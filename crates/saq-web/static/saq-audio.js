// SPDX-License-Identifier: MPL-2.0

export class SaqAudio {
  #context = null;
  #node = null;
  #ready;
  #pendingResponse = new Map();
  #responseToken = 0;

  constructor(options = {}) {
    this.#ready = this.#build(options);
  }

  get context() {
    return this.#context;
  }

  get node() {
    return this.#node;
  }

  ready() {
    return this.#ready;
  }

  async #build({ workletUrl = "./worklet.js", wasmUrl = "./saq.wasm", sampleRate = 48000 }) {
    this.#context = new AudioContext({ sampleRate });

    const [wasm, workletModule] = await Promise.all([
      fetch(wasmUrl).then((response) => {
        if (!response.ok) {
          throw new Error(`fetching ${wasmUrl}: ${response.status}`);
        }
        return response.arrayBuffer();
      }),
      new URL(workletUrl, import.meta.url).href,
    ]);

    await this.#context.audioWorklet.addModule(workletModule);

    this.#node = new AudioWorkletNode(this.#context, "saq-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasm },
      parameterData: { volume: 1, subwoofer: 1 },
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

    return ready;
  }

  async resume() {
    await this.#ready;
    if (this.#context.state !== "running") {
      await this.#context.resume();
    }
    return this.#context.state;
  }

  reset() {
    this.#node.port.postMessage({ type: "reset" });
  }

  param(name, value) {
    const parameter = this.#node?.parameters.get(name);
    if (!parameter) {
      throw new Error(`unknown parameter ${name}`);
    }
    parameter.value = value;
    return parameter;
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

  setSurround(enabled) {
    this.#node.port.postMessage({ type: "surround", enabled });
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
