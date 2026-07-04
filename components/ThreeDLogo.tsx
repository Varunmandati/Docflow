import React, { useState, useRef } from 'react';
import { LogoIcon } from './Icons';

interface ThreeDLogoProps {
    collapsed?: boolean;
    style?: React.CSSProperties;
}

const ThreeDLogo: React.FC<ThreeDLogoProps> = ({ collapsed = false, style }) => {
    const [rotation, setRotation] = useState({ x: 0, y: 0 });
    const [isHovered, setIsHovered] = useState(false);
    const elementRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!elementRef.current) return;
        const bounds = elementRef.current.getBoundingClientRect();
        const mouseX = e.clientX - bounds.left;
        const mouseY = e.clientY - bounds.top;
        
        // Normalize coordinates from -1 to 1
        const normalizedX = (mouseX / bounds.width) * 2 - 1;
        const normalizedY = (mouseY / bounds.height) * 2 - 1;
        
        const maxRotation = 22; // 22 degrees max tilt
        setRotation({
            x: -normalizedY * maxRotation,
            y: normalizedX * maxRotation
        });
        setIsHovered(true);
    };

    const handleMouseLeave = () => {
        setRotation({ x: 0, y: 0 });
        setIsHovered(false);
    };

    // Card/Container style: 3D perspective scene
    const sceneStyle: React.CSSProperties = {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        height: '64px',
        width: collapsed ? '64px' : '100%',
        perspective: '800px',
        cursor: 'pointer',
        userSelect: 'none',
        overflow: 'visible',
        ...style,
    };

    // Inner element that rotates
    const rotatorStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        width: '100%',
        height: '100%',
        transformStyle: 'preserve-3d',
        transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
        transition: isHovered ? 'transform 0.05s ease-out' : 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
        willChange: 'transform',
    };

    // Layer 1: Logo Icon (pops out further)
    const logoIconStyle: React.CSSProperties = {
        transform: isHovered ? 'translateZ(24px) scale(1.05)' : 'translateZ(0px) scale(1)',
        transition: 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)',
        color: 'var(--logo-color)',
        flexShrink: 0,
        width: '34px',
        height: '34px',
    };

    // Layer 2: Text container (pops out at intermediate depth)
    const textContainerStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        marginLeft: '10px',
        transform: isHovered ? 'translateZ(12px) scale(1.02)' : 'translateZ(0px) scale(1)',
        transition: 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1), max-width 0.3s ease-in-out, opacity 0.3s ease-in-out',
        maxWidth: collapsed ? '0' : '180px',
        opacity: collapsed ? 0 : 1,
    };

    // Subtle background sheen/highlight that moves with rotation
    const sheenStyle: React.CSSProperties = {
        position: 'absolute',
        inset: '4px',
        borderRadius: '8px',
        background: `radial-gradient(circle at ${(rotation.y + 22) * 2.27}% ${(rotation.x + 22) * 2.27}%, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0) 70%)`,
        opacity: isHovered ? 1 : 0,
        transition: 'opacity 0.25s ease-out',
        pointerEvents: 'none',
        transform: 'translateZ(-2px)',
    };

    return (
        <div
            ref={elementRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={sceneStyle}
        >
            <div style={rotatorStyle}>
                {/* Visual glow background layer */}
                <div style={sheenStyle} />
                
                {/* Logo Icon */}
                <LogoIcon style={logoIconStyle} />
                
                {/* Text Title */}
                <div style={textContainerStyle}>
                    <span style={{
                        fontSize: '24px',
                        fontWeight: 600,
                        letterSpacing: '-0.6px',
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                    }}>
                        DocFlow
                    </span>
                </div>
            </div>
        </div>
    );
};

export default ThreeDLogo;
