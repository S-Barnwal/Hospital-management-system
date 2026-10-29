import { motion, useReducedMotion } from 'motion/react';

/** Subtle fade-up on scroll. Respects prefers-reduced-motion. */
export default function Reveal({ children, delay = 0, className, as = 'div' }) {
  const reduce = useReducedMotion();
  const Comp = motion[as] ?? motion.div;
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Comp>
  );
}
