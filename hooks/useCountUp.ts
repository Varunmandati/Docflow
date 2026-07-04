import { useEffect, useRef, useState } from 'react';

interface UseCountUpOptions {
    duration?: number;
    easing?: (progress: number) => number;
}

/**
 * Animate numbers from 0 to target
 * @param target End value
 * @param duration Animation duration in ms (default: 600ms)
 * @param easing Easing function (default: easeOutCubic)
 */
export function useCountUp(
    target: number,
    { duration = 600, easing }: UseCountUpOptions = {}
): number {
    const [count, setCount] = useState(0);
    const hasRunRef = useRef(false);

    useEffect(() => {
        if (hasRunRef.current || target === 0) return;
        hasRunRef.current = true;

        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
        const easingFn = easing || easeOutCubic;

        const startTime = performance.now();
        let animationFrameId: number;

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easingFn(progress);
            const currentCount = Math.floor(target * easedProgress);

            setCount(currentCount);

            if (progress < 1) {
                animationFrameId = requestAnimationFrame(animate);
            }
        };

        animationFrameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrameId);
    }, [target, duration, easing]);

    return count;
}
