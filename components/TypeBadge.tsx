import React from 'react';

interface TypeBadgeProps {
    type: 'Convert' | 'Compress';
}

const TypeBadge: React.FC<TypeBadgeProps> = ({ type }) => {
    const isDark = document.documentElement.classList.contains('dark');
    
    const styles = {
        Convert: {
            light: { background: '#EEF2FF', color: '#4338CA' },
            dark: { background: '#312E81', color: '#C7D2FE' }
        },
        Compress: {
            light: { background: '#F0FDF4', color: '#15803D' },
            dark: { background: '#14532D', color: '#BBF7D0' }
        }
    };

    const style = isDark ? styles[type].dark : styles[type].light;

    return (
        <span
            style={{
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: style.background,
                color: style.color
            }}
        >
            {type}
        </span>
    );
};

export default TypeBadge;
