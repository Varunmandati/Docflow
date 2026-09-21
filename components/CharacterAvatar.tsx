import React, { useState } from 'react';

interface CharacterAvatarProps {
    name: string;
    size?: number;
    isHoveredExternal?: boolean;
}

const CharacterAvatar: React.FC<CharacterAvatarProps> = ({ name, size = 36, isHoveredExternal }) => {
    const [hoveredInternal, setHoveredInternal] = useState(false);
    const hovered = isHoveredExternal !== undefined ? isHoveredExternal : hoveredInternal;

    // Get initials (up to 2 characters)
    const getInitials = (str: string) => {
        const normalized = str?.trim() || 'Guest';
        const parts = normalized.split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return normalized.slice(0, 2).toUpperCase();
    };

    const initials = getInitials(name);

    // Deterministic selection of gradient based on username
    const getGradient = (str: string) => {
        let hash = 0;
        const normalized = str || 'Guest';
        for (let i = 0; i < normalized.length; i++) {
            hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % gradients.length;
        return gradients[index];
    };

    const gradients = [
        'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)',
        'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
        'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
        'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
        'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
        'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
    ];

    const background = getGradient(name);

    return (
        <div
            onMouseEnter={() => setHoveredInternal(true)}
            onMouseLeave={() => setHoveredInternal(false)}
            className="flex items-center justify-center rounded-full overflow-hidden transition-all duration-300 select-none"
            style={{
                width: `${size}px`,
                height: `${size}px`,
                background,
                transform: hovered ? 'scale(1.08)' : 'scale(1)',
                cursor: 'pointer',
                boxShadow: hovered
                    ? '0 4px 12px rgba(0,0,0,0.15), inset 0 0 0 2px rgba(255,255,255,0.4)'
                    : '0 2px 5px rgba(0,0,0,0.1)',
                color: 'white',
                fontWeight: 600,
                fontSize: `${size * 0.4}px`,
                letterSpacing: '0.5px',
                textShadow: '0 1px 2px rgba(0,0,0,0.2)',
            }}
            title={name || 'User'}
        >
            <span style={{
                transform: hovered ? 'scale(1.05)' : 'scale(1)',
                transition: 'transform 0.2s ease-out'
            }}>
                {initials}
            </span>
        </div>
    );
};

export default CharacterAvatar;
export { CharacterAvatar };
