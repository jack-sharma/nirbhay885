import { motion } from "motion/react";
import { Emotion } from "../lib/gemini";

interface SmileBallProps {
  emotion: Emotion;
  isSpeaking: boolean;
}

export default function SmileBall({ emotion, isSpeaking }: SmileBallProps) {
  const getFaceExpression = () => {
    switch (emotion) {
      case 'happy': return { mouth: "M 20 75 Q 50 100 80 75", eyes: "scale-y-100", color: "orb-gradient" };
      case 'sad': return { mouth: "M 35 95 Q 50 80 65 95", eyes: "scale-y-75", color: "orb-gradient" };
      case 'angry': return { mouth: "M 35 85 L 65 85", eyes: "rotate-12", color: "bg-red-600 shadow-[0_0_60px_rgba(220,38,38,0.8)]" };
      case 'surprised': return { mouth: "M 40 85 Q 50 100 60 85", eyes: "scale-125", color: "orb-gradient" };
      case 'loving': return { mouth: "M 20 75 Q 50 105 80 75", eyes: "scale-110", color: "orb-gradient" };
      case 'excited': return { mouth: "M 15 70 Q 50 110 85 70", eyes: "scale-150", color: "orb-gradient" };
      case 'crying': return { mouth: "M 35 95 Q 50 85 65 95", eyes: "scale-y-50", color: "bg-blue-100 shadow-[0_0_40px_rgba(191,219,254,0.5)]" };
      case 'embarrassed': return { mouth: "M 40 90 Q 50 95 60 90", eyes: "scale-y-90", color: "orb-gradient" };
      default: return { mouth: "M 35 85 Q 50 85 65 85", eyes: "scale-y-100", color: "orb-gradient" };
    }
  };

  const expression = getFaceExpression();

  return (
    <div className="relative w-64 h-64 md:w-72 md:h-72 flex items-center justify-center">
      {/* Main Orb */}
      <motion.div
        animate={{
          y: [0, -10, 0],
        }}
        transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
        className={`${expression.color} relative w-64 h-64 md:w-72 md:h-72 rounded-full flex flex-col items-center justify-center border-4 border-white/20 overflow-hidden transition-colors duration-500`}
      >
        {/* Eyes */}
        <div className="flex gap-10 mb-2 relative z-10">
          {[0, 1].map((i) => (
            <div key={i} className="relative">
              {/* Eyelashes (Subtle) */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex gap-1.5 opacity-40">
                <div className="w-[3px] h-3 bg-[#4A4A4A] -rotate-[35deg] rounded-full" />
                <div className="w-[3px] h-3 bg-[#4A4A4A] rotate-[35deg] rounded-full" />
              </div>
              
              <motion.div 
                animate={{ 
                  height: isSpeaking ? [40, 48, 40] : [40, 40, 0, 40, 40],
                }}
                transition={{
                  times: [0, 0.4, 0.5, 0.6, 1],
                  duration: 3,
                  repeat: Infinity,
                  repeatDelay: 2
                }}
                className={`w-10 bg-[#4A4A4A] rounded-full relative ${expression.eyes}`} 
              >
                {/* Main Eye Reflection */}
                <div className="absolute top-2 left-2 w-4 h-4 bg-white rounded-full opacity-90" />
                {/* Secondary Cute Reflection */}
                <div className="absolute bottom-3 right-2 w-2 h-2 bg-white rounded-full opacity-60" />
              </motion.div>

              {/* Tears for crying */}
              {emotion === 'crying' && (
                <>
                  <motion.div 
                    initial={{ opacity: 0, y: 0 }}
                    animate={{ opacity: [0, 1, 0], y: [0, 60] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0 }}
                    className="absolute top-10 left-1/4 w-3 h-7 bg-blue-400 rounded-full blur-[1px]"
                  />
                  <motion.div 
                    initial={{ opacity: 0, y: 0 }}
                    animate={{ opacity: [0, 1, 0], y: [0, 50] }}
                    transition={{ repeat: Infinity, duration: 1.5, delay: 0.5 }}
                    className="absolute top-10 right-1/4 w-2.5 h-6 bg-blue-300 rounded-full blur-[1px]"
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* Mouth */}
        <div className="relative z-10">
          <svg width="120" height="60" viewBox="0 60 100 60" className="fill-none stroke-call-pink stroke-[6] stroke-round">
            <motion.path
              animate={{ 
                d: isSpeaking 
                  ? "M 30 85 Q 50 115 70 85" // Wider open mouth when speaking
                  : expression.mouth 
              }}
              transition={{ 
                type: "spring", 
                stiffness: 200,
                damping: 10,
                repeat: isSpeaking ? Infinity : 0,
                repeatType: "reverse",
                duration: 0.2
              }}
            />
          </svg>
        </div>

        {/* Blush / Anger Redness */}
        <motion.div 
          animate={{ 
            opacity: emotion === 'embarrassed' ? 0.8 : emotion === 'angry' ? 0.9 : 0.4,
            scale: emotion === 'embarrassed' ? 1.2 : emotion === 'angry' ? 2 : 1,
            backgroundColor: emotion === 'angry' ? "#ef4444" : "#FFC0CB"
          }}
          className="absolute left-10 top-[60%] w-12 h-8 blur-md rounded-full transition-all" 
        />
        <motion.div 
          animate={{ 
            opacity: emotion === 'embarrassed' ? 0.8 : emotion === 'angry' ? 0.9 : 0.4,
            scale: emotion === 'embarrassed' ? 1.2 : emotion === 'angry' ? 2 : 1,
            backgroundColor: emotion === 'angry' ? "#ef4444" : "#FFC0CB"
          }}
          className="absolute right-10 top-[60%] w-12 h-8 blur-md rounded-full transition-all" 
        />
        
        {/* Shine */}
        <div className="absolute top-[10%] left-[20%] w-16 h-8 bg-white/60 blur-md rounded-[100%] rotate-[-20deg]" />
      </motion.div>
    </div>
  );
}
