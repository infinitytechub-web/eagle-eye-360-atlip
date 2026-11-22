// Text-to-speech abstraction: browser Web Speech API, or the native TTS engine inside the iOS/Android apps
// (Android WebView has no speechSynthesis). Speech is generated on the device — no audio or text leaves it.
import { isCapacitorApp } from './passkey';

export interface VoiceOpts { lang: string; rate: number; volume: number; voiceURI?: string }

export function webVoices(): SpeechSynthesisVoice[] { return typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []; }
export function speechAvailable() { return isCapacitorApp() || typeof speechSynthesis !== 'undefined'; }

export async function speak(text: string, o: VoiceOpts) {
  if (isCapacitorApp()) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    await TextToSpeech.stop().catch(() => {});
    await TextToSpeech.speak({ text, lang: o.lang, rate: o.rate, volume: o.volume, category: 'playback' });
    return;
  }
  if (typeof speechSynthesis === 'undefined') throw new Error('Voice output is not supported in this browser');
  speechSynthesis.cancel(); // never queue stale alerts
  const u = new SpeechSynthesisUtterance(text);
  u.lang = o.lang; u.rate = o.rate; u.volume = o.volume;
  const v = webVoices().find((x) => x.voiceURI === o.voiceURI) || webVoices().find((x) => x.lang === o.lang) || webVoices().find((x) => x.lang.startsWith('en'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (isCapacitorApp()) import('@capacitor-community/text-to-speech').then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => {});
  else if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
