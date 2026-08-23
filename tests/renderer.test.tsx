// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { usePersistentState } from '../src/renderer/src/hooks/usePersistentState'
import WordSpans from '../src/renderer/src/components/WordSpans'

describe('usePersistentState', () => {
  it('读写 localStorage；新实例读到持久化值', () => {
    localStorage.clear()
    const { result } = renderHook(() => usePersistentState<boolean>('t-key', false))
    expect(result.current[0]).toBe(false)
    act(() => result.current[1](true))
    expect(result.current[0]).toBe(true)
    expect(localStorage.getItem('t-key')).toBe('1')
    const again = renderHook(() => usePersistentState<boolean>('t-key', false))
    expect(again.result.current[0]).toBe(true)
  })

  it('读取值越界时回退默认', () => {
    localStorage.setItem('t-width', '9999')
    const { result } = renderHook(() =>
      usePersistentState<number>('t-width', 320, (v) => v >= 260 && v <= 640)
    )
    expect(result.current[0]).toBe(320)
  })
})

describe('WordSpans', () => {
  it('点击单词触发 onWord，首尾标点被清洗', () => {
    const onWord = vi.fn()
    const { container } = render(<WordSpans text="Hello, world!" onWord={onWord} />)
    const words = container.querySelectorAll('.word')
    expect(words).toHaveLength(2)
    fireEvent.click(words[0])
    expect(onWord.mock.calls[0][0]).toBe('Hello')
    expect(onWord.mock.calls[0][2]).toBe('Hello, world!')
  })

  it('生词本单词带 known 高亮类', () => {
    const { container } = render(
      <WordSpans text="apple pie" knownWords={new Set(['apple'])} onWord={() => {}} />
    )
    const words = container.querySelectorAll('.word')
    expect(words[0].className).toContain('known')
    expect(words[1].className).not.toContain('known')
  })
})
