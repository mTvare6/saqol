// SPDX-License-Identifier: MPL-2.0

#![allow(clippy::missing_safety_doc)]

use std::sync::atomic::{AtomicPtr, Ordering};

use saq_dsp::{
    EQ_BAND_COUNT, EQ_BAND_FREQUENCIES, EQ_MAX_POINTS, EqEngine, EqPreset, EqProfile, SAMPLE_RATE,
    SurroundEngine,
};

const MAX_FRAMES: usize = 1024;

const SCRATCH_FLOATS: usize = MAX_FRAMES * 4 + EQ_MAX_POINTS * 2;

const OFF_IN_L: usize = 0;
const OFF_IN_R: usize = MAX_FRAMES;
const OFF_OUT_L: usize = MAX_FRAMES * 2;
const OFF_OUT_R: usize = MAX_FRAMES * 3;
const OFF_FREQS: usize = MAX_FRAMES * 4;
const OFF_GAINS: usize = MAX_FRAMES * 4 + EQ_MAX_POINTS;

static mut SCRATCH: [f32; SCRATCH_FLOATS] = [0.0; SCRATCH_FLOATS];

struct Chain {
    surround: Box<SurroundEngine>,
    surround_enabled: bool,
    eq: Box<EqEngine>,
    subwoofer: f32,
}

impl Chain {
    fn new() -> Self {
        Self {
            surround: SurroundEngine::new(),
            surround_enabled: true,
            eq: EqEngine::new(),
            subwoofer: 1.0,
        }
    }

    #[inline]
    fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        let (left, right) = if self.surround_enabled {
            self.surround.process(left, right, self.subwoofer)
        } else {
            (left, right)
        };
        self.eq.process(left, right)
    }
}

static CHAIN: AtomicPtr<Chain> = AtomicPtr::new(std::ptr::null_mut());

#[inline]
fn chain() -> &'static mut Chain {
    let pointer = CHAIN.load(Ordering::Relaxed);
    assert!(!pointer.is_null(), "saq_init must be called first");
    unsafe { &mut *pointer }
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_init() {
    assert!(
        CHAIN.load(Ordering::Relaxed).is_null(),
        "saq_init called twice"
    );
    CHAIN.store(Box::into_raw(Box::new(Chain::new())), Ordering::Relaxed);
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_scratch_ptr() -> *mut f32 {
    std::ptr::addr_of_mut!(SCRATCH).cast()
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_max_frames() -> u32 {
    MAX_FRAMES as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_scratch_freqs_ptr() -> *mut f32 {
    unsafe { std::ptr::addr_of_mut!(SCRATCH).cast::<f32>().add(OFF_FREQS) }
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_scratch_gains_ptr() -> *mut f32 {
    unsafe { std::ptr::addr_of_mut!(SCRATCH).cast::<f32>().add(OFF_GAINS) }
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_sample_rate() -> u32 {
    SAMPLE_RATE
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_set_subwoofer(value: f32) {
    if value.is_finite() {
        chain().subwoofer = value.clamp(0.0, 1.0);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_set_surround_enabled(enabled: bool) {
    let chain = chain();
    if chain.surround_enabled != enabled {
        chain.surround.reset();
        chain.surround_enabled = enabled;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn saq_set_eq(
    preset: u32,
    base: u32,
    points: u32,
    freqs: *const f32,
    gains: *const f32,
) {
    let points = (points as usize).min(EQ_MAX_POINTS);
    let mut profile = EqProfile {
        preset: EqPreset::from_u8(preset as u8),
        base_preset: EqPreset::from_u8(base as u8),
        point_count: points as u8,
        frequencies_hz: EqProfile::default_frequencies(),
        gains_db: [0.0; EQ_MAX_POINTS],
    };
    let read = |src: *const f32, dst: &mut [f32; EQ_MAX_POINTS]| {
        for (index, slot) in dst.iter_mut().enumerate().take(points) {
            *slot = unsafe { *src.add(index) };
        }
    };
    read(freqs, &mut profile.frequencies_hz);
    read(gains, &mut profile.gains_db);
    chain().eq.configure(profile);
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_process(frames: u32, volume: f32) {
    let frames = frames as usize;
    assert!(
        frames <= MAX_FRAMES,
        "block of {frames} frames exceeds the {MAX_FRAMES}-frame scratch"
    );
    let volume = if volume.is_finite() { volume } else { 1.0 };

    let base: *mut f32 = std::ptr::addr_of_mut!(SCRATCH).cast();
    let chain = chain();

    unsafe {
        let (in_l, in_r) = (base.add(OFF_IN_L), base.add(OFF_IN_R));
        let (out_l, out_r) = (base.add(OFF_OUT_L), base.add(OFF_OUT_R));

        for index in 0..frames {
            let (left, right) = chain.process(*in_l.add(index), *in_r.add(index));
            *out_l.add(index) = left * volume;
            *out_r.add(index) = right * volume;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_reset() {
    let chain = chain();
    chain.surround.reset();
    chain.eq.reset();
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn saq_eq_response_db(
    preset: u32,
    freqs: *const f32,
    count: u32,
    out: *mut f32,
) {
    let count = count as usize;
    let frequencies: Vec<f32> = unsafe { std::slice::from_raw_parts(freqs, count) }.to_vec();
    let response = EqPreset::from_u8(preset as u8).response_db(&frequencies);
    let out = unsafe { std::slice::from_raw_parts_mut(out, count) };
    for (slot, value) in out.iter_mut().zip(response) {
        *slot = value;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_eq_band_count() -> u32 {
    EQ_BAND_COUNT as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn saq_eq_band_frequency(index: u32) -> f32 {
    EQ_BAND_FREQUENCIES
        .get(index as usize)
        .copied()
        .unwrap_or_default()
}
