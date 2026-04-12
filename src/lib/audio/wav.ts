function interleaveToMono(channelData: Float32Array[]): Float32Array {
  if (channelData.length === 1) {
    return channelData[0];
  }

  const length = channelData[0]?.length ?? 0;
  const mono = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (const channel of channelData) {
      sum += channel[i] ?? 0;
    }
    mono[i] = sum / channelData.length;
  }

  return mono;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function clampSample(value: number) {
  return Math.max(-1, Math.min(1, value));
}

export function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const channelData = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) =>
    audioBuffer.getChannelData(index)
  );
  const monoData = interleaveToMono(channelData);
  const bytesPerSample = 2;
  const dataLength = monoData.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < monoData.length; i += 1) {
    const sample = clampSample(monoData[i]);
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, pcm, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function resampleAudioBuffer(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
) {
  if (audioBuffer.sampleRate === targetSampleRate) {
    return audioBuffer;
  }

  const frameCount = Math.max(1, Math.ceil(audioBuffer.duration * targetSampleRate));
  const offlineContext = new OfflineAudioContext(1, frameCount, targetSampleRate);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);

  return offlineContext.startRendering();
}

interface ConvertAudioToWavOptions {
  sampleRate?: number;
}

export async function convertAudioBlobToWavArrayBuffer(
  blob: Blob,
  options: ConvertAudioToWavOptions = {}
): Promise<ArrayBuffer> {
  const audioContext = new AudioContext();

  try {
    const sourceBuffer = await blob.arrayBuffer();
    const decodedBuffer = await audioContext.decodeAudioData(sourceBuffer);
    const renderedBuffer = options.sampleRate
      ? await resampleAudioBuffer(decodedBuffer, options.sampleRate)
      : decodedBuffer;
    return audioBufferToWav(renderedBuffer);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

export async function convertAudioBlobToWavBlob(
  blob: Blob,
  options: ConvertAudioToWavOptions = {}
): Promise<Blob> {
  const wavBuffer = await convertAudioBlobToWavArrayBuffer(blob, options);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

export async function convertAudioBlobToWavBase64(
  blob: Blob,
  options: ConvertAudioToWavOptions = {}
): Promise<string> {
  const wavBuffer = await convertAudioBlobToWavArrayBuffer(blob, options);
  return arrayBufferToBase64(wavBuffer);
}
