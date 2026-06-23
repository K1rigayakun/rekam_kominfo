import React, { useRef, useState, useEffect } from "react";
import { animate } from "animejs";

interface MagneticButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  form?: string;
}

export const MagneticButton: React.FC<MagneticButtonProps> = ({ 
  children, 
  className = "", 
  onClick, 
  title,
  disabled = false,
  type = "button",
  form
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (!buttonRef.current) return;
    
    // Reset position if hover ends
    if (!isHovered) {
      animate(buttonRef.current, {
        translateX: 0,
        translateY: 0,
        ease: 'outElastic(1, .5)',
        duration: 1000
      });
    }
  }, [isHovered]);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!buttonRef.current || disabled) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // Calculate distance from center (-1 to 1)
    const distanceX = (e.clientX - centerX) / (rect.width / 2);
    const distanceY = (e.clientY - centerY) / (rect.height / 2);

    // Max translation in pixels (e.g., 10px pull)
    const pullFactor = 10;
    
    animate(buttonRef.current, {
      translateX: distanceX * pullFactor,
      translateY: distanceY * pullFactor,
      ease: 'outSine',
      duration: 100
    });
  };

  return (
    <button
      ref={buttonRef}
      className={`${className} will-change-transform`}
      onClick={onClick}
      title={title}
      disabled={disabled}
      type={type}
      form={form}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseMove={handleMouseMove}
    >
      {children}
    </button>
  );
};
