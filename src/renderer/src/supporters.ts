/* ─── 支持者名单 ───
 * 在此直接添加/删除支持者。
 * 修改后发新版本，所有用户安装即可看到更新。
 *
 * 字段说明：
 * - name:    显示名称（必填）
 * - link:    点击跳转的链接，如 GitHub 主页（可选）
 * - avatar:  头像图片 URL，省略时显示首字母圆形头像（可选）
 * - note:    备注如"捐赠""贡献代码""测试"（可选）
 * - color:   头像背景色 #xxxxxx（可选，默认 #1677ff）
 * ─────────────────────────────────────
 */

export interface Supporter {
  name: string
  link?: string
  avatar?: string
  note?: string
  color?: string
}

// ★ 在此编辑支持者名单
export const supporters: Supporter[] = [
  { name: '你的第一个支持者', link: 'https://github.com/example', note: '捐赠', color: '#1677ff' },
  // 继续添加：
  // { name: '支持者B', link: 'https://github.com/xxx', note: '贡献代码', color: '#52c41a' },
  // { name: '支持者C', link: 'https://github.com/yyy', note: '测试反馈' },
]