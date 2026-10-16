import { useLayoutEffect, useRef } from 'react'

/** Draw the bubble and tail together so browser zoom cannot separate their borders. */
export function MessageBubbleOutline({ own, showAuthor }: { own: boolean; showAuthor: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)

  useLayoutEffect(() => {
    const svg = svgRef.current
    const path = pathRef.current
    const bubble = svg?.parentElement
    if (!svg || !path || !bubble) return

    const draw = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return
      const style = getComputedStyle(bubble)
      const near = parseFloat(own ? style.borderTopRightRadius : style.borderTopLeftRadius)
      const far = parseFloat(own ? style.borderTopLeftRadius : style.borderTopRightRadius)
      const bottom = parseFloat(own ? style.borderBottomLeftRadius : style.borderBottomRightRadius)
      path.setAttribute('d', [
        `M.5 ${height - 17.5} V${near + .5}`,
        `A${near} ${near} 0 0 1 ${near + .5} .5`,
        `H${width - far - .5} A${far} ${far} 0 0 1 ${width - .5} ${far + .5}`,
        `V${height - bottom - .5} A${bottom} ${bottom} 0 0 1 ${width - bottom - .5} ${height - .5}`,
        `H-8.5 C-11 ${height - .5} -11.4 ${height - 1.2} -9.2 ${height - 2.5}`,
        `C-3.5 ${height - 6} .5 ${height - 10.5} .5 ${height - 17.5} Z`,
      ].join(' '))
      path.setAttribute('transform', own ? `translate(${width} 0) scale(-1 1)` : '')
      svg.setAttribute('data-ready', '')
    }

    const style = getComputedStyle(bubble)
    draw(parseFloat(style.width), parseFloat(style.height))
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize[0]
      if (size) draw(size.inlineSize, size.blockSize)
    })
    observer.observe(bubble, { box: 'border-box' })
    return () => observer.disconnect()
  }, [own, showAuthor])

  return <svg ref={svgRef} className="message-bubble__tail" aria-hidden="true" focusable="false">
    <path ref={pathRef} />
  </svg>
}
