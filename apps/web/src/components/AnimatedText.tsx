import React, { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";

interface AnimatedTextProps {
  text: string;
  className?: string;
  delay?: number;
}

export const AnimatedText: React.FC<AnimatedTextProps> = ({ text, className = "", delay = 0 }) => {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      animate(containerRef.current.querySelectorAll('.char'), {
        opacity: [0, 1],
        translateY: ['1em', 0],
        translateZ: 0,
        ease: 'outExpo',
        duration: 800,
        delay: stagger(30, { start: delay })
      });
    }
  }, [text, delay]);

  // Split text into characters, preserving spaces
  const characters = text.split("").map((char, index) => {
    if (char === " ") {
      return (
        <span key={index} className="char inline-block whitespace-pre opacity-0">
          &nbsp;
        </span>
      );
    }
    return (
      <span key={index} className="char inline-block opacity-0">
        {char}
      </span>
    );
  });

  return (
    <span ref={containerRef} className={`inline-block ${className}`}>
      {characters}
    </span>
  );
};
