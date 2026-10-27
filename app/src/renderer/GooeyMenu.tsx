

import React, { useState, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
const cn=(...values:unknown[])=>values.filter(Boolean).join(' ');

export interface GooeyMenuProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  /** List of menu item labels */
  options?: string[];
  /** Controlled active/selected item */
  value?: string;
  /** Initial selected option if uncontrolled */
  defaultValue?: string;
  /** Controlled open state */
  open?: boolean;
  /** Initial open state if uncontrolled */
  defaultOpen?: boolean;
  /** Callback fired when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Callback fired when an option is selected */
  onSelect?: (option: string, index: number) => void;
  /** Pixel width of the menu pill and panel (default: 306) */
  width?: number;
  /** Additional container styling */
  className?: string;
  reduceMotion?: boolean;
}

const DEFAULT_OPTIONS = ['Home', 'About', 'Projects', 'Contact', 'Book a call', 'Follow us'];

const W = 240;
const PILL_H = 38;
const GAP = 8;
const ROW_H = 34;
const PANEL_PAD = 8;

const DROP_SPRING = { type: 'spring', stiffness: 240, damping: 17, mass: 1 } as const;
const GROW_SPRING = { type: 'spring', stiffness: 210, damping: 22, mass: 1 } as const;
const SNAP_SPRING = { type: 'spring', stiffness: 240, damping: 20, mass: 0.9 } as const;
const ROW_SPRING = { type: 'spring', stiffness: 420, damping: 26 } as const;

/**
 * GooeyMenu creates an ultra-smooth liquid dropdown menu using SVG metaball
 * color matrix filtering and spring physics.
 */
export const GooeyMenu: React.FC<GooeyMenuProps> = ({
  options = DEFAULT_OPTIONS,
  value,
  defaultValue,
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  onSelect,
  width = W,
  className,
  reduceMotion = false,
  ...props
}) => {
  const instanceId=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const filterId=`easyui-goo-drop-${instanceId}`;
  const isControlledOpen = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const open = isControlledOpen ? controlledOpen : internalOpen;

  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof next === 'function' ? next(open) : next;
    if (!isControlledOpen) {
      setInternalOpen(nextVal);
    }
    onOpenChange?.(nextVal);
  };

  const [selected, setSelected] = useState(value ?? defaultValue ?? options[0] ?? 'Home');
  const [activeIndex, setActiveIndex] = useState(
    Math.max(0, options.indexOf(value ?? defaultValue ?? options[0]))
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external controlled value
  useEffect(() => {
    if (value !== undefined) {
      setSelected(value);
      const idx = options.indexOf(value);
      if (idx !== -1) setActiveIndex(idx);
    }
  }, [value, options]);

  // Close on outside click
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      window.addEventListener('pointerdown', handlePointerDown);
    }
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(activeIndex);
    }
  };

  const choose = (index: number) => {
    const opt = options[index];
    if (opt !== undefined) {
      setSelected(opt);
      setActiveIndex(index);
      onSelect?.(opt, index);
    }
    setOpen(false);
  };

  const panelHeight = options.length * ROW_H + PANEL_PAD * 2;
  const panelY = PILL_H + GAP;
  const totalHeight = open ? panelY + panelHeight + 24 : PILL_H;

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={cn('aetherflow-gooey', className)}
      style={{ width }}
      {...props}
    >
      {/* SVG Gooey Metamorphic Matrix Filter */}
      <svg width="0" height="0" className="aetherflow-gooey-filter" aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 22 -14"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div className="aetherflow-gooey-stage" style={{ width, height: totalHeight }}>
        {/* Gooey Surface Layer - Pure Solid Blobs for fast 60fps GPU rasterization */}
        <div
          className="aetherflow-gooey-layer"
          style={{
            filter: `url(#${filterId})`,
            transform: 'translateZ(0)',
            isolation: 'isolate',
          }}
        >
          {/* Top Pill Solid Shape */}
          <div
            className="aetherflow-gooey-blob"
            style={{ width, height: PILL_H, borderRadius: PILL_H / 2 }}
          />

          {/* Morphing Dropping Panel Solid Shape */}
          <motion.div
            className="aetherflow-gooey-blob"
            style={{
              width,
              height: panelHeight,
              transformOrigin: '50% 0%',
              borderRadius: 22,
              willChange: 'transform',
            }}
            initial={false}
            animate={
              open
                ? { y: panelY, scaleY: 1 }
                : { y: 0, scaleY: PILL_H / panelHeight }
            }
            transition={
              reduceMotion ? {duration:0} : open
                ? { y: DROP_SPRING, scaleY: { ...GROW_SPRING, delay: 0.05 } }
                : { y: SNAP_SPRING, scaleY: SNAP_SPRING }
            }
          />
        </div>

        {/* Trigger Header Button */}
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={typeof props['aria-label']==='string'?`${props['aria-label']}: ${selected}`:selected}
          onClick={() => setOpen((o) => !o)}
          className="aetherflow-gooey-trigger"
          style={{ width, height: PILL_H, borderRadius: PILL_H / 2 }}
        >
          <span className="aetherflow-gooey-value">
            {selected}
          </span>
          <motion.svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={{ rotate: open ? 180 : 0 }}
            transition={reduceMotion?{duration:0}:{type:'spring',stiffness:300,damping:20}}
          >
            <path d="m6 9 6 6 6-6" />
          </motion.svg>
        </button>

        {/* List of Options */}
        <AnimatePresence>
          {open && (
            <motion.ul
              role="listbox"
              aria-activedescendant={`gooey-opt-${instanceId}-${activeIndex}`}
              className="aetherflow-gooey-options"
              style={{ top: panelY, width, paddingTop: PANEL_PAD, paddingBottom: PANEL_PAD }}
              initial="closed"
              animate="open"
              exit="closed"
              variants={{
                open: { transition: { staggerChildren: reduceMotion?0:0.035, delayChildren: reduceMotion?0:0.12 } },
                closed: { transition: { staggerChildren: reduceMotion?0:0.015, staggerDirection: -1 } },
              }}
            >
              {options.map((opt, i) => {
                const isActive = i === activeIndex;
                const isCurrentSelected = opt === selected;
                return (
                  <motion.li
                    key={opt}
                    id={`gooey-opt-${instanceId}-${i}`}
                    role="option"
                    aria-selected={isCurrentSelected}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => choose(i)}
                    variants={{
                      open: { opacity: 1, y: 0, transition: reduceMotion?{duration:0}:ROW_SPRING },
                      closed: { opacity: 0, y: -10, transition: reduceMotion?{duration:0}:SNAP_SPRING },
                    }}
                    className={cn(
                      isActive?'aetherflow-gooey-option is-active':'aetherflow-gooey-option'
                    )}
                    style={{ height: ROW_H }}
                  >
                    <span>{opt}</span>
                    {isCurrentSelected && (
                      <span className="aetherflow-gooey-dot" />
                    )}
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default GooeyMenu;

