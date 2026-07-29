import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExportTab from '../../src/renderer/src/components/Settings/tabs/ExportTab'

// Mock useLlmStore so ExportTab renders in isolation
const mockStore = {
  minDuration: 5,
  maxDuration: 60,
  variantCount: 5,
  topFluencyOnly: false,
  enableSubtitle: true,
  exportResolution: '1080' as const,
  setMinDuration: vi.fn(),
  setMaxDuration: vi.fn(),
  setVariantCount: vi.fn(),
  setTopFluencyOnly: vi.fn(),
  setEnableSubtitle: vi.fn(),
  setExportResolution: vi.fn()
}

vi.mock('../../src/renderer/src/stores/useLlmStore', () => ({
  useLlmStore: () => mockStore
}))

describe('ExportTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.topFluencyOnly = false
    mockStore.enableSubtitle = true
    mockStore.exportResolution = '1080'
  })

  it('renders duration and variant count inputs', () => {
    render(<ExportTab />)
    expect(screen.getByText('最小秒')).toBeInTheDocument()
    expect(screen.getByText('最大秒')).toBeInTheDocument()
    expect(screen.getByText('变体数')).toBeInTheDocument()
  })

  it('shows current values from store', () => {
    render(<ExportTab />)
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs).toHaveLength(3)
    expect((inputs[0] as HTMLInputElement).value).toBe('5')   // minDuration
    expect((inputs[1] as HTMLInputElement).value).toBe('60')  // maxDuration
    expect((inputs[2] as HTMLInputElement).value).toBe('5')   // variantCount
  })

  it('calls setMinDuration when min input changes', () => {
    render(<ExportTab />)
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0]!, { target: { value: '3' } })
    expect(mockStore.setMinDuration).toHaveBeenCalledWith(3)
  })

  it('renders all four resolution buttons', () => {
    render(<ExportTab />)
    expect(screen.getByText('720P')).toBeInTheDocument()
    expect(screen.getByText('1080P')).toBeInTheDocument()
    expect(screen.getByText('2K')).toBeInTheDocument()
    expect(screen.getByText('原画')).toBeInTheDocument()
  })

  it('calls setExportResolution when a resolution button is clicked', () => {
    render(<ExportTab />)
    fireEvent.click(screen.getByText('720P'))
    expect(mockStore.setExportResolution).toHaveBeenCalledWith('720')
  })

  it('shows topFluencyOnly description off by default', () => {
    render(<ExportTab />)
    expect(screen.getByText('按设定变体数生成')).toBeInTheDocument()
  })

  it('shows topFluencyOnly description on when enabled', () => {
    mockStore.topFluencyOnly = true
    render(<ExportTab />)
    expect(screen.getByText('生成后只保留最通顺的 Top3')).toBeInTheDocument()
  })

  it('toggles topFluencyOnly when switch box is clicked', () => {
    render(<ExportTab />)
    // click the switch div that wraps 仅保留通顺度最高 3 条
    const title = screen.getByText('仅保留通顺度最高 3 条')
    // travel up to the optionBox div
    fireEvent.click(title.closest('div[style]')!)
    expect(mockStore.setTopFluencyOnly).toHaveBeenCalledWith(true)
  })

  it('shows subtitle description when enabled', () => {
    render(<ExportTab />)
    expect(screen.getByText('导出时默认嵌入字幕')).toBeInTheDocument()
  })

  it('shows current resolution in description text', () => {
    render(<ExportTab />)
    expect(screen.getByText('当前：最长边适配 1080P')).toBeInTheDocument()
  })
})
