import React, { useEffect } from 'react';

interface LoginTransitionScreenProps {
  onComplete: () => void;
}

const INTRO_DURATION_MS = 9000;
const BTS_LETTERS = ['B', 'T', 'S'];

export function LoginTransitionScreen({ onComplete }: LoginTransitionScreenProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, INTRO_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [onComplete]);

  return (
    <div className="login-intro">
      <div className="login-intro__background" aria-hidden="true">
        <span className="login-intro__glow login-intro__glow--left" />
        <span className="login-intro__glow login-intro__glow--right" />
      </div>

      <div className="login-intro__content" role="status" aria-live="polite">
        <div className="login-intro__ring" aria-hidden="true" />

        <div className="login-intro__letters" aria-hidden="true">
          {BTS_LETTERS.map((letter, index) => (
            <span
              key={letter}
              className="login-intro__letter"
              style={{ '--intro-delay': `${index * 0.75}s` } as React.CSSProperties}
            >
              {letter}
            </span>
          ))}
        </div>

        <p className="login-intro__school-name">
          Benguet Technical School
          <br />
          Property Inventory Management System
        </p>
        <p className="login-intro__message">Preparing your dashboard...</p>
      </div>
    </div>
  );
}
