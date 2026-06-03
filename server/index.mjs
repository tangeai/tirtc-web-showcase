import 'dotenv/config'
import { execFile } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { issueClientToken } from './token/openapi.mjs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const isDev = process.argv.includes('--dev')
const port = Number(process.env.PORT || 8787)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')
const enableDeviceDebug = String(process.env.ENABLE_DEVICE_DEBUG || '').trim() === '1'
const defaultAdbPath = path.join(
  process.env.LOCALAPPDATA || '',
  'Microsoft',
  'WinGet',
  'Packages',
  'Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'platform-tools',
  'adb.exe',
)

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

function ensureDeviceDebugEnabled() {
  if (enableDeviceDebug) {
    return
  }

  throw Object.assign(new Error('当前部署已关闭真机远程调试入口'), { statusCode: 403 })
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function getRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', (chunk) => {
      chunks.push(chunk)
    })

    request.on('end', () => {
      if (!chunks.length) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
      } catch {
        reject(Object.assign(new Error('请求体不是合法的 JSON'), { statusCode: 400 }))
      }
    })

    request.on('error', reject)
  })
}

function normalizeRemoteId(value) {
  const remoteId = String(value || '').trim()
  if (!remoteId) {
    throw Object.assign(new Error('remoteId 不能为空'), { statusCode: 400 })
  }
  if (remoteId.length > 128) {
    throw Object.assign(new Error('remoteId 过长，请检查输入'), { statusCode: 400 })
  }
  return remoteId
}

function normalizeOptionalUrl(value, label) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  let parsedUrl
  try {
    parsedUrl = new URL(raw)
  } catch {
    throw Object.assign(new Error(`${label} 不是合法的 URL`), { statusCode: 400 })
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw Object.assign(new Error(`${label} 只支持 http(s)`), { statusCode: 400 })
  }

  return parsedUrl.toString().replace(/\/$/, '')
}

function getAdbBinary() {
  if (process.env.ADB_BIN) {
    return process.env.ADB_BIN
  }

  if (existsSync(defaultAdbPath)) {
    return defaultAdbPath
  }

  return 'adb'
}

async function runAdb(args, options = {}) {
  const adbBinary = getAdbBinary()

  try {
    return await execFileAsync(adbBinary, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 16,
      shell: false,
      ...options,
    })
  } catch (error) {
    const errorText = error instanceof Error ? error.message : '未知错误'
    if (errorText.includes('not recognized') || errorText.includes('ENOENT')) {
      throw Object.assign(new Error('未找到 adb，请先安装 Android platform-tools'), {
        statusCode: 500,
      })
    }

    throw error
  }
}

function parseAdbDevices(output) {
  const lines = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines
    .filter((line) => !line.startsWith('List of devices attached'))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/)
      const details = Object.fromEntries(
        rest
          .filter((item) => item.includes(':'))
          .map((item) => {
            const [key, value] = item.split(':')
            return [key, value]
          }),
      )

      return {
        serial,
        state,
        model: details.model || '',
        device: details.device || '',
        product: details.product || '',
      }
    })
}

async function getConnectedDevice() {
  const { stdout } = await runAdb(['devices', '-l'])
  const devices = parseAdbDevices(stdout)
  const activeDevice = devices.find((device) => device.state === 'device')

  return {
    activeDevice,
    devices,
  }
}

function ensureRelativePath(value) {
  const pathValue = String(value || '/').trim() || '/'
  if (!pathValue.startsWith('/')) {
    throw Object.assign(new Error('path 必须以 / 开头'), { statusCode: 400 })
  }
  return pathValue
}

function normalizeTapCoordinate(value, label) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw Object.assign(new Error(`${label} 必须是非负数`), { statusCode: 400 })
  }
  return Math.round(numberValue)
}

const allowedKeyEvents = new Set([
  'KEYCODE_BACK',
  'KEYCODE_HOME',
  'KEYCODE_APP_SWITCH',
  'KEYCODE_ENTER',
  'KEYCODE_VOLUME_UP',
  'KEYCODE_VOLUME_DOWN',
])

function normalizeKeyEvent(value) {
  const keyValue = String(value || '').trim().toUpperCase()
  if (!allowedKeyEvents.has(keyValue)) {
    throw Object.assign(new Error('不支持的 keyevent'), { statusCode: 400 })
  }
  return keyValue
}

async function getDeviceStatus() {
  ensureDeviceDebugEnabled()
  const { activeDevice, devices } = await getConnectedDevice()

  if (!activeDevice) {
    return {
      connected: false,
      devices,
      screenHeight: null,
      screenWidth: null,
    }
  }

  const { stdout } = await runAdb(['shell', 'wm', 'size'])
  const match = String(stdout).match(/Physical size:\s*(\d+)x(\d+)/)

  return {
    connected: true,
    devices,
    model: activeDevice.model,
    serial: activeDevice.serial,
    screenWidth: match ? Number(match[1]) : null,
    screenHeight: match ? Number(match[2]) : null,
  }
}

async function getDeviceScreenshotBuffer() {
  ensureDeviceDebugEnabled()
  const { activeDevice } = await getConnectedDevice()
  if (!activeDevice) {
    throw Object.assign(new Error('当前没有已连接并授权的 Android 设备'), { statusCode: 503 })
  }

  const result = await runAdb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' })
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
}

async function tapDevice(x, y) {
  ensureDeviceDebugEnabled()
  const { activeDevice } = await getConnectedDevice()
  if (!activeDevice) {
    throw Object.assign(new Error('当前没有已连接并授权的 Android 设备'), { statusCode: 503 })
  }

  await runAdb(['shell', 'input', 'tap', String(x), String(y)])
}

async function sendDeviceKeyEvent(keyEvent) {
  ensureDeviceDebugEnabled()
  const { activeDevice } = await getConnectedDevice()
  if (!activeDevice) {
    throw Object.assign(new Error('当前没有已连接并授权的 Android 设备'), { statusCode: 503 })
  }

  await runAdb(['shell', 'input', 'keyevent', keyEvent])
}

async function openDeviceUrl(devicePath) {
  ensureDeviceDebugEnabled()
  const { activeDevice } = await getConnectedDevice()
  if (!activeDevice) {
    throw Object.assign(new Error('当前没有已连接并授权的 Android 设备'), { statusCode: 503 })
  }

  await runAdb(['reverse', `tcp:${port}`, `tcp:${port}`])
  await runAdb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `http://127.0.0.1:${port}${devicePath}`,
  ])
}

async function issueToken({ remoteId, endpoint, openapiEndpoint }) {
  return issueClientToken({
    remoteId,
    openapiEndpoint: openapiEndpoint || process.env.TIRTC_OPENAPI_ENDPOINT || '',
    serviceEndpoint: endpoint || process.env.TIRTC_ENDPOINT || '',
  })
}

async function serveStaticAsset(requestPath, response) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath
  const assetPath = path.normalize(path.join(distDir, safePath))

  if (!assetPath.startsWith(distDir)) {
    writeJson(response, 403, { message: '禁止访问该路径' })
    return
  }

  try {
    const fileInfo = await stat(assetPath)
    if (fileInfo.isDirectory()) {
      await serveStaticAsset('/index.html', response)
      return
    }

    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(assetPath)] || 'application/octet-stream',
    })
    createReadStream(assetPath).pipe(response)
  } catch {
    const fallbackPath = path.join(distDir, 'index.html')
    if (existsSync(fallbackPath)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(await readFile(fallbackPath, 'utf-8'))
      return
    }

    writeJson(response, 404, { message: '未找到请求的资源' })
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Origin': '*',
    })
    response.end()
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    writeJson(response, 200, {
      mode: isDev ? 'development' : 'production',
      ok: true,
      sdkBundled: existsSync(path.join(rootDir, 'src', 'vendor', 'tirtc.es.min.js')),
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/token/issue') {
    try {
      const body = await getRequestBody(request)
      const token = await issueToken({
        endpoint: normalizeOptionalUrl(body.endpoint, 'endpoint'),
        openapiEndpoint: normalizeOptionalUrl(body.openapiEndpoint, 'openapiEndpoint'),
        remoteId: normalizeRemoteId(body.remoteId),
      })

      writeJson(response, 200, token)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : 500

      writeJson(response, statusCode, { message })
    }
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/device/status') {
    try {
      writeJson(response, 200, await getDeviceStatus())
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : 500

      writeJson(response, statusCode, { message })
    }
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/device/screenshot') {
    try {
      const imageBuffer = await getDeviceScreenshotBuffer()
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/png',
      })
      response.end(imageBuffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : 500

      writeJson(response, statusCode, { message })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/device/tap') {
    try {
      const body = await getRequestBody(request)
      await tapDevice(
        normalizeTapCoordinate(body.x, 'x'),
        normalizeTapCoordinate(body.y, 'y'),
      )
      writeJson(response, 200, { ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : 500

      writeJson(response, statusCode, { message })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/device/keyevent') {
    try {
      const body = await getRequestBody(request)
      await sendDeviceKeyEvent(normalizeKeyEvent(body.keyevent))
      writeJson(response, 200, { ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : 500

      writeJson(response, statusCode, { message })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/device/open-page') {
    try {
      const body = await getRequestBody(request)
      await openDeviceUrl(ensureRelativePath(body.path))
      writeJson(response, 200, { ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode)
        : 500

      writeJson(response, statusCode, { message })
    }
    return
  }

  if (!isDev && existsSync(distDir)) {
    if (url.pathname === '/device-remote.html' && !enableDeviceDebug) {
      writeJson(response, 403, { message: '当前部署已关闭真机远程调试页' })
      return
    }

    await serveStaticAsset(url.pathname, response)
    return
  }

  writeJson(response, 404, {
    message: isDev
      ? '开发模式下该 Node 服务只承载 /api/*，前端页面请通过 Vite 访问。'
      : '未找到请求的资源。',
  })
})

server.on('error', (error) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    console.error(`[tirtc-api] 端口 ${port} 已被占用。请先停止旧服务，或通过 PORT 环境变量改用其他端口。`)
    process.exit(1)
  }

  console.error('[tirtc-api] 服务启动失败', error)
  process.exit(1)
})

server.listen(port, () => {
  console.log(`[tirtc-api] listening on http://localhost:${port}`)
})