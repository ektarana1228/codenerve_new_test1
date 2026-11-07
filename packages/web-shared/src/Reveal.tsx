import { motion, useReducedMotion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

// Scroll-reveal wrapper: fades + rises into view once. Honors prefers-reduced-motion
// (renders static, no transform) per design-system accessibility rules.

type RevealProps = {
  children: ReactNode
  /** Seconds of delay before the reveal starts (for staggering). */
  delay?: number
  className?: string
}

export function Reveal({ children, delay = 0, className }: RevealProps) {
  const reduce = useReducedMotion()
  const variants: Variants = {
    hidden: { opacity: 0, y: reduce ? 0 : 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: 'easeOut' } },
  }
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
    >
      {children}
    </motion.div>
  )
}
