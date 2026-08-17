import { useEffect, useRef, useState } from 'react'

/**
 * Renders at the container's real width so axis text keeps its size at any
 * breakpoint. Extracted from LineChart when the hypnogram needed the same
 * thing — a second copy would drift.
 */
export function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    setWidth(node.clientWidth)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
