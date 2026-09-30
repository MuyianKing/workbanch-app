/**
 * 复制到剪贴板。**两条路都走**：先试 `navigator.clipboard`，不行再落回 `execCommand` 那条老路。
 *
 * 为什么不只留一条：这个页面在壳里是从本地（file:// 或本地端口）加载的，剪贴板权限
 * 可能被系统或壳拦下。而「复制密码」是这个 App 最常用的一步 —— 它必须有一个明确的结果，
 * 失败了要如实说一句，而不是静默地什么都没发生（用户会以为已经复制上了）。
 */

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  try {
    if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限被挡或不在安全上下文里：往下走老路
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    // 只读 + 移出屏幕：避免弹出键盘，也避免页面跳动
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    const done = document.execCommand('copy')
    document.body.removeChild(area)
    return done
  } catch {
    return false
  }
}