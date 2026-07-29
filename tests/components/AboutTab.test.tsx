import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AboutTab from '../../src/renderer/src/components/Settings/tabs/AboutTab'

describe('AboutTab', () => {
  const onOpenExternal = vi.fn()

  beforeEach(() => {
    onOpenExternal.mockClear()
  })

  it('renders app name, subtitle, and version', () => {
    render(<AboutTab onOpenExternal={onOpenExternal} />)
    expect(screen.getByText('口播智剪')).toBeInTheDocument()
    expect(screen.getByText('KBCut · 千川投流口播重组工具')).toBeInTheDocument()
    // __APP_VERSION__ is injected as '0.0.0-test' by vitest.config.ts define
    expect(screen.getByText(/^v/)).toBeInTheDocument()
  })

  it('renders platform and license info', () => {
    render(<AboutTab onOpenExternal={onOpenExternal} />)
    expect(screen.getByText('平台：Windows 10/11 x64')).toBeInTheDocument()
    expect(screen.getByText('协议：MIT')).toBeInTheDocument()
    expect(screen.getByText('作者：CGLY')).toBeInTheDocument()
  })

  it('renders all four link buttons', () => {
    render(<AboutTab onOpenExternal={onOpenExternal} />)
    expect(screen.getByText('GitHub 仓库')).toBeInTheDocument()
    expect(screen.getByText('从零开始指南')).toBeInTheDocument()
    expect(screen.getByText('语音识别教程')).toBeInTheDocument()
    expect(screen.getByText('Release 下载')).toBeInTheDocument()
  })

  it('calls onOpenExternal with GitHub URL when GitHub button is clicked', () => {
    render(<AboutTab onOpenExternal={onOpenExternal} />)
    fireEvent.click(screen.getByText('GitHub 仓库'))
    expect(onOpenExternal).toHaveBeenCalledOnce()
    expect(onOpenExternal).toHaveBeenCalledWith('https://github.com/cglyvip/kbcut')
  })

  it('calls onOpenExternal with releases URL for Release 下载', () => {
    render(<AboutTab onOpenExternal={onOpenExternal} />)
    fireEvent.click(screen.getByText('Release 下载'))
    expect(onOpenExternal).toHaveBeenCalledWith('https://github.com/cglyvip/kbcut/releases')
  })

  it('renders the acknowledgment section with GGgrok link', () => {
    render(<AboutTab onOpenExternal={onOpenExternal} />)
    expect(screen.getByText('致谢')).toBeInTheDocument()
    const link = screen.getByText('GGgrok')
    expect(link).toBeInTheDocument()
    fireEvent.click(link)
    expect(onOpenExternal).toHaveBeenCalledWith('https://xiaoxiaobai.me/')
  })
})
