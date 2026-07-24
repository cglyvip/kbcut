import { describe, expect, it } from 'vitest'
import { requireFsPath, requireHttpUrlPublic } from '../src/main/utils/path-guard'

describe('path-guard', () => {
  it('accepts absolute windows paths', () => {
    const p = requireFsPath('D:\\videos\\a.mp4', '视频路径')
    expect(p.toLowerCase()).toContain('videos')
  })

  it('rejects relative and scheme paths', () => {
    expect(() => requireFsPath('videos\\a.mp4', '视频路径')).toThrow(/绝对路径/)
    expect(() => requireFsPath('file:///C:/a.mp4', '视频路径')).toThrow(/本地文件路径/)
    expect(() => requireFsPath('C:\\a\\x\0y.mp4', '视频路径')).toThrow(/非法/)
  })

  it('validates http urls', () => {
    expect(requireHttpUrlPublic('https://api.openai.com/v1', 'API')).toContain('https://')
    expect(() => requireHttpUrlPublic('ftp://x', 'API')).toThrow(/http/)
    expect(() => requireHttpUrlPublic('https://user:pass@host/x', 'API')).toThrow(/账号密码/)
  })
})
