import Logo from "../assets/Alfred_Logo.svg";
import { useEffect } from "react";
import { VoiceModeHeaderIndicator, type VoiceHeaderState } from "./Chat.tsx";
import { androidAssistantRequest, hasAndroidAssistantBridge } from "../android/assistantBridge.ts";

export function AndroidAppHeader({ assistantActive, voice, onGoHome }: {
  assistantActive: boolean;
  voice: VoiceHeaderState | null;
  onGoHome: () => void;
}) {
  useEffect(() => {
    // Request after the app document mounts; early native inset events may precede navigation.
    if (hasAndroidAssistantBridge()) void androidAssistantRequest("viewport").catch(() => {});
  }, []);
  const showVoice = assistantActive && voice && voice.voiceModeState !== "off" && !voice.isLogoCentered;
  return <header className={`android-app-header ${assistantActive ? "is-assistant" : ""}`} aria-label="Alfred">
    {showVoice ? <VoiceModeHeaderIndicator
      voiceModeState={voice.voiceModeState}
      modelLoadingText={voice.modelLoadingText}
      voiceModeError={voice.voiceModeError}
      voiceModeAudioLevel={voice.voiceModeAudioLevel}
      isMuted={voice.isVoiceMuted}
      isAnimatingIn={voice.isAnimatingIn}
      onRetry={voice.onRetry}
    /> : <button type="button" className="android-header-home" onClick={onGoHome} aria-label="Alfred dashboard"><img src={Logo} alt="" /><span>ALFRED</span></button>}
  </header>;
}
