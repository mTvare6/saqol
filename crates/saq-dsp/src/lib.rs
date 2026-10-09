// SPDX-License-Identifier: MPL-2.0

macro_rules! load_response_hrtf {
    ($directory:literal) => {
        [
            [
                $crate::convolution::read_float_wave(include_bytes!(concat!(
                    "../assets/",
                    $directory,
                    "/H_LL.wav"
                ))),
                $crate::convolution::read_float_wave(include_bytes!(concat!(
                    "../assets/",
                    $directory,
                    "/H_LR.wav"
                ))),
            ],
            [
                $crate::convolution::read_float_wave(include_bytes!(concat!(
                    "../assets/",
                    $directory,
                    "/H_RL.wav"
                ))),
                $crate::convolution::read_float_wave(include_bytes!(concat!(
                    "../assets/",
                    $directory,
                    "/H_RR.wav"
                ))),
            ],
        ]
    };
}

macro_rules! load_zeroed_diagnol_hrtf {
    ($directory:literal) => {{
        let h_ll = $crate::convolution::read_float_wave(include_bytes!(concat!(
            "../assets/",
            $directory,
            "/H_LL.wav"
        )));
        let zero = vec![0.0; h_ll.len()];
        [
            [h_ll, zero.clone()],
            [
                zero,
                $crate::convolution::read_float_wave(include_bytes!(concat!(
                    "../assets/",
                    $directory,
                    "/H_RR.wav"
                ))),
            ],
        ]
    }};
}

pub const SAMPLE_RATE: u32 = 48_000;

mod convolution;
mod eq;
mod fft;
mod surround;

#[cfg(feature = "native")]
mod biquad;
#[cfg(feature = "native")]
mod clarity;
#[cfg(feature = "native")]
mod crossfeed;
#[cfg(feature = "native")]
mod crossover;
#[cfg(feature = "native")]
mod decorrelator;
#[cfg(feature = "native")]
mod delay;
#[cfg(feature = "native")]
mod early_reflections;
#[cfg(feature = "native")]
mod itd;
#[cfg(feature = "native")]
mod mode;
#[cfg(feature = "native")]
mod night;
#[cfg(all(feature = "native", not(target_arch = "wasm32")))]
mod pitch;
#[cfg(feature = "native")]
mod reverb;
#[cfg(feature = "native")]
mod room;
#[cfg(feature = "native")]
mod spatial_filter;
#[cfg(feature = "native")]
mod spatial_stereo;
#[cfg(feature = "native")]
mod spatial_surround;

pub use eq::{EQ_BAND_COUNT, EQ_BAND_FREQUENCIES, EQ_MAX_POINTS, EqEngine, EqPreset, EqProfile};
pub use surround::SurroundEngine;

#[cfg(feature = "native")]
pub use biquad::Biquad;
#[cfg(feature = "native")]
pub use clarity::ClarityEngine;
#[cfg(feature = "native")]
pub use mode::Mode;
#[cfg(feature = "native")]
pub use night::NightEngine;
#[cfg(all(feature = "native", not(target_arch = "wasm32")))]
pub use pitch::PitchEngine;
#[cfg(feature = "native")]
pub use room::RoomEngine;
#[cfg(feature = "native")]
pub use spatial_filter::SpatialFilterEngine;
#[cfg(feature = "native")]
pub use spatial_stereo::SpatialStereoEngine;
#[cfg(feature = "native")]
pub use spatial_surround::SpatialSurroundEngine;
