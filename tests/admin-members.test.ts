// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_PAGE } from '../server/src/admin-page'

beforeEach(() => { document.documentElement.innerHTML = ADMIN_PAGE; localStorage.clear() })
afterEach(() => { document.documentElement.innerHTML = ''; vi.restoreAllMocks() })

function mount(fetchFn: ReturnType<typeof vi.fn>, confirmFn = vi.fn(() => true)) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(ADMIN_PAGE)![1]
  return new Function('document', 'localStorage', 'fetch', 'setInterval', 'confirm', script +
    '; return {listUsers, listCards, resolvePendingCard};')(document, localStorage, fetchFn, vi.fn(), confirmFn) as {
      listUsers(): Promise<void>; listCards(): Promise<void>
      resolvePendingCard(card: { code: string; usedBy: string; days: number }, action: string): Promise<void>
    }
}

describe('Admin legacy migration and pending card recovery', () => {
  it('continues paginated member import before showing the final list', async () => {
    let page = 0
    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith('/admin/users')) {
        page++
        return Response.json({ migration: { complete: page === 2, scanned: page * 20 },
          users: page === 2 ? [{ user: { email: 'old@example.com' }, entitlement: { plan: 'pro', expiresAt: 1, filterSensitive: true } }] : [] })
      }
      return Response.json({})
    })
    await mount(fetchFn).listUsers()
    expect(page).toBe(2)
    expect(document.getElementById('usersBody')!.textContent).toContain('old@example.com')
  })

  it('offers distinct confirmation and credit actions, and does not settle a claim after cancel', async () => {
    const card = { code: 'YTS-AAAA-BBBB-CCCC', plan: 'pro', days: 30, usedAt: 100, pending: true,
      usedBy: 'old@example.com', appliedExpiresAt: 1000 }
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.startsWith('/admin/cards?')
      ? { cards: [card], migration: { complete: true } } : {}))
    const confirmFn = vi.fn(() => false)
    const controls = mount(fetchFn, confirmFn)
    await controls.listCards()
    expect(document.getElementById('cardsBody')!.textContent).toContain('待核对')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#cardsBody button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['补发权益', '确认已到账'])
    buttons[0].click()
    expect(confirmFn).toHaveBeenCalled()
    expect(fetchFn.mock.calls.some(([url]) => url === '/admin/cards/resolve')).toBe(false)
    confirmFn.mockReturnValue(true)
    await controls.resolvePendingCard(card, 'confirm')
    expect(fetchFn.mock.calls.some(([url, init]) =>
      url === '/admin/cards/resolve' && JSON.parse(String(init?.body)).action === 'confirm')).toBe(true)
  })
})
