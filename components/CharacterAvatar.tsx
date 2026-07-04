import React, { useState } from 'react';

interface CharacterAvatarProps {
    name: string;
    size?: number;
    isHoveredExternal?: boolean; // Can be controlled externally if needed
}

const CharacterAvatar: React.FC<CharacterAvatarProps> = ({ name, size = 36, isHoveredExternal }) => {
    const [hoveredInternal, setHoveredInternal] = useState(false);
    const hovered = isHoveredExternal !== undefined ? isHoveredExternal : hoveredInternal;

    // Deterministic selection of character variant based on username
    const getCharacterVariant = (str: string) => {
        let hash = 0;
        const normalized = str || 'Guest';
        for (let i = 0; i < normalized.length; i++) {
            hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % 4;
        const variants = ['Boy 1', 'Girl 1', 'Boy 2', 'Girl 2'];
        return variants[index];
    };

    const variant = getCharacterVariant(name);

    // Common background styles
    const bgColor = '#181a20'; // Binance ink / near black background for the avatar disk
    const strokeColor = '#000000';

    // SVG paths and rendering based on variants
    const renderCharacterSVG = () => {
        const eyeTransitionStyle = {
            transition: 'transform 0.15s ease-out, d 0.15s ease-out',
            transformOrigin: 'center'
        };

        const mouthTransitionStyle = {
            transition: 'd 0.2s ease-in-out, transform 0.2s ease-in-out',
            transformOrigin: 'center'
        };

        switch (variant) {
            case 'Boy 1':
                // Short hair, glasses / wink look on hover
                return (
                    <g>
                        {/* Head */}
                        <circle cx="12" cy="12" r="7.5" fill="#FFE0B2" stroke={strokeColor} strokeWidth="1" />
                        
                        {/* Short spikey hair */}
                        <path d="M 4 10 C 4 6, 8 4, 12 4.5 C 16 4, 20 6, 20 10 C 19 8, 17 7, 15 7.5 C 14 7, 10 7, 9 7.5 C 7 7, 5 8, 4 10 Z" fill="#4E342E" stroke={strokeColor} strokeWidth="1" />
                        
                        {/* Eyes */}
                        {hovered ? (
                            <>
                                {/* Left eye: winking arc */}
                                <path d="M 7.5 11 Q 9 12.5 10.5 11" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={eyeTransitionStyle} />
                                {/* Right eye: blink arc */}
                                <path d="M 13.5 11 Q 15 12.5 16.5 11" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={eyeTransitionStyle} />
                            </>
                        ) : (
                            <>
                                {/* Normal open circular eyes */}
                                <circle cx="9" cy="11.5" r="1" fill={strokeColor} style={eyeTransitionStyle} />
                                <circle cx="15" cy="11.5" r="1" fill={strokeColor} style={eyeTransitionStyle} />
                            </>
                        )}

                        {/* Mouth */}
                        {hovered ? (
                            /* Wide open happy smile */
                            <path d="M 10 14.5 Q 12 17.5 14 14.5 Z" fill="#FF5252" stroke={strokeColor} strokeWidth="0.8" style={mouthTransitionStyle} />
                        ) : (
                            /* Simple happy arc */
                            <path d="M 10.5 14.5 Q 12 16 13.5 14.5" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={mouthTransitionStyle} />
                        )}
                    </g>
                );

            case 'Girl 1':
                // Long side hair, eyelashes winking on hover
                return (
                    <g>
                        {/* Long hair background */}
                        <path d="M 4 11 C 4 16, 5 20, 5 20 C 6 20, 7 15, 7 12 Z" fill="#D81B60" stroke={strokeColor} strokeWidth="0.8" />
                        <path d="M 20 11 C 20 16, 19 20, 19 20 C 18 20, 17 15, 17 12 Z" fill="#D81B60" stroke={strokeColor} strokeWidth="0.8" />

                        {/* Head */}
                        <circle cx="12" cy="12" r="7.2" fill="#FFF9C4" stroke={strokeColor} strokeWidth="1" />
                        
                        {/* Hair Front */}
                        <path d="M 4.5 10 C 6 5, 18 5, 19.5 10 C 18 8, 14 7, 12 8 C 10 7, 6 8, 4.5 10 Z" fill="#D81B60" stroke={strokeColor} strokeWidth="1" />
                        
                        {/* Eyes */}
                        {hovered ? (
                            <>
                                {/* Winking left eye */}
                                <path d="M 7.5 11 Q 9 9.5 10.5 11" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={eyeTransitionStyle} />
                                {/* Smiling right eye */}
                                <path d="M 13.5 11 Q 15 9.5 16.5 11" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={eyeTransitionStyle} />
                            </>
                        ) : (
                            <>
                                {/* Cute eyelashes eyes */}
                                <circle cx="9" cy="11" r="0.9" fill={strokeColor} style={eyeTransitionStyle} />
                                <circle cx="15" cy="11" r="0.9" fill={strokeColor} style={eyeTransitionStyle} />
                                <path d="M 7.8 10.2 L 8.5 10.8" stroke={strokeColor} strokeWidth="0.8" strokeLinecap="round" />
                                <path d="M 16.2 10.2 L 15.5 10.8" stroke={strokeColor} strokeWidth="0.8" strokeLinecap="round" />
                            </>
                        )}

                        {/* Mouth */}
                        {hovered ? (
                            <circle cx="12" cy="15" r="1.2" fill="#E91E63" stroke={strokeColor} strokeWidth="0.8" style={mouthTransitionStyle} />
                        ) : (
                            <path d="M 10.5 14.5 Q 12 16 13.5 14.5" stroke={strokeColor} strokeWidth="0.8" fill="none" strokeLinecap="round" style={mouthTransitionStyle} />
                        )}
                    </g>
                );

            case 'Boy 2':
                // Curly hair, cool glasses or closed eyes blinking
                return (
                    <g>
                        {/* Head */}
                        <circle cx="12" cy="12" r="7.5" fill="#FFD54F" stroke={strokeColor} strokeWidth="1" />
                        
                        {/* Curly hair bun top */}
                        <circle cx="9" cy="5" r="2" fill="#263238" stroke={strokeColor} strokeWidth="0.8" />
                        <circle cx="12" cy="4" r="2.2" fill="#263238" stroke={strokeColor} strokeWidth="0.8" />
                        <circle cx="15" cy="5" r="2" fill="#263238" stroke={strokeColor} strokeWidth="0.8" />
                        
                        {/* Front Hair line */}
                        <path d="M 4.5 10 C 6 6, 18 6, 19.5 10 C 17 8.5, 15 8, 12 9 C 9 8, 7 8.5, 4.5 10 Z" fill="#263238" stroke={strokeColor} strokeWidth="0.8" />

                        {/* Eyes */}
                        {hovered ? (
                            <>
                                {/* Closed winking arcs */}
                                <path d="M 7.5 11.5 Q 9 10 10.5 11.5" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={eyeTransitionStyle} />
                                <path d="M 13.5 11.5 Q 15 10 16.5 11.5" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={eyeTransitionStyle} />
                            </>
                        ) : (
                            <>
                                {/* Standard cool look */}
                                <circle cx="9" cy="11.5" r="1" fill={strokeColor} style={eyeTransitionStyle} />
                                <circle cx="15" cy="11.5" r="1" fill={strokeColor} style={eyeTransitionStyle} />
                            </>
                        )}

                        {/* Mouth */}
                        {hovered ? (
                            <path d="M 10 14.2 Q 12 16.2 14 14.2" stroke={strokeColor} strokeWidth="1.2" fill="none" strokeLinecap="round" style={mouthTransitionStyle} />
                        ) : (
                            <path d="M 11 14.5 Q 12 15.2 13 14.5" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={mouthTransitionStyle} />
                        )}
                    </g>
                );

            case 'Girl 2':
                // Hair in high side buns / winking smile
                return (
                    <g>
                        {/* Buns */}
                        <circle cx="4.5" cy="7" r="2.5" fill="#E65100" stroke={strokeColor} strokeWidth="0.8" />
                        <circle cx="19.5" cy="7" r="2.5" fill="#E65100" stroke={strokeColor} strokeWidth="0.8" />

                        {/* Head */}
                        <circle cx="12" cy="12" r="7.5" fill="#F8BBD0" stroke={strokeColor} strokeWidth="1" />
                        
                        {/* Bangs hair */}
                        <path d="M 4.5 9.5 Q 12 6.5 19.5 9.5 Q 16 7.5 12 8 Q 8 7.5 4.5 9.5 Z" fill="#E65100" stroke={strokeColor} strokeWidth="0.8" />

                        {/* Eyes */}
                        {hovered ? (
                            <>
                                <path d="M 7.5 11 Q 9 12.5 10.5 11" stroke={strokeColor} strokeWidth="1" fill="none" strokeLinecap="round" style={eyeTransitionStyle} />
                                <path d="M 13.5 11.2 L 16.5 11.2" stroke={strokeColor} strokeWidth="1.2" strokeLinecap="round" style={eyeTransitionStyle} />
                            </>
                        ) : (
                            <>
                                <circle cx="9" cy="11" r="1" fill={strokeColor} style={eyeTransitionStyle} />
                                <circle cx="15" cy="11" r="1" fill={strokeColor} style={eyeTransitionStyle} />
                            </>
                        )}

                        {/* Mouth */}
                        {hovered ? (
                            <path d="M 10 14 Q 12 17 14 14 Z" fill="#FF80AB" stroke={strokeColor} strokeWidth="0.8" style={mouthTransitionStyle} />
                        ) : (
                            <path d="M 10.5 14 Q 12 15.5 13.5 14" stroke={strokeColor} strokeWidth="0.8" fill="none" strokeLinecap="round" style={mouthTransitionStyle} />
                        )}
                    </g>
                );

            default:
                return null;
        }
    };

    return (
        <div
            onMouseEnter={() => setHoveredInternal(true)}
            onMouseLeave={() => setHoveredInternal(false)}
            className="flex items-center justify-center rounded-full overflow-hidden transition-all duration-300"
            style={{
                width: `${size}px`,
                height: `${size}px`,
                transform: hovered ? 'scale(1.12) rotate(2deg)' : 'scale(1) rotate(0deg)',
                cursor: 'pointer',
                backgroundColor: bgColor,
                boxShadow: hovered 
                    ? '0 4px 12px rgba(252, 213, 53, 0.3), inset 0 0 0 2px var(--primary-color)' 
                    : 'none',
                border: '1px solid var(--border-color)',
            }}
            title={name}
        >
            <svg
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{
                    transition: 'transform 0.2s ease-out',
                    transform: hovered ? 'translateY(0.5px)' : 'translateY(0)'
                }}
            >
                {renderCharacterSVG()}
            </svg>
        </div>
    );
};

export default CharacterAvatar;
export { CharacterAvatar };
