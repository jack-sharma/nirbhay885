import { motion } from "motion/react";

export default function VoiceWave({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {[...Array(12)].map((_, i) => (
        <motion.div
          key={i}
          animate={{
            height: active ? [8, 32, 8] : 8,
          }}
          transition={{
            repeat: Infinity,
            duration: 0.5 + Math.random() * 0.5,
            delay: i * 0.05,
          }}
          className="w-1 bg-pink-400 rounded-full"
        />
      ))}
    </div>
  );
}
