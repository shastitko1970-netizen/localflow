use crate::error::{AppError, AppResult};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::{self, JoinHandle};

/// Thread-isolated mic capture so AppState stays Send/Sync (cpal Stream is !Send).
pub struct Recorder {
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: Arc<Mutex<u32>>,
    stop_flag: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
    recording: AtomicBool,
}

impl Recorder {
    pub fn new() -> Self {
        Self {
            samples: Arc::new(Mutex::new(Vec::new())),
            sample_rate: Arc::new(Mutex::new(16_000)),
            stop_flag: Arc::new(AtomicBool::new(false)),
            worker: Mutex::new(None),
            recording: AtomicBool::new(false),
        }
    }

    pub fn list_input_devices() -> AppResult<Vec<String>> {
        let host = cpal::default_host();
        let mut names = Vec::new();
        for device in host
            .input_devices()
            .map_err(|e| AppError::msg(format!("input devices: {e}")))?
        {
            if let Ok(name) = device.name() {
                names.push(name);
            }
        }
        Ok(names)
    }

    pub fn start(&self, device_name: Option<&str>) -> AppResult<()> {
        if self.recording.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.samples.lock().clear();
        self.stop_flag.store(false, Ordering::SeqCst);

        let samples = self.samples.clone();
        let sample_rate = self.sample_rate.clone();
        let stop_flag = self.stop_flag.clone();
        let device_name = device_name.map(|s| s.to_string());
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        let handle = thread::spawn(move || {
            let result = (|| -> Result<(), String> {
                let host = cpal::default_host();
                let device = match device_name.as_deref() {
                    Some(name) => host
                        .input_devices()
                        .map_err(|e| e.to_string())?
                        .find(|d| d.name().ok().as_deref() == Some(name))
                        .ok_or_else(|| format!("mic not found: {name}"))?,
                    None => host
                        .default_input_device()
                        .ok_or_else(|| "no default microphone".to_string())?,
                };
                let config = device
                    .default_input_config()
                    .map_err(|e| format!("mic config: {e}"))?;
                *sample_rate.lock() = config.sample_rate().0;
                let channels = usize::from(config.channels());
                let err_fn = |e| tracing::error!("audio stream error: {e}");
                let stream = match config.sample_format() {
                    SampleFormat::F32 => {
                        let cfg: StreamConfig = config.clone().into();
                        let samples = samples.clone();
                        device.build_input_stream(
                            &cfg,
                            move |data: &[f32], _| {
                                samples.lock().extend(data.chunks_exact(channels).map(|frame| {
                                    frame.iter().sum::<f32>() / channels as f32
                                }));
                            },
                            err_fn,
                            None,
                        )
                    }
                    SampleFormat::I16 => {
                        let cfg: StreamConfig = config.clone().into();
                        let samples = samples.clone();
                        device.build_input_stream(
                            &cfg,
                            move |data: &[i16], _| {
                                let mut g = samples.lock();
                                g.extend(data.chunks_exact(channels).map(|frame| {
                                    frame.iter().map(|sample| f32::from(*sample)).sum::<f32>()
                                        / (channels as f32 * i16::MAX as f32)
                                }));
                            },
                            err_fn,
                            None,
                        )
                    }
                    SampleFormat::U16 => {
                        let cfg: StreamConfig = config.clone().into();
                        let samples = samples.clone();
                        device.build_input_stream(
                            &cfg,
                            move |data: &[u16], _| {
                                let mut g = samples.lock();
                                g.extend(data.chunks_exact(channels).map(|frame| {
                                    let average = frame.iter().map(|sample| f32::from(*sample)).sum::<f32>() / channels as f32;
                                    average * 2.0 / u16::MAX as f32 - 1.0
                                }));
                            },
                            err_fn,
                            None,
                        )
                    }
                    other => return Err(format!("unsupported sample format: {other:?}")),
                }
                .map_err(|e| format!("build stream: {e}"))?;
                stream.play().map_err(|e| format!("play stream: {e}"))?;
                let _ = ready_tx.send(Ok(()));
                while !stop_flag.load(Ordering::SeqCst) {
                    thread::sleep(std::time::Duration::from_millis(20));
                }
                drop(stream);
                Ok(())
            })();
            if let Err(e) = &result {
                let _ = ready_tx.send(Err(e.clone()));
            }
        });

        match ready_rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(())) => {
                *self.worker.lock() = Some(handle);
                self.recording.store(true, Ordering::SeqCst);
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = handle.join();
                Err(AppError::msg(e))
            }
            Err(_) => {
                self.stop_flag.store(true, Ordering::SeqCst);
                let _ = handle.join();
                Err(AppError::msg("microphone start timed out"))
            }
        }
    }

    pub fn stop(&self) -> AppResult<(Vec<f32>, u32)> {
        self.recording.store(false, Ordering::SeqCst);
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(h) = self.worker.lock().take() {
            let _ = h.join();
        }
        let samples = std::mem::take(&mut *self.samples.lock());
        let rate = *self.sample_rate.lock();
        Ok((samples, rate))
    }

    pub fn level(&self) -> f32 {
        let samples = self.samples.lock();
        let recent = &samples[samples.len().saturating_sub(1024)..];
        let energy: f32 = recent.iter().map(|sample| sample * sample).sum();
        (energy / recent.len().max(1) as f32).sqrt()
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::SeqCst)
    }
}

pub fn resample_to_16k(samples: &[f32], from_rate: u32) -> Vec<f32> {
    if from_rate == 16_000 || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / 16_000.0;
    let out_len = ((samples.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 * ratio;
        let idx = src.floor() as usize;
        let frac = (src - idx as f64) as f32;
        let a = samples[idx];
        let b = samples.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}
