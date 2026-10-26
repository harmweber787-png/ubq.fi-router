import { afterEach, describe, expect, test } from 'bun:test'
import worker, { resetOriginHealth, type Env } from '../src/worker'
import {
  REWRITTEN_HTML_REMOVED_HEADERS,
  decorateHtmlRevisionFooter,
  hasNoTransformDirective,
  shouldDecorateHtmlResponse,
} from '../src/utils/revision-footer'

const originalFetch = globalThis.fetch
const mappedEnv = { VPS_ORIGIN_MAP: '{"passport.ubq.fi":"origin.ubq.fi","pay.ubq.fi":"origin.ubq.fi"}' } as Env

afterEach(() => {
  globalThis.fetch = originalFetch
  resetOriginHealth()
})

describe('revision footer HTML decoration (#37)', () => {
  test('rewrites eligible HTML responses and strips legacy and modern digest headers', async () => {
    globalThis.fetch = (async () =>
      new Response('<html><body><main>hello</main></body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': '44',
          etag: '"abc123"',
          digest: 'sha-256=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
          'content-digest': 'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:',
          'repr-digest': 'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:',
          'content-md5': '1B2M2Y8AsgTpgAmY7PhCfg==',
          'cache-control': 'public, max-age=60',
        },
      })) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), mappedEnv)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('<footer data-uos-router-revision')
    expect(body).toContain('rev local')
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('etag')).toBeNull()
    expect(res.headers.get('digest')).toBeNull()
    expect(res.headers.get('content-digest')).toBeNull()
    expect(res.headers.get('repr-digest')).toBeNull()
    expect(res.headers.get('content-md5')).toBeNull()
    expect(REWRITTEN_HTML_REMOVED_HEADERS).toContain('content-digest')
    expect(REWRITTEN_HTML_REMOVED_HEADERS).toContain('repr-digest')
  })

  test('skips decoration and preserves digest headers when response has Cache-Control: no-transform', async () => {
    const originalHtml = '<html><body><main>byte-exact</main></body></html>'
    globalThis.fetch = (async () =>
      new Response(originalHtml, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, no-transform, max-age=300',
          'content-digest': 'sha-256=:original-content-digest:',
          'repr-digest': 'sha-256=:original-repr-digest:',
          etag: '"exact-etag"',
        },
      })) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), mappedEnv)
    const body = await res.text()

    expect(body).toBe(originalHtml)
    expect(res.headers.get('content-digest')).toBe('sha-256=:original-content-digest:')
    expect(res.headers.get('repr-digest')).toBe('sha-256=:original-repr-digest:')
    expect(res.headers.get('etag')).toBe('"exact-etag"')
  })

  test('skips decoration and preserves digest headers when request has Cache-Control: no-transform', async () => {
    const originalHtml = '<html><body><main>request-no-transform</main></body></html>'
    globalThis.fetch = (async () =>
      new Response(originalHtml, {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'content-digest': 'sha-256=:req-content-digest:',
          'repr-digest': 'sha-256=:req-repr-digest:',
        },
      })) as unknown as typeof fetch

    const res = await worker.fetch(
      new Request('https://pay.ubq.fi/', {
        headers: { 'cache-control': 'no-cache, NO-TRANSFORM' },
      }),
      mappedEnv,
    )
    const body = await res.text()

    expect(body).toBe(originalHtml)
    expect(res.headers.get('content-digest')).toBe('sha-256=:req-content-digest:')
    expect(res.headers.get('repr-digest')).toBe('sha-256=:req-repr-digest:')
  })

  test('unit helpers parse no-transform tokens accurately', async () => {
    expect(hasNoTransformDirective(null)).toBe(false)
    expect(hasNoTransformDirective('public, max-age=60')).toBe(false)
    expect(hasNoTransformDirective('no-transform')).toBe(true)
    expect(hasNoTransformDirective('private, No-Transform, max-age=0')).toBe(true)

    const htmlRes = new Response('<html><body>ok</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html', 'content-digest': 'sha-256=:abc:' },
    })
    const noTransformReq = new Request('https://pay.ubq.fi/', {
      headers: { 'cache-control': 'no-transform' },
    })
    expect(shouldDecorateHtmlResponse(noTransformReq, htmlRes)).toBe(false)

    const decorated = await decorateHtmlRevisionFooter(new Request('https://pay.ubq.fi/'), htmlRes, 'deadbeef')
    expect(decorated.headers.get('content-digest')).toBeNull()
    expect(await decorated.text()).toContain('rev deadbeef')
  })
})
