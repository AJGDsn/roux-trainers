/*
Smart cube support, through smartcube-web-bluetooth (poliva).

Two modes:
- "buttons" (the default): the cube never moves the virtual cube. Four quarter turns
  of one face, all one way (U U U U) or back and forth (U U' U U'), leave the
  cube as it was and press the trainer's
  Reveal/Next button, so a drill needs no keyboard. The trainer views listen
  for BUTTON_EVENT and do what a click on that button does.
- "control": the cube is a controller, not a mirror. Its moves are dispatched
  exactly as keyboard moves are ({type: "key", content: "R'"}), so every trainer
  handles them the way it handles keys, and its gyro turns the virtual cube.

A cube reports outer-layer turns only, so a physical M arrives as R L'. The
pieces still end up right relative to each other, and the gyro (which sits in
the core and turns with the middle slice) turns the view to match.
*/
import * as THREE from 'three';
import { connectSmartCube } from 'smartcube-web-bluetooth';
import type { SmartCubeConnection, SmartCubeEvent } from 'smartcube-web-bluetooth';

export type SmartCubeStatus = {
    connected: boolean,
    connecting: boolean,
    name: string,
    battery: number | null,
    gyro: boolean,      // the cube has a gyroscope
    gyroEnabled: boolean,
    mode: Mode,
    error: string
}

export type Mode = "buttons" | "control"
type MoveHandler = (move: string) => void
type StatusHandler = (status: SmartCubeStatus) => void

const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/
const MAC_STORAGE = "smartcube-mac:"
const GYRO_STORAGE = "smartcube-gyro-enabled"
const MODE_STORAGE = "smartcube-mode"
export const BUTTON_EVENT = "smartcube-button"

let conn: SmartCubeConnection | null = null
let sub: { unsubscribe: () => void } | null = null
let moveHandler: MoveHandler | null = null
let recentMoves: string[] = []
const statusHandlers = new Set<StatusHandler>()

let status: SmartCubeStatus = {
    connected: false, connecting: false, name: "", battery: null,
    gyro: false, gyroEnabled: readGyroEnabled(), mode: readMode(), error: ""
}

// Latest gyro reading, in three.js axes, and the reading taken as "home".
let gyroRaw: THREE.Quaternion | null = null
let gyroBasis: THREE.Quaternion | null = null
// What the view shows, eased towards the target each frame to hide sensor jitter.
const viewQuat = new THREE.Quaternion()

function readGyroEnabled() {
    try { return localStorage.getItem(GYRO_STORAGE) !== "0" } catch { return true }
}

function readMode(): Mode {
    try { return localStorage.getItem(MODE_STORAGE) === "control" ? "control" : "buttons" } catch { return "buttons" }
}

function setStatus(change: Partial<SmartCubeStatus>) {
    status = { ...status, ...change }
    statusHandlers.forEach(h => h(status))
}

// GAN cubes derive their key from the MAC, which Web Bluetooth hides. The library
// reads it from the advertisement where the browser allows; failing that, ask once.
async function macProvider(device: BluetoothDevice, isFallbackCall?: boolean): Promise<string | null> {
    const key = MAC_STORAGE + (device.id || device.name || "")
    try {
        const cached = localStorage.getItem(key)
        if (cached) return cached
    } catch {}
    if (!isFallbackCall) return null
    const entered = window.prompt(
        "Couldn't read the cube's Bluetooth MAC address automatically.\n\n" +
        "Enter it as AA:BB:CC:DD:EE:FF (shown in the cube's own app, or by a BLE scanner such as nRF Connect).", "")
    const mac = (entered || "").trim().toUpperCase().replace(/-/g, ":")
    if (!MAC_RE.test(mac)) return null
    try { localStorage.setItem(key, mac) } catch {}
    return mac
}

function handleEvent(e: SmartCubeEvent) {
    switch (e.type) {
        case "MOVE":
            if (status.mode === "control") moveHandler?.(e.move.trim())
            else onButtonMove(e.move.trim())
            break
        case "GYRO": {
            const { x, y, z, w } = e.quaternion
            // Cube axes are +X red (R), +Y blue (B), +Z white (U); three.js here has
            // R = +x, U = +y, F = +z.
            gyroRaw = new THREE.Quaternion(x, z, -y, w).normalize()
            if (!gyroBasis) resetGyro()
            if (!status.gyro) setStatus({ gyro: true })
            break
        }
        case "BATTERY":
            setStatus({ battery: e.batteryLevel })
            break
        case "DISCONNECT":
            cleanup()
            break
    }
}

// Four quarter turns of one face in a row, all one way or back and forth, press
// the button. No time limit: a solve never turns a face back and forth twice.
function onButtonMove(move: string) {
    recentMoves = [...recentMoves, move].slice(-4)
    const r = recentMoves
    const oneFace = r.every(m => m[0] === move[0])
    const oneWay = r.every(m => m === move)
    const backAndForth = r.every((m, i) => i === 0 || m !== r[i - 1])
    if (r.length === 4 && oneFace && (oneWay || backAndForth)) {
        recentMoves = []
        window.dispatchEvent(new Event(BUTTON_EVENT))
    }
}

function cleanup() {
    sub?.unsubscribe()
    sub = null
    conn = null
    gyroRaw = null
    gyroBasis = null
    setStatus({ connected: false, connecting: false, name: "", battery: null, gyro: false })
}

export function isSupported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator
}

export function getStatus() {
    return status
}

export function onStatus(handler: StatusHandler) {
    statusHandlers.add(handler)
    return () => { statusHandlers.delete(handler) }
}

export function setMoveHandler(handler: MoveHandler | null) {
    moveHandler = handler
}

export function setMode(mode: Mode) {
    try { localStorage.setItem(MODE_STORAGE, mode) } catch {}
    recentMoves = []
    setStatus({ mode })
}

export async function connect() {
    if (conn || status.connecting) return
    setStatus({ connecting: true, error: "" })
    try {
        conn = await connectSmartCube({ macAddressProvider: macProvider })
        sub = conn.events$.subscribe(handleEvent)
        setStatus({ connected: true, connecting: false, name: conn.deviceName || conn.protocol.name })
        if (conn.capabilities.battery) {
            conn.sendCommand({ type: "REQUEST_BATTERY" }).catch(() => {})
        }
    } catch (err) {
        conn = null
        const message = String((err as Error)?.message ?? err)
        // Closing the browser's device chooser is not an error worth showing.
        const cancelled = (err as Error)?.name === "NotFoundError"
        setStatus({ connecting: false, error: cancelled ? "" : message })
    }
}

export async function disconnect() {
    const c = conn
    if (!c) return
    try { await c.disconnect() } finally { cleanup() }
}

// Take the way the cube is held now as the trainer's home view.
export function resetGyro() {
    if (gyroRaw) gyroBasis = gyroRaw.clone().invert()
}

export function setGyroEnabled(enabled: boolean) {
    try { localStorage.setItem(GYRO_STORAGE, enabled ? "1" : "0") } catch {}
    setStatus({ gyroEnabled: enabled })
}

// The rotation to give the virtual cube this frame: none unless a cube's gyro is
// driving it. Every mounted CubeSim asks each frame, so the easing goes by time.
let lastEase = 0
export function viewRotation(): THREE.Quaternion {
    if (!conn || status.mode !== "control" || !status.gyroEnabled || !gyroRaw || !gyroBasis) {
        return viewQuat.identity()
    }
    const now = performance.now()
    const dt = Math.min(now - lastEase, 100)
    lastEase = now
    const target = gyroRaw.clone().premultiply(gyroBasis)
    viewQuat.slerp(target, 1 - Math.exp(-dt / 40))
    return viewQuat
}

// Development builds only: a pretend cube, for trying it without one.
// In the console: smartcubeSim.connect(), then smartcubeSim.moves("U U U U").
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    ;(window as any).smartcubeSim = {
        connect() {
            setStatus({ connected: true, name: "Simulated cube" })
        },
        moves(seq: string) {
            for (const move of seq.split(/\s+/).filter(m => m)) {
                handleEvent({ type: "MOVE", move, face: 0, direction: 0, localTimestamp: null, cubeTimestamp: null, timestamp: 0 })
            }
        },
    }
}
