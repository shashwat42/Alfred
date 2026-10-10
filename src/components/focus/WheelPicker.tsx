import React, { useRef, useCallback, useState, useEffect } from "react";

interface WheelPickerProps {
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    label?: string;
}

export function WheelPicker({
    value,
    onChange,
    min = 0,
    max = 90,
    step = 1,
    disabled = false,
}: WheelPickerProps) {
    const startYRef = useRef<number | null>(null);
    const accumDeltaRef = useRef(0);
    const [isEditing, setIsEditing] = useState(false);
    const [editVal, setEditVal] = useState(String(value).padStart(2, "0"));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isEditing) {
            setEditVal(String(value).padStart(2, "0"));
        }
    }, [value, isEditing]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const prevVal = value <= min ? max : value - step;
    const nextVal = value >= max ? min : value + step;

    const handleWheel = useCallback(
        (e: React.WheelEvent) => {
            if (disabled || isEditing) return;
            e.preventDefault();
            if (e.deltaY < 0) {
                // Scroll up -> increment
                const next = value >= max ? min : value + step;
                onChange(next);
            } else if (e.deltaY > 0) {
                // Scroll down -> decrement
                const prev = value <= min ? max : value - step;
                onChange(prev);
            }
        },
        [disabled, isEditing, value, min, max, step, onChange]
    );

    const handleTouchStart = (e: React.TouchEvent) => {
        if (disabled || isEditing) return;
        startYRef.current = e.touches[0].clientY;
        accumDeltaRef.current = 0;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (disabled || isEditing || startYRef.current === null) return;
        const currentY = e.touches[0].clientY;
        const delta = startYRef.current - currentY;

        // Threshold of 28px per step
        if (Math.abs(delta) >= 28) {
            if (delta > 0) {
                const next = value >= max ? min : value + step;
                onChange(next);
            } else {
                const prev = value <= min ? max : value - step;
                onChange(prev);
            }
            startYRef.current = currentY;
        }
    };

    const handleTouchEnd = () => {
        startYRef.current = null;
    };

    const formatNum = (n: number) => String(n).padStart(2, "0");

    const commitEdit = () => {
        const parsed = parseInt(editVal, 10);
        if (!isNaN(parsed)) {
            const clamped = Math.min(max, Math.max(min, parsed));
            onChange(clamped);
            setEditVal(String(clamped).padStart(2, "0"));
        } else {
            setEditVal(String(value).padStart(2, "0"));
        }
        setIsEditing(false);
    };

    return (
        <div
            className="wheel-picker-drum"
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            role="spinbutton"
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            onKeyDown={(e) => {
                if (disabled || isEditing) return;
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    onChange(value >= max ? min : value + step);
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    onChange(value <= min ? max : value - step);
                }
            }}
        >
            {/* Top / Previous Value (faded) */}
            <div
                className="wheel-item wheel-item-prev"
                onClick={() => !disabled && !isEditing && onChange(prevVal)}
                title="Scroll up"
            >
                {formatNum(prevVal)}
            </div>

            {/* Center / Active Value with inline click-to-edit */}
            {isEditing ? (
                <div className="wheel-item wheel-item-active is-editing">
                    <input
                        ref={inputRef}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        className="wheel-inline-input"
                        value={editVal}
                        onChange={(e) => {
                            const cleaned = e.target.value.replace(/\D/g, "");
                            setEditVal(cleaned);
                        }}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit();
                            } else if (e.key === "Escape") {
                                setIsEditing(false);
                                setEditVal(String(value).padStart(2, "0"));
                            }
                        }}
                    />
                </div>
            ) : (
                <div
                    className="wheel-item wheel-item-active"
                    onClick={() => {
                        if (!disabled) {
                            setIsEditing(true);
                        }
                    }}
                    title="Click to type custom duration"
                >
                    {formatNum(value)}
                </div>
            )}

            {/* Bottom / Next Value (faded) */}
            <div
                className="wheel-item wheel-item-next"
                onClick={() => !disabled && !isEditing && onChange(nextVal)}
                title="Scroll down"
            >
                {formatNum(nextVal)}
            </div>
        </div>
    );
}
