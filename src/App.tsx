import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, MicOff, Settings, MessageSquare, 
  Heart, Smile, Zap, Coffee, Sparkles,
  LogOut, User, Send, Phone, PhoneOff, X, Save, History,
  Music, ExternalLink, SkipBack, SkipForward, Shuffle, Repeat, Play, Pause
} from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { GeminiLiveSession, Emotion, AIResponse } from './lib/gemini';
import { getTopTracks, searchSongs, Track } from './lib/music';
import SmileBall from './components/SmileBall';
import VoiceWave from './components/VoiceWave';
import ReactPlayer from 'react-player';

const Player = ReactPlayer as any;

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type Personality = 'friendly' | 'caring' | 'funny' | 'motivational' | 'chill';

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  preferences: {
    personality: Personality;
    voiceId?: string;
    hobbies?: string;
    birthday?: string;
    other?: string;
    assistantName?: string;
  };
}

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: number;
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const assistantName = profile?.preferences?.assistantName || 'sara';
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [topTracks, setTopTracks] = useState<Track[]>([]);
  const [activeTab, setActiveTab] = useState<'memory' | 'music'>('memory');
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const [showMusicControlsOverlay, setShowMusicControlsOverlay] = useState(false);
  const [volume, setVolume] = useState(0.9); // Higher default volume for music
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [currentMessages, setCurrentMessages] = useState<AIResponse[]>([]);
  const lastToggleTimeRef = useRef<number>(0);
  const readinessTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<any>(null);
  const internalPlayerRef = useRef<any>(null);

  // Auto-lower music volume when sara speaks (Ducking)
  useEffect(() => {
    // Volume is handled by ReactPlayer prop
  }, [isSpeaking, volume, currentTrack]);

  // Kick stuck player
  useEffect(() => {
    if (!isPlayingMusic || !currentTrack || isSeeking) return;
    
    const lastTime = currentTime;
    const timeout = setTimeout(() => {
      if (isPlayingMusic && currentTime === lastTime && currentTime < (duration || 1)) {
        console.warn("Player seems stuck, attempting to re-sync...");
        // Try manual kick if possible
        if (internalPlayerRef.current) {
          try {
            if (typeof internalPlayerRef.current.play === 'function') internalPlayerRef.current.play();
            if (typeof internalPlayerRef.current.playVideo === 'function') internalPlayerRef.current.playVideo();
          } catch (e) {
            console.warn("Manual kick failed", e);
          }
        }
      }
    }, 8000); // 8 seconds of no progress
    
    return () => clearTimeout(timeout);
  }, [isPlayingMusic, currentTime, currentTrack, isSeeking, duration]);

  const playSong = useCallback(async (query: string) => {
    console.log("Searching for song:", query);
    const results = await searchSongs(query, 1);
    if (results.length > 0 && results[0].previewUrl) {
      const track = results[0];
      console.log("Playing track:", track.name, "URL:", track.previewUrl);
      setIsPlayerReady(false);
      setCurrentTrack(track);
      if (track.duration) setDuration(track.duration);
      setShowMusicControlsOverlay(true);
      setIsPlayingMusic(true);
      setCurrentTime(0);

      // Safety timeout for player readiness
      if (readinessTimeoutRef.current) clearTimeout(readinessTimeoutRef.current);
      readinessTimeoutRef.current = setTimeout(() => {
        console.log("Forcing player readiness after timeout");
        setIsPlayerReady(true);
      }, 5000);
    } else {
      console.warn("No song found for query:", query);
      setErrorMessage("Could not find that song. Try another one!");
    }
  }, []);

  useEffect(() => {
    console.log("Music State:", { isPlayingMusic, hasTrack: !!currentTrack, trackName: currentTrack?.name, url: currentTrack?.previewUrl });
  }, [isPlayingMusic, currentTrack]);

  const handleMusicControl = useCallback(async (action: string) => {
    // Prevent rapid toggling of play/pause which causes "interrupted by pause" error
    if (action === 'pause' || action === 'resume') {
      const now = Date.now();
      if (now - lastToggleTimeRef.current < 500) {
        console.warn("Throttling music control action:", action);
        return;
      }
      lastToggleTimeRef.current = now;
    }

    switch (action) {
      case 'volume_up':
        setVolume(prev => Math.min(1, prev + 0.1));
        break;
      case 'volume_down':
        setVolume(prev => Math.max(0, prev - 0.1));
        break;
      case 'pause':
        setIsPlayingMusic(false);
        break;
      case 'resume':
        setIsPlayingMusic(true);
        break;
      case 'replay':
        if (internalPlayerRef.current && typeof internalPlayerRef.current.seekTo === 'function') {
          internalPlayerRef.current.seekTo(0);
          setIsPlayingMusic(true);
        }
        break;
      case 'seek_forward':
        if (internalPlayerRef.current && typeof internalPlayerRef.current.seekTo === 'function') {
          const current = internalPlayerRef.current.getCurrentTime();
          internalPlayerRef.current.seekTo(current + 10);
        }
        break;
      case 'seek_backward':
        if (internalPlayerRef.current && typeof internalPlayerRef.current.seekTo === 'function') {
          const current = internalPlayerRef.current.getCurrentTime();
          internalPlayerRef.current.seekTo(Math.max(0, current - 10));
        }
        break;
      case 'seek_forward_10m':
        if (internalPlayerRef.current && typeof internalPlayerRef.current.seekTo === 'function') {
          const current = internalPlayerRef.current.getCurrentTime();
          internalPlayerRef.current.seekTo(current + 600);
        }
        break;
      case 'previous':
        if (internalPlayerRef.current && typeof internalPlayerRef.current.seekTo === 'function') {
          internalPlayerRef.current.seekTo(0);
        }
        break;
      case 'next':
        if (topTracks.length > 0) {
          const randomIndex = Math.floor(Math.random() * topTracks.length);
          const nextTrack = topTracks[randomIndex];
          playSong(nextTrack.name + " " + (nextTrack.artist.name || nextTrack.artist));
        } else {
          if (internalPlayerRef.current && typeof internalPlayerRef.current.seekTo === 'function') {
            internalPlayerRef.current.seekTo(0);
          }
        }
        break;
      case 'stop_all':
        setIsPlayingMusic(false);
        setCurrentTrack(null);
        setShowMusicControlsOverlay(false);
        sessionRef.current?.stopSpeaking();
        setIsSpeaking(false);
        setIsThinking(false);
        break;
      case 'show_controls':
        if (currentTrack) {
          setShowMusicControlsOverlay(true);
        }
        break;
      case 'hide_controls':
        setShowMusicControlsOverlay(false);
        break;
    }
  }, [topTracks, isPlayingMusic, currentTrack, playSong]);

  useEffect(() => {
    // No longer need musicAudioRef event listeners
    return () => {};
  }, [isRepeat, handleMusicControl]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isCallActive) {
        stopCall();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isCallActive]);

  useEffect(() => {
    const fetchMusic = async () => {
      try {
        const tracks = await getTopTracks(10);
        setTopTracks(tracks);
      } catch (err) {
        console.error("Initial music fetch failed:", err);
      }
    };
    fetchMusic();

    const checkApiKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setNeedsApiKey(!hasKey);
      }
    };
    checkApiKey();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        const userDoc = doc(db, 'users', u.uid);
        const unsubProfile = onSnapshot(userDoc, (snap) => {
          if (snap.exists()) {
            const newProfile = snap.data() as UserProfile;
            setProfile(newProfile);
            if (sessionRef.current && newProfile.preferences.voiceId) {
              sessionRef.current.setVoiceId(newProfile.preferences.voiceId);
            }
          } else {
            syncUserProfile(u);
          }
        });
        return () => unsubProfile();
      }
    });
    return () => unsubscribe();
  }, []);

  const playVoicePreview = async (voiceId: string) => {
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello! This is how I sound.", voiceId }),
      });
      if (!response.ok) throw new Error("TTS failed");
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    } catch (err) {
      console.error("Preview failed:", err);
    }
  };

  const syncUserProfile = async (u: any) => {
    const userDoc = doc(db, 'users', u.uid);
    const snap = await getDoc(userDoc);
    if (!snap.exists()) {
      const initialProfile: UserProfile = {
        uid: u.uid,
        name: u.displayName || "Friend",
        email: u.email || "",
        preferences: { personality: 'friendly' }
      };
      await setDoc(userDoc, {
        ...initialProfile,
        lastActive: serverTimestamp()
      });
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return;
    const userDoc = doc(db, 'users', user.uid);
    await setDoc(userDoc, updates, { merge: true });
    setShowProfile(false);
  };

  const startSession = async (history: string = "") => {
    if (!sessionRef.current) {
      const session = new GeminiLiveSession((resp: AIResponse) => {
        if (resp.audio === "playing") {
          setIsSpeaking(true);
          setIsThinking(false);
        }
        if (resp.audio === "finished") {
          setIsSpeaking(false);
        }
        if (resp.text) {
          const sender = resp.sender || 'ai'; // Default to 'ai' if missing
          
          // Update local messages for real-time display
          setCurrentMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            
            // If it's a user transcription, replace the last partial user message
            if (sender === 'user') {
              if (lastMsg && lastMsg.sender === 'user' && !lastMsg.isFinal) {
                return [...prev.slice(0, -1), { ...resp, sender }];
              }
              return [...prev, { ...resp, sender }].slice(-5);
            }
            
            // For AI responses, if the last message was also AI and we're still in the same turn, 
            // we might want to append text, but for now let's just append as new messages 
            // to keep it simple and reactive.
            return [...prev, { ...resp, sender }].slice(-5);
          });

          if (sender === 'ai') {
            setIsThinking(true);
            const emotionMatch = resp.text.match(/\[EMOTION:(\w+)\]/);
            if (emotionMatch) {
              setEmotion(emotionMatch[1] as Emotion);
            }
          }
          // Save message to Firestore
          if (user) {
            const messagesRef = collection(db, 'users', user.uid, 'messages');
            addDoc(messagesRef, {
              text: resp.text,
              sender: sender,
              timestamp: serverTimestamp()
            }).catch(err => console.error("Error saving message:", err));
          }
        }
        if (resp.toolCall) {
          if (resp.toolCall.name === 'playMusic') {
            playSong(resp.toolCall.args.query);
          } else if (resp.toolCall.name === 'controlMusic') {
            handleMusicControl(resp.toolCall.args.action);
          } else if (resp.toolCall.name === 'openSettings') {
            setShowProfile(true);
          }
        }
        if (resp.interrupted) {
          setIsSpeaking(false);
          setIsThinking(false);
        }
      }, (err: any) => {
        console.error("Gemini Session Error:", err);
        const msg = err.message || String(err);
        setErrorMessage(msg);
        if (msg.includes("quota") || msg.includes("rate limit") || msg.includes("API_KEY") || msg.includes("permission")) {
          setNeedsApiKey(true);
          stopCall();
        }
      });
      // Unified personality: "friendly"
      try {
        await session.connect('friendly', profile, history, assistantName);
        sessionRef.current = session;
        setErrorMessage(null);
      } catch (err: any) {
        console.error("Session connection error:", err);
        const msg = err.message || String(err);
        setErrorMessage(msg);
        if (msg.includes("quota") || msg.includes("rate limit") || msg.includes("permission") || msg.includes("API_KEY")) {
          setNeedsApiKey(true);
        }
      }
    }
  };

  const toggleCall = async () => {
    if (isCallActive) {
      stopCall();
    } else {
      await startCall();
    }
  };

  const startCall = async () => {
    setIsCallActive(true);
    setCurrentMessages([]);
    try {
      // Fetch history first
      let historySummary = "";
      if (user) {
        try {
          const messagesRef = collection(db, 'users', user.uid, 'messages');
          const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(10));
          const snap = await getDocs(q);
          const history = snap.docs.map(doc => {
            const data = doc.data();
            return `${data.sender === 'user' ? 'User' : assistantName}: ${data.text}`;
          }).reverse();
          historySummary = history.join("\n");
        } catch (err) {
          console.error("History fetch error:", err);
          // Continue anyway, history is optional
        }
      }
      
      await startListening(historySummary);
    } catch (err) {
      console.error("Call start error:", err);
      setIsCallActive(false);
    }
  };

  const stopCall = () => {
    stopListening();
    sessionRef.current?.close();
    sessionRef.current = null;
    setIsCallActive(false);
    setIsSpeaking(false);
    setIsThinking(false);
    setEmotion('neutral');
    setCurrentMessages([]);
    
    // Stop music when call ends
    handleMusicControl('stop_all');
  };

  const startListening = async (history: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
        }
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        sessionRef.current?.sendAudio(base64);
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      processorRef.current = processor;
      
      setIsListening(true);
      await startSession(history);
    } catch (err) {
      console.error("Microphone access error:", err);
      throw err;
    }
  };

  const stopListening = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
    }
    setIsListening(false);
  };

  const handleLogin = () => signInWithPopup(auth, new GoogleAuthProvider());
  const handleLogout = () => signOut(auth);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setNeedsApiKey(false);
    }
  };

  const handleSeek = (e: React.MouseEvent | React.TouchEvent) => {
    if (!duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle = (angle + 90 + 360) % 360; // Adjust so 0 is at top
    
    const newTime = (angle / 360) * duration;
    if (internalPlayerRef.current && typeof internalPlayerRef.current.seekTo === 'function') {
      internalPlayerRef.current.seekTo(newTime);
    }
    setCurrentTime(newTime);
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || time === Infinity) return "0:00";
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor(time % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!isAuthReady) return <div className="min-h-screen flex items-center justify-center text-primary font-display font-bold text-2xl">Loading...</div>;

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center font-body relative overflow-hidden">
        {/* Background Decorations */}
        <div className="fixed inset-0 heart-pattern pointer-events-none opacity-10" />
        <div className="fixed -bottom-20 -left-20 w-80 h-80 bg-lite-blue/30 blur-[100px] rounded-full -z-10" />
        <div className="fixed -top-20 -right-20 w-96 h-96 bg-lite-pink/30 blur-[100px] rounded-full -z-10" />

        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="mb-12"
        >
          <SmileBall emotion="loving" isSpeaking={false} />
        </motion.div>
        <h1 className="text-5xl font-bold text-primary mb-4 tracking-tight font-display">{assistantName}</h1>
        <p className="text-gray-500 max-w-md mb-8 text-lg">
          Your emotional companion. Always here for you.
        </p>
        
        <div className="flex flex-col gap-4">
          <button 
            onClick={handleLogin}
            className="px-8 py-4 bg-gradient-to-tr from-call-pink to-accent text-white rounded-2xl font-bold transition-all shadow-xl shadow-pink-500/20 flex items-center gap-3 hover:scale-105 active:scale-95"
          >
            <User size={20} />
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-gray-700 flex flex-col items-center justify-between font-body overflow-hidden pt-6 pb-12 relative">
      {/* Background Decorations */}
      <div className="fixed inset-0 heart-pattern pointer-events-none opacity-10" />
      <div className="sparkle-shape w-4 h-4 top-[15%] left-[10%] animate-pulse" />
      <div className="sparkle-shape w-3 h-3 top-[30%] right-[15%] animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="sparkle-shape w-5 h-5 bottom-[35%] left-[20%] animate-pulse" style={{ animationDelay: '2s' }} />
      
      <div className="fixed -bottom-20 -left-20 w-80 h-80 bg-lite-blue/30 blur-[100px] rounded-full -z-10" />
      <div className="fixed -top-20 -right-20 w-96 h-96 bg-lite-pink/30 blur-[100px] rounded-full -z-10" />

      {/* Header (Hidden buttons as requested) */}
      <div className="flex items-center w-full px-8 justify-between z-10 -mt-2">
        <div className="w-10 h-10" /> {/* Spacer */}
        <h2 className="text-primary font-display font-bold text-3xl tracking-tight">{assistantName}</h2>
        <div className="w-10 h-10" /> {/* Spacer */}
      </div>

      {/* The Ball Section */}
      <div className="flex flex-col items-center justify-center relative z-10 mt-16">
        <AnimatePresence mode="wait">
          {!showMusicControlsOverlay || !currentTrack ? (
            <motion.div
              key="face"
              initial={{ opacity: 0, scale: 0.8, rotateY: 180 }}
              animate={{ opacity: 1, scale: 1, rotateY: 0 }}
              exit={{ opacity: 0, scale: 0.5, rotate: 360, filter: "blur(20px)" }}
              transition={{ duration: 0.8, ease: "anticipate" }}
              className="relative"
            >
              <motion.div
                animate={{ 
                  scale: isSpeaking ? 1.05 : 1,
                }}
              >
                <SmileBall emotion={emotion} isSpeaking={isSpeaking} />
              </motion.div>
              
              {/* Sparkle Icon */}
              <motion.div 
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 4 }}
                className="absolute -top-4 -right-2 text-primary drop-shadow-sm"
              >
                <Sparkles size={36} fill="currentColor" />
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="controls"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="relative bg-white/80 backdrop-blur-xl rounded-full p-4 shadow-2xl flex items-center gap-6 border border-white/50"
            >
              <div className="flex flex-col items-center px-4">
                <p className="text-xs font-bold text-primary/50 uppercase tracking-tighter mb-1">Playing</p>
                <h3 className="text-primary font-display font-bold text-sm truncate max-w-[150px]">
                  {currentTrack?.name}
                </h3>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => setVolume(v => v === 0 ? 0.9 : 0)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${volume === 0 ? 'bg-red-500 text-white' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}
                >
                  {volume === 0 ? <MicOff size={20} /> : <Zap size={20} />}
                </button>

                <button 
                  onClick={() => handleMusicControl('stop_all')}
                  className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all shadow-lg"
                >
                  <PhoneOff size={20} />
                </button>
              </div>

              <button 
                onClick={() => setShowMusicControlsOverlay(false)}
                className="p-2 text-slate-400 hover:text-primary transition-colors"
              >
                <X size={20} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ReactPlayer for background music (Full Songs) */}
        <div className="fixed top-4 left-4 w-12 h-12 overflow-hidden opacity-[0.1] pointer-events-none z-[-100] border border-white/10 rounded">
          <Player
            ref={playerRef}
            url={currentTrack?.previewUrl || null}
            playing={isPlayingMusic && isPlayerReady}
            volume={isSpeaking ? volume * 0.3 : volume}
            playsinline={true}
            onReady={(player: any) => {
              console.log("Player ready", currentTrack?.name, "Duration:", player.getDuration());
              internalPlayerRef.current = player;
              setIsPlayerReady(true);
              if (readinessTimeoutRef.current) clearTimeout(readinessTimeoutRef.current);
              try {
                const d = player.getDuration();
                if (d) setDuration(d);
              } catch (e) {
                console.warn("Could not get duration on ready", e);
              }
            }}
            onStart={() => {
              console.log("Player started playing", currentTrack?.name);
            }}
            onError={(e: any) => {
              console.error("Player error:", e, currentTrack?.previewUrl);
              setErrorMessage("Failed to play song. Trying next...");
              setTimeout(() => handleMusicControl('next'), 3000);
            }}
            onPlay={() => {
              console.log("Player play event");
            }}
            onPause={() => {
              console.log("Player pause event");
            }}
            onProgress={(state: any) => {
              if (state.playedSeconds > 0) {
                console.log("Player progress:", state.playedSeconds);
              }
              if (!isSeeking) {
                setCurrentTime(state.playedSeconds);
              }
            }}
            onEnded={() => {
              if (isRepeat) {
                if (internalPlayerRef.current && typeof internalPlayerRef.current.seekTo === 'function') {
                  internalPlayerRef.current.seekTo(0);
                }
              } else {
                handleMusicControl('next');
              }
            }}
            config={{
              youtube: {
                playerVars: { autoplay: 1, controls: 0, rel: 0, origin: window.location.origin }
              }
            } as any}
          />
        </div>

        {/* Status Indicator */}
        <div className="mt-8 flex flex-col items-center gap-4 min-h-[120px] w-full max-w-md px-6">
          <AnimatePresence mode="popLayout">
            {currentMessages.length > 0 && (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="w-full space-y-3 mb-4"
              >
                {currentMessages.map((msg, idx) => (
                  <motion.div 
                    key={idx}
                    initial={{ opacity: 0, x: msg.sender === 'user' ? 20 : -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                      msg.sender === 'user' 
                        ? 'bg-white/40 backdrop-blur-md border border-white/60 text-primary rounded-tr-none' 
                        : 'bg-gradient-to-tr from-pink-500/10 to-accent/10 backdrop-blur-md border border-pink-500/20 text-primary rounded-tl-none'
                    }`}>
                      {msg.text?.replace(/\[EMOTION:\w+\]/g, '').trim()}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {isCallActive && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="flex gap-2.5">
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2.5 h-2.5 bg-primary/30 rounded-full" />
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2.5 h-2.5 bg-primary/60 rounded-full" />
                <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2.5 h-2.5 bg-primary/30 rounded-full" />
              </div>
              <p className="text-primary font-display font-bold text-sm tracking-[0.2em] uppercase">
                {isThinking ? "Thinking..." : isSpeaking ? "Speaking..." : "Listening to you..."}
              </p>
            </motion.div>
          )}
        </div>
      </div>

      {/* Call Controls */}
      <div className="flex flex-col items-center gap-6 pb-6 z-10">
        {/* Music Player Bar */}
        <AnimatePresence>
          {currentTrack && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="mb-4 w-full max-w-sm bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-4 flex items-center gap-4 shadow-2xl"
            >
              <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-pink-500/20">
                {currentTrack.image ? (
                  <img src={currentTrack.image} alt={currentTrack.name} className="w-full h-auto" referrerPolicy="no-referrer" />
                ) : (
                  <Music className="w-full h-full p-3 text-pink-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-sm truncate">{currentTrack.name}</p>
                <p className="text-slate-400 text-xs truncate">{currentTrack.artist.name}</p>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => handleMusicControl(isPlayingMusic ? 'pause' : 'resume')}
                  className="p-2 bg-pink-500 text-white rounded-full hover:bg-pink-600 transition-colors"
                >
                  {isPlayingMusic ? <PhoneOff size={16} /> : <Phone size={16} />}
                </button>
                <button 
                  onClick={() => handleMusicControl('stop_all')}
                  className="p-2 text-slate-400 hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button 
          onClick={toggleCall}
          className={`size-28 rounded-full flex items-center justify-center border-[8px] border-white shadow-[0_15px_35px_rgba(255,133,162,0.3)] active:scale-95 transition-all duration-500 relative overflow-hidden ${
            isCallActive 
              ? 'bg-gradient-to-tr from-red-400 to-red-500' 
              : 'bg-gradient-to-tr from-call-pink to-accent animate-pulse-soft'
          }`}
        >
          <AnimatePresence mode="wait">
            {isCallActive ? (
              <motion.div
                key="off"
                initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
              >
                <PhoneOff size={40} fill="currentColor" />
              </motion.div>
            ) : (
              <motion.div
                key="on"
                initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
              >
                <Phone size={40} fill="currentColor" />
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Button Sparkles */}
          <div className="sparkle-shape w-3 h-3 top-4 right-5 opacity-80" />
          <div className="sparkle-shape w-2 h-2 bottom-6 left-5 opacity-80" />
        </button>
        <p className="text-primary/70 text-xs font-display font-bold tracking-[0.25em] uppercase">
          {isCallActive ? "End Call" : "Start Call"}
        </p>

        {errorMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl max-w-xs text-center shadow-lg"
          >
            <p className="text-red-500 text-sm font-bold mb-2">
              {errorMessage.includes("quota") 
                ? "Free Usage Limit Reached" 
                : "Connection Error"}
            </p>
            <p className="text-red-400 text-xs leading-relaxed mb-3">
              {errorMessage.includes("quota") 
                ? `The free usage limit for ${assistantName} has been reached. Please try again later.` 
                : `There was a problem connecting to ${assistantName}. Please check your internet and try again.`}
            </p>
            {errorMessage.includes("quota") ? null : (
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-2 bg-slate-700 text-white rounded-xl text-xs font-bold hover:bg-slate-600 transition-colors"
              >
                Retry Connection
              </button>
            )}
          </motion.div>
        )}

        {/* Removed needsApiKey prompt */}
      </div>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-slate-900 border border-white/10 rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-bold text-white tracking-tight">{assistantName}'s World</h2>
                <button onClick={() => setShowProfile(false)} className="p-2 text-slate-400 hover:text-white transition-colors">
                  <X size={28} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex bg-white/5 p-1 rounded-2xl mb-8">
                <button
                  onClick={() => setActiveTab('memory')}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'memory' ? 'bg-pink-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <Save size={18} />
                  Memory
                </button>
                <button
                  onClick={() => setActiveTab('music')}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'music' ? 'bg-pink-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <Music size={18} />
                  Music
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {activeTab === 'memory' ? (
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    updateProfile({
                      name: formData.get('name') as string,
                      preferences: {
                        ...profile?.preferences,
                        assistantName: formData.get('assistantName') as string,
                        hobbies: formData.get('hobbies') as string,
                        birthday: formData.get('birthday') as string,
                      }
                    });
                  }} className="space-y-8">
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Voice</label>
                      <div className="grid grid-cols-2 gap-4">
                        {[
                          { id: "sara", voiceId: "H6QPv2pQZDcGqLwDTIJQ", label: "sara", icon: <Smile size={24} /> },
                          { id: "aisha", voiceId: "vzov6y10x6nsGNFg883S", label: "Aisha", icon: <Heart size={24} /> },
                          { id: "anshi", voiceId: "UbB19hYD8fvYxwJAVTY5", label: "Anshika", icon: <Zap size={24} /> },
                          { id: "nisha", voiceId: "LWFgMHXb8m0uANBUpzlq", label: "Niahu", icon: <Coffee size={24} /> }
                        ].map((v) => (
                          <div key={v.id} className="relative group">
                            <button
                              type="button"
                              onClick={() => {
                                updateProfile({ 
                                  preferences: { 
                                    ...profile?.preferences, 
                                    voiceId: v.voiceId,
                                    assistantName: v.label
                                  } 
                                });
                              }}
                              className={`w-full p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${
                                (profile?.preferences.voiceId || 'H6QPv2pQZDcGqLwDTIJQ') === v.voiceId
                                  ? 'bg-pink-500/20 border-pink-500 text-white'
                                  : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                              }`}
                            >
                              {v.icon}
                              <span className="font-bold">{v.label}</span>
                            </button>
                            <button 
                              type="button"
                              onClick={() => playVoicePreview(v.voiceId)}
                              className="absolute top-2 right-2 p-1.5 bg-white/10 rounded-full hover:bg-white/20 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Phone size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Assistant Name</label>
                      <input 
                        name="assistantName"
                        type="text"
                        defaultValue={assistantName}
                        placeholder="e.g. sara, Nishu, etc."
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-3 text-white focus:outline-none focus:border-pink-500 transition-colors"
                      />
                    </div>

                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Your Name</label>
                      <input 
                        name="name"
                        defaultValue={profile?.name}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white focus:ring-2 focus:ring-pink-500/50 outline-none transition-all"
                        placeholder="What should I call you?"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Interests</label>
                      <input 
                        name="hobbies"
                        defaultValue={profile?.preferences.hobbies}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white focus:ring-2 focus:ring-pink-500/50 outline-none transition-all"
                        placeholder="What do you love doing?"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Birthday</label>
                      <input 
                        name="birthday"
                        type="date"
                        defaultValue={profile?.preferences.birthday}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white focus:ring-2 focus:ring-pink-500/50 outline-none transition-all"
                      />
                    </div>
                    <button 
                      type="submit"
                      className="w-full py-5 bg-pink-500 hover:bg-pink-600 text-white rounded-2xl font-bold text-lg transition-all shadow-xl shadow-pink-500/30 flex items-center justify-center gap-3 active:scale-95"
                    >
                      <Save size={24} />
                      Change name & Save Details
                    </button>
                    <button 
                      type="button"
                      onClick={() => setShowProfile(false)}
                      className="w-full py-4 bg-white/5 hover:bg-white/10 text-slate-400 rounded-2xl font-bold text-lg transition-all border border-white/10 flex items-center justify-center gap-3 active:scale-95 mt-4"
                    >
                      <X size={24} />
                      Close Settings
                    </button>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                      <Sparkles size={16} className="text-pink-500" />
                      <span className="text-xs font-bold uppercase tracking-widest">Global Top Tracks</span>
                    </div>
                    {topTracks.length > 0 ? topTracks.map((track, idx) => (
                      <a 
                        key={idx} 
                        href={track.url} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group"
                      >
                        <div className="w-10 h-10 bg-pink-500/20 rounded-xl flex items-center justify-center text-pink-500 font-bold">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-white truncate">{track.name}</p>
                          <p className="text-sm text-slate-400 truncate">{track.artist.name}</p>
                        </div>
                        <ExternalLink size={18} className="text-slate-500 group-hover:text-pink-500 transition-colors" />
                      </a>
                    )) : (
                      <div className="text-center py-12 text-slate-500 flex flex-col items-center gap-4">
                        <div className="w-12 h-12 border-4 border-pink-500/20 border-t-pink-500 rounded-full animate-spin" />
                        <p className="font-medium">Fetching the latest hits...</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
