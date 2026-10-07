// SPDX-License-Identifier: MPL-2.0

export const DARK0_HARD = "#1d2021";
export const DARK0_SOFT = "#32302f";
export const DARK2 = "#504945";
export const LIGHT0 = "#fbf1c7";
export const LIGHT3 = "#bdae93";
export const BRIGHT_BLUE = "#83a598";

export const EQ_PRESET = {
  Off: 0,
  Dialogue: 1,
  Acoustic: 2,
  BassBoost: 3,
  Orchestral: 4,
  Party: 5,
  Electronic: 6,
  Gaming: 7,
  HipHop: 8,
  House: 9,
  Jazz: 10,
  Cinema: 11,
  Pop: 12,
  Rock: 13,
  TrebleBoost: 14,
  Custom: 15,
};

export const EQ_SELECTABLE = [
  ["OFF", EQ_PRESET.Off],
  ["ACOUSTIC", EQ_PRESET.Acoustic],
  ["BASS BOOST", EQ_PRESET.BassBoost],
  ["ORCHESTRAL", EQ_PRESET.Orchestral],
  ["PARTY", EQ_PRESET.Party],
  ["ELECTRONIC", EQ_PRESET.Electronic],
  ["GAMING", EQ_PRESET.Gaming],
  ["HIP HOP", EQ_PRESET.HipHop],
  ["HOUSE", EQ_PRESET.House],
  ["JAZZ", EQ_PRESET.Jazz],
  ["CINEMA", EQ_PRESET.Cinema],
  ["POP", EQ_PRESET.Pop],
  ["ROCK", EQ_PRESET.Rock],
  ["TREBLE BOOST", EQ_PRESET.TrebleBoost],
  ["DIALOGUE", EQ_PRESET.Dialogue],
];

export const MAX_POINTS = 128;
export const MAX_GAIN_DB = 12;

export function frequencyLabel(frequency) {
  if (frequency >= 1000) {
    const khz = frequency / 1000;
    return Math.abs(khz - Math.round(khz)) < 0.05
      ? `${Math.round(khz)}k`
      : `${khz.toFixed(1)}k`;
  }
  return `${Math.round(frequency)}`;
}

export function sampledValues(frequency, frequencies, values) {
  if (frequency <= frequencies[0]) return values[0];
  if (frequency >= frequencies[frequencies.length - 1]) return values[values.length - 1];
  for (let index = 0; index < frequencies.length - 1; index += 1) {
    if (frequency <= frequencies[index + 1]) {
      const low = Math.log(frequencies[index]);
      const high = Math.log(frequencies[index + 1]);
      if (high <= low) continue;
      const amount = (Math.log(frequency) - low) / (high - low);
      return values[index] + (values[index + 1] - values[index]) * amount;
    }
  }
  return values[values.length - 1];
}

export function insertEqPoint(state, frequency, gainDb) {
  if (state.pointCount >= MAX_POINTS) return null;
  const clamped = Math.min(20000, Math.max(20, frequency));
  const count = state.pointCount;

  let insertion = 0;
  while (insertion < count && state.frequencies[insertion] < clamped) insertion += 1;

  for (let index = count; index > insertion; index -= 1) {
    state.frequencies[index] = state.frequencies[index - 1];
    state.gains[index] = state.gains[index - 1];
  }
  state.frequencies[insertion] = clamped;
  state.gains[insertion] = Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, gainDb));
  state.pointCount += 1;
  return insertion;
}

const MIN_DB = -36;
const MAX_DB = 18;
const CURVE_POINTS = 161;

export class EqGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.bands = new Float32Array(0);

    this.preset = EQ_PRESET.Off;
    this.basePreset = EQ_PRESET.Off;
    this.baseResponse = new Float32Array(0);
    this.frequencies = new Float32Array(MAX_POINTS);
    this.gains = new Float32Array(MAX_POINTS);
    this.pointCount = 0;
    this.resetCurve();

    this.activeHandle = null;
    this.dragging = null;
    this.onChange = () => {};
    this.onCommit = () => {};

    this.graph = { left: 42, top: 10, right: 12, bottom: 26 };
    this.#bindPointer();
    this.resize();
  }

  setBands(bands) {
    this.bands = Float32Array.from(bands);
    this.baseResponse = new Float32Array(this.bands.length);
    this.resetCurve();
    return this;
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth || 672;
    const height = this.canvas.clientHeight || 202;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = width;
    this.height = height;
    this.rect = {
      left: this.graph.left,
      top: this.graph.top,
      right: width - this.graph.right,
      bottom: height - this.graph.bottom,
    };
    return this;
  }

  get graphWidth() {
    return this.rect.right - this.rect.left;
  }

  get graphHeight() {
    return this.rect.bottom - this.rect.top;
  }

  xForFrequency(frequency) {
    const amount = Math.log(frequency / 20) / Math.log(20000 / 20);
    return this.rect.left + Math.min(1, Math.max(0, amount)) * this.graphWidth;
  }

  frequencyForX(x) {
    const amount = Math.min(1, Math.max(0, (x - this.rect.left) / this.graphWidth));
    return 20 * Math.pow(20000 / 20, amount);
  }

  yForDb(db) {
    const amount = (MAX_DB - db) / (MAX_DB - MIN_DB);
    return this.rect.top + Math.min(1, Math.max(0, amount)) * this.graphHeight;
  }

  dbForY(y) {
    return MAX_DB - Math.min(1, Math.max(0, (y - this.rect.top) / this.graphHeight)) * (MAX_DB - MIN_DB);
  }

  get displayedBase() {
    return this.preset === EQ_PRESET.Custom ? this.basePreset : this.preset;
  }

  baseAt(frequency) {
    if (this.displayedBase === EQ_PRESET.Off) return 0;
    return sampledValues(frequency, this.bands, this.baseResponse);
  }

  gainAt(frequency) {
    if (this.preset !== EQ_PRESET.Custom) return 0;
    return sampledValues(
      frequency,
      this.frequencies.subarray(0, this.pointCount),
      this.gains.subarray(0, this.pointCount),
    );
  }

  dbAt(frequency) {
    return this.baseAt(frequency) + this.gainAt(frequency);
  }

  resetCurve() {
    this.frequencies.set(this.bands);
    this.gains.fill(0);
    this.pointCount = this.bands.length;
  }

  setPreset(preset, response) {
    this.preset = preset;
    this.basePreset = preset;
    if (response) this.baseResponse.set(response);
    else this.baseResponse.fill(0);
    this.resetCurve();
    this.activeHandle = null;
  }

  profile() {
    return {
      preset: this.preset,
      base: this.basePreset,
      points: this.pointCount,
      frequencies: Array.from(this.frequencies.subarray(0, this.pointCount)),
      gains: Array.from(this.gains.subarray(0, this.pointCount)),
    };
  }

  nearestHandle(x) {
    let nearest = null;
    let bestDistance = Infinity;
    for (let index = 0; index < this.pointCount; index += 1) {
      const distance = Math.abs(this.xForFrequency(this.frequencies[index]) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = index;
      }
    }
    return { index: nearest, distance: bestDistance };
  }

  #toLocal(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  #enterCustom() {
    if (this.preset !== EQ_PRESET.Custom) {
      this.basePreset = this.preset;
      this.gains.fill(0);
      this.preset = EQ_PRESET.Custom;
    }
  }

  #bindPointer() {
    this.canvas.addEventListener("pointerdown", (event) => {
      const { x, y } = this.#toLocal(event);
      const { index, distance } = this.nearestHandle(x);
      this.canvas.setPointerCapture(event.pointerId);

      if (index !== null && distance <= 8) {
        this.activeHandle = index;
      } else if (this.pointCount < MAX_POINTS) {
        this.#enterCustom();
        const frequency = this.frequencyForX(x);
        this.activeHandle = insertEqPoint(this, frequency, this.dbForY(y) - this.baseAt(frequency));
      } else {
        this.activeHandle = null;
      }
      this.draw();
      this.onChange();
    });

    this.canvas.addEventListener("pointermove", (event) => {
      const { x, y } = this.#toLocal(event);

      if (this.activeHandle !== null) {
        this.#enterCustom();
        const frequency = this.frequencies[this.activeHandle];
        this.gains[this.activeHandle] = Math.min(
          MAX_GAIN_DB,
          Math.max(-MAX_GAIN_DB, this.dbForY(y) - this.baseAt(frequency)),
        );
        this.draw();
        this.onChange();
      } else {
        this.#updateTooltip(x);
      }
    });

    const finish = (event) => {
      if (this.activeHandle === null) return;
      this.activeHandle = null;
      this.canvas.releasePointerCapture?.(event.pointerId);
      this.draw();
      this.onCommit();
    };
    this.canvas.addEventListener("pointerup", finish);
    this.canvas.addEventListener("pointercancel", finish);
    this.canvas.addEventListener("pointerleave", () => {
      this.#hideTooltip();
      this.draw();
    });
  }

  #updateTooltip(x) {
    const { index, distance } = this.nearestHandle(x);
    if (index === null) {
      this.#hideTooltip();
      return;
    }
    const existing = this.frequencies[index];
    const nearExisting = distance <= 8;
    const frequency = nearExisting ? existing : this.frequencyForX(x);
    const db = this.dbAt(frequency);
    const hint = nearExisting
      ? "drag vertically to adjust"
      : this.pointCount < MAX_POINTS
        ? "click to add a point here"
        : "point storage is full";
    this.tooltip = `${frequencyLabel(frequency)}  ${db >= 0 ? "+" : ""}${db.toFixed(1)} dB — ${hint}`;
    this.canvas.title = this.tooltip;
  }

  #hideTooltip() {
    this.canvas.title = "";
  }

  draw() {
    const context = this.context;
    const { left, right, top, bottom } = this.rect;
    context.clearRect(0, 0, this.width, this.height);

    context.fillStyle = DARK0_HARD;
    context.fillRect(0, 0, this.width, this.height);

    context.lineWidth = 1;
    for (const db of [-30, -18, -6, 0, 6, 12]) {
      const y = Math.round(this.yForDb(db)) + 0.5;
      context.strokeStyle = db === 0 ? DARK2 : DARK0_SOFT;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
      context.fillStyle = LIGHT3;
      context.font = "8px ui-monospace, monospace";
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(`${db >= 0 ? "+" : ""}${db}`, left - 6, y);
    }

    const count = this.pointCount;
    for (let index = 0; index < count; index += 1) {
      const frequency = this.frequencies[index];
      const x = Math.round(this.xForFrequency(frequency)) + 0.5;
      context.strokeStyle = DARK0_SOFT;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();

      if (index === 0 || index + 1 === count || index % 3 === 1) {
        context.fillStyle = LIGHT3;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText(frequencyLabel(frequency), x, bottom + 9);
      }
    }

    const curve = [];
    for (let step = 0; step <= CURVE_POINTS - 1; step += 1) {
      const frequency = 20 * Math.pow(20000 / 20, step / (CURVE_POINTS - 1));
      curve.push([this.xForFrequency(frequency), this.yForDb(this.dbAt(frequency))]);
    }

    context.beginPath();
    curve.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.lineTo(right, this.yForDb(MIN_DB));
    context.lineTo(left, this.yForDb(MIN_DB));
    context.closePath();
    context.fillStyle = `${BRIGHT_BLUE}1a`;
    context.fill();

    context.beginPath();
    curve.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.strokeStyle = BRIGHT_BLUE;
    context.lineWidth = 2;
    context.stroke();

    for (let index = 0; index < count; index += 1) {
      const frequency = this.frequencies[index];
      const db = this.dbAt(frequency);
      const x = this.xForFrequency(frequency);
      const y = this.yForDb(db);
      const radius = this.activeHandle === index ? 5 : 3.5;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = DARK0_HARD;
      context.fill();
      context.strokeStyle = this.activeHandle === index ? LIGHT0 : BRIGHT_BLUE;
      context.lineWidth = 1.5;
      context.stroke();
    }
  }
}
