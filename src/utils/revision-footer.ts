/**
 * HTML revision footer decoration utilities for ubq.fi-router.
 *
 * Ensures that rewritten HTML responses:
 * 1. Respect `Cache-Control: no-transform` on both the incoming request and
 *    the upstream response (RFC 9111 Section 5.2.1.6 / 5.2.2.4).
 * 2. Strip representation-specific validators and digest headers — including
 *    both legacy (`Digest`, `Content-MD5`, `ETag`, `Content-Length`) and modern
 *    RFC 9530 (`Content-Digest`, `Repr-Digest`) fields — whenever the HTML
 *    payload is modified.
 */

export const ROUTER_REPOSITORY_URL = 'https://github.com/ubiquity/ubq.fi-router'

export const REVISION_FOOTER_MARKER = 'data-uos-router-revision'

/**
 * Headers whose values depend on the exact byte representation of the upstream
 * body and therefore become invalid once the HTML footer is injected.
 */
export const REWRITTEN_HTML_REMOVED_HEADERS = [
  'content-length',
  'content-md5',
  'digest',
  'want-digest',
  'content-digest',
  'repr-digest',
  'want-content-digest',
  'want-repr-digest',
  'etag',
] as const

/**
 * Returns true when a `Cache-Control` header value contains the `no-transform`
 * directive token (case-insensitive, RFC 9111).
 */
export function hasNoTransformDirective(cacheControl: string | null | undefined): boolean {
  if (!cacheControl) return false
  for (const rawPart of cacheControl.split(',')) {
    const token = rawPart.trim().split('=', 1)[0]?.trim().toLowerCase()
    if (token === 'no-transform') {
      return true
    }
  }
  return false
}

/**
 * Determines whether an upstream response is eligible for HTML revision footer
 * injection.
 */
export function shouldDecorateHtmlResponse(request: Request, response: Response): boolean {
  if (request.method.toUpperCase() === 'HEAD') return false
  if (response.status < 200 || response.status >= 300 || response.status === 204 || response.status === 205) {
    return false
  }
  if (!response.body) return false

  if (
    hasNoTransformDirective(request.headers.get('cache-control')) ||
    hasNoTransformDirective(response.headers.get('cache-control'))
  ) {
    return false
  }

  const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  if (contentEncoding && contentEncoding !== 'identity') {
    return false
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const mediaType = contentType.split(';', 1)[0]?.trim()
  return mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
}

export function buildRevisionFooterHtml(revision: string, repositoryUrl = ROUTER_REPOSITORY_URL): string {
  const safeRevision = escapeHtml(revision.trim() || 'local')
  const href = `${repositoryUrl.replace(/\/+$/, '')}/tree/${encodeURIComponent(revision.trim() || 'local')}`
  return [
    `<footer ${REVISION_FOOTER_MARKER} style="position:fixed;right:12px;bottom:12px;z-index:2147483647;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#52525b;background:rgba(255,255,255,.92);border:1px solid rgba(113,113,122,.35);border-radius:8px;padding:6px 8px;box-shadow:0 4px 18px rgba(0,0,0,.12)">`,
    `<a href="${href}" style="color:inherit;text-decoration:none" target="_blank" rel="noopener noreferrer">rev ${safeRevision}</a>`,
    '</footer>',
  ].join('')
}

export function injectRevisionFooterIntoHtml(html: string, revision: string, repositoryUrl = ROUTER_REPOSITORY_URL): string {
  if (html.includes(REVISION_FOOTER_MARKER)) {
    return html
  }
  const footer = buildRevisionFooterHtml(revision, repositoryUrl)
  const lower = html.toLowerCase()
  const bodyCloseIndex = lower.lastIndexOf('</body>')
  if (bodyCloseIndex !== -1) {
    return `${html.slice(0, bodyCloseIndex)}${footer}${html.slice(bodyCloseIndex)}`
  }
  const htmlCloseIndex = lower.lastIndexOf('</html>')
  if (htmlCloseIndex !== -1) {
    return `${html.slice(0, htmlCloseIndex)}${footer}${html.slice(htmlCloseIndex)}`
  }
  return `${html}${footer}`
}

export function stripRewrittenRepresentationHeaders(headers: Headers): void {
  for (const headerName of REWRITTEN_HTML_REMOVED_HEADERS) {
    headers.delete(headerName)
  }
}

export async function decorateHtmlRevisionFooter(
  request: Request,
  response: Response,
  revision: string,
  repositoryUrl = ROUTER_REPOSITORY_URL,
): Promise<Response> {
  if (!shouldDecorateHtmlResponse(request, response)) {
    return response
  }

  const originalHtml = await response.text()
  const rewrittenHtml = injectRevisionFooterIntoHtml(originalHtml, revision, repositoryUrl)
  if (rewrittenHtml === originalHtml) {
    return new Response(originalHtml, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    })
  }

  const headers = new Headers(response.headers)
  stripRewrittenRepresentationHeaders(headers)

  return new Response(rewrittenHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
