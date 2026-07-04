import React, { useState, useEffect, useRef } from 'react';

const TrackingEyes: React.FC = () => {
    const [leftOffset, setLeftOffset] = useState({ x: 0, y: 0 });
    const [rightOffset, setRightOffset] = useState({ x: 0, y: 0 });
    
    const leftEyeRef = useRef<HTMLDivElement>(null);
    const rightEyeRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const calculateOffset = (ref: React.RefObject<HTMLDivElement | null>) => {
                if (!ref.current) return { x: 0, y: 0 };
                const rect = ref.current.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                
                const dx = e.clientX - centerX;
                const dy = e.clientY - centerY;
                
                // Keep movement within bounds (max 4.5px offset)
                const distance = Math.min(4.5, Math.hypot(dx, dy) * 0.04);
                const angle = Math.atan2(dy, dx);
                
                return {
                    x: Math.cos(angle) * distance,
                    y: Math.sin(angle) * distance
                };
            };

            setLeftOffset(calculateOffset(leftEyeRef));
            setRightOffset(calculateOffset(rightEyeRef));
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    const containerStyle: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        width: '54px',
        height: '36px',
        position: 'relative',
        verticalAlign: 'middle',
        overflow: 'visible',
    };

    const eyeballStyle: React.CSSProperties = {
        width: '24px',
        height: '36px',
        backgroundColor: '#FFFFFF',
        borderRadius: '12px',
        border: '1.5px solid var(--border-color)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
    };

    const pupilStyle = (offset: { x: number, y: number }): React.CSSProperties => ({
        width: '14px',
        height: '20px',
        backgroundColor: '#0C0C0C',
        borderRadius: '50%',
        position: 'relative',
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        willChange: 'transform',
    });

    const reflectionStyle: React.CSSProperties = {
        width: '3.5px',
        height: '3.5px',
        backgroundColor: '#FFFFFF',
        borderRadius: '50%',
        position: 'absolute',
        bottom: '4px',
        right: '4px',
    };

    return (
        <div style={containerStyle} className="tracking-eyes-container no-glassy">
            {/* Left Eye */}
            <div ref={leftEyeRef} style={eyeballStyle}>
                <div style={pupilStyle(leftOffset)}>
                    <div style={reflectionStyle} />
                </div>
            </div>
            
            {/* Right Eye */}
            <div ref={rightEyeRef} style={eyeballStyle}>
                <div style={pupilStyle(rightOffset)}>
                    <div style={reflectionStyle} />
                </div>
            </div>
        </div>
    );
};

export default TrackingEyes;
export { TrackingEyes };
