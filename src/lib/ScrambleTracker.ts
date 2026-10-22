/*
Checks a smart cube's scramble against the trainer's, move by move.

Only the trainer's block matters (its mask), so the physical cube need not be
solved: it needs the block built, anywhere, in any colours. The tracker finds
it, then follows the real cube from the cube's own reports.

Two frames are involved. A smart cube reports turns relative to its centres,
so after a physical M (reported as R L') its "U" is no longer the layer on top.
The trainer works in the frame the cube is held in, where M moves centres.
The tracker keeps

    A = alpha · S

where S is the physical state in the cube's own frame (from its facelets and
moves) and alpha relabels colours so the block is the trainer's block. The
held state is A · beta for a whole-cube rotation beta. Comparing states "up to
beta" makes slices, wide moves and half turns match however the cube reports
them, so no move-by-move translation is needed while the scramble is on track.
*/
import { CubieCube, Move, MoveSeq, CubeUtil, MaskT } from './CubeLib'
import { corners_coord, edges_coord, centers_coord, cstimer_corners_coord, cstimer_edges_coord } from './Defs'

const FACES = "UDFBLR"           // index = Face enum, and the order of tp
const PHYSICAL_COLOURS = "WYGBOR" // a standard cube's colour on each face, U D F B L R

// --- Facelets ---------------------------------------------------------------

// Kociemba facelet indices (URFDLB faces, 9 each) of each corner and edge, in
// Kociemba's (cstimer's) piece order, with the faces each piece belongs to.
const K_CORNERS = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11], [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]]
const K_CORNER_FACES = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"]
const K_EDGES = [[5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]]
const K_EDGE_FACES = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"]

// A 3x3 facelet string as the cube reports it, as a CubieCube in the cube's own frame.
export function cubieFromFacelets(f: string): CubieCube | null {
    if (f.length !== 54) return null
    const cp: number[] = [], co: number[] = [], ep: number[] = [], eo: number[] = []
    for (const idx of K_CORNERS) {
        let ori = 0
        while (ori < 3 && f[idx[ori]] !== "U" && f[idx[ori]] !== "D") ori++
        if (ori === 3) return null
        const c1 = f[idx[(ori + 1) % 3]], c2 = f[idx[(ori + 2) % 3]]
        const piece = K_CORNER_FACES.findIndex(c => c[1] === c1 && c[2] === c2)
        if (piece < 0) return null
        cp.push(piece); co.push(ori)
    }
    for (const [i0, i1] of K_EDGES) {
        let piece = K_EDGE_FACES.findIndex(e => e[0] === f[i0] && e[1] === f[i1])
        let ori = 0
        if (piece < 0) {
            piece = K_EDGE_FACES.findIndex(e => e[0] === f[i1] && e[1] === f[i0])
            ori = 1
        }
        if (piece < 0) return null
        ep.push(piece); eo.push(ori)
    }
    if (new Set(cp).size !== 8 || new Set(ep).size !== 12) return null
    const k = new CubieCube({ cp, co, ep, eo })
    const mapping = k._to_facelet_mapping(cstimer_corners_coord, cstimer_edges_coord, centers_coord)
    return k._from_facelet_mapping(mapping, corners_coord, edges_coord, centers_coord)
}

// --- Cube arithmetic --------------------------------------------------------

export function key(c: CubieCube) {
    return c.cp.join("") + c.co.join("") + c.ep.join(",") + c.eo.join("") + c.tp.join("")
}

// a then b, as a single state: (a·b).cp[i] = a.cp[b.cp[i]].
function mul(a: CubieCube, b: CubieCube) {
    return a.apply(new Move(b, "_"))
}

type Rotation = { name: string, cube: CubieCube, inv: number }

export const ROTATIONS: Rotation[] = (() => {
    const rots: Rotation[] = []
    const seen = new Set<string>()
    for (const up of ["", "x", "x2", "x'", "z", "z'"]) {
        for (const y of ["", "y", "y2", "y'"]) {
            const name = (up + " " + y).trim()
            const cube = new CubieCube().apply(name)
            if (seen.has(key(cube))) continue
            seen.add(key(cube))
            rots.push({ name, cube, inv: -1 })
        }
    }
    const solved = key(new CubieCube())
    rots.forEach(r => { r.inv = rots.findIndex(s => key(mul(r.cube, s.cube)) === solved) })
    return rots
})()

const ID_ROT = ROTATIONS.findIndex(r => r.name === "")

// Every way of holding `c`: key of c·rho → index of rho.
function rotationKeys(c: CubieCube, into?: Map<string, number>) {
    const m = into || new Map<string, number>()
    ROTATIONS.forEach((r, i) => {
        const k = key(mul(c, r.cube))
        if (!m.has(k)) m.set(k, i)
    })
    return m
}

// The held-frame name of a move the cube reports, when the held state is A·beta.
export function heldMove(beta: number, move: string) {
    const c = FACES.indexOf(move[0])
    const p = ROTATIONS[beta].cube.tp.indexOf(c)
    return FACES[p] + move.slice(1)
}

// The display colour scheme ("WG" = white on top, green in front) for labels alpha.
function oriOf(alpha: CubieCube) {
    const physical = (label: number) => PHYSICAL_COLOURS[alpha.tp.indexOf(label)]
    return physical(0) + physical(2)
}

// A held move as quarter turns of an axis's two faces, up to rotation:
// M = R L', r = L, U2 = U2. Rotations come out as no turns at all.
const AXES = [["U", "D"], ["F", "B"], ["L", "R"]]
const AMOUNT = ["", "", "2", "'"]
function turns(face: string, n: number) { return n === 0 ? "" : face + AMOUNT[n] }

function decompose(move: Move): { faces: string[], amounts: number[] } {
    const target = rotationKeys(new CubieCube().apply(move))
    for (const faces of AXES) {
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
            const c = new CubieCube().apply(turns(faces[0], a) + " " + turns(faces[1], b))
            if (target.has(key(c))) return { faces, amounts: [a, b] }
        }
    }
    return { faces: [], amounts: [] }
}

// The states part-way through a move: one face of a slice, or a quarter of a half turn.
function partialStates(from: CubieCube, move: Move) {
    const { faces, amounts } = decompose(move)
    if (faces.length === 0) return []
    const path = (n: number) => n === 0 ? [0] : n === 2 ? [0, 1, 2, 3] : [0, n]
    const states: CubieCube[] = []
    for (const i of path(amounts[0])) for (const j of path(amounts[1])) {
        if ((i === 0 && j === 0) || (i === amounts[0] && j === amounts[1])) continue
        states.push(from.apply(turns(faces[0], i) + " " + turns(faces[1], j)))
    }
    return states
}

const SLICES = ["M", "M'", "E", "E'", "S", "S'"]
const FIX_MOVES = ["U", "D", "F", "B", "L", "R", "M", "E", "S"]
    .flatMap(f => [f, f + "'", f + "2"]).map(n => Move.all[n])
const OPPOSITE: { [f: string]: string } = { U: "D", D: "U", F: "B", B: "F", L: "R", R: "L" }
const SLICE_WINDOW_MS = 150

// --- Tracker ----------------------------------------------------------------

export type Phase = "off" | "reading" | "build" | "scramble" | "solve"
export type StepStatus = "done" | "partial" | "next" | "todo"
export type Gesture = "U" | "D" | "other" | null

export type TrackerView = {
    phase: Phase,
    scramble: string,
    steps: { move: string, status: StepStatus }[],
    fix: string,            // moves that put the scramble back on track, if it's off
    blockBuilt: boolean,
    held: CubieCube | null, // the physical cube as held, for the virtual cube
    ori: string | null,     // its colours, as the trainer names them
    notice: string,
    label: string,          // what must be built: "block", "cube"...
}

export class ScrambleTracker {
    private S: CubieCube | null = null
    private alpha = ID_ROT
    private A: CubieCube | null = null
    private beta = ID_ROT

    private scrambleText = ""
    private moves: Move[] = []
    private mask: MaskT | null = null
    private preferOri = ""
    private label = ""
    private phase: Phase = "off"

    private targets: Map<string, number>[] = []  // rotation keys of the held state after j moves
    private targetStates: CubieCube[] = []
    private k = 0
    private partial = false
    private partialKeys = new Map<string, number>()
    private offTrack = false
    private log: string[] = []                    // held moves since the last on-track state
    private fix = ""
    private blockBuilt = false
    private notice = ""

    private recent: { move: string, t: number, before: CubieCube | null, beta: number }[] = []
    private listeners = new Set<() => void>()
    private version = 0

    subscribe(f: () => void) {
        this.listeners.add(f)
        return () => { this.listeners.delete(f) }
    }
    private changed() {
        this.version++
        this.listeners.forEach(f => f())
    }
    getVersion() { return this.version }

    view(): TrackerView {
        const steps = this.moves.map((m, j) => ({
            move: m.name,
            status: (this.phase === "solve" || j < this.k) ? "done" as const
                : (this.phase === "scramble" && j === this.k) ? (this.partial ? "partial" as const : "next" as const)
                : "todo" as const
        }))
        const active = this.A !== null && (this.phase === "scramble" || this.phase === "solve")
        return {
            phase: this.phase,
            scramble: this.scrambleText,
            steps,
            fix: this.offTrack ? this.fix : "",
            blockBuilt: this.blockBuilt,
            held: active ? mul(this.A!, ROTATIONS[this.beta].cube) : null,
            ori: active ? oriOf(ROTATIONS[this.alpha].cube) : null,
            notice: this.notice,
            label: this.label,
        }
    }

    stop() {
        this.phase = "off"
        this.S = null
        this.A = null
        this.changed()
    }

    // No case to check (a mode without scrambles).
    clearCase() {
        this.mask = null
        this.moves = []
        this.scrambleText = ""
        this.A = null
        this.phase = "off"
        this.changed()
    }

    // The cube's whole state, from its facelets. Also corrects any drift.
    setPhysical(S: CubieCube) {
        if (this.S && key(this.S) === key(S)) return
        this.S = S
        if (!this.mask) return
        if (this.phase === "off" || this.phase === "reading") this.phase = "build"
        if (this.phase === "build") {
            this.tryStart()
        } else if (this.A) {
            this.A = mul(ROTATIONS[this.alpha].cube, S)
            this.log = []
            this.evaluate(null)
        }
        this.changed()
    }

    // A new case. preferOri keeps the trainer's colours when more than one block is built.
    setCase(scramble: string, mask: MaskT, preferOri: string, label: string) {
        this.label = label
        this.scrambleText = scramble
        this.moves = new MoveSeq(scramble).moves
        this.mask = mask
        this.preferOri = preferOri
        this.restart()
    }

    // The same case again.
    restart() {
        this.A = null
        this.recent = []
        this.notice = ""
        this.phase = this.S ? "build" : "reading"
        if (this.S) this.tryStart()
        this.changed()
    }

    setNotice(text: string) {
        this.notice = text
        this.changed()
    }

    private isBuilt(held: CubieCube) {
        return CubeUtil.is_solved(held, this.mask!)
    }

    // Find the block, and from it the colours and the frame the scramble starts in.
    private findBlock() {
        if (!this.S || !this.mask) return null
        let found: { alpha: number, beta: number } | null = null
        for (let a = 0; a < ROTATIONS.length; a++) {
            const aS = mul(ROTATIONS[a].cube, this.S)
            const b = ROTATIONS.findIndex(r => this.isBuilt(mul(aS, r.cube)))
            if (b < 0) continue
            found = { alpha: a, beta: b }
            if (oriOf(ROTATIONS[a].cube) === this.preferOri) break
        }
        return found
    }

    private tryStart() {
        const found = this.findBlock()
        if (found) {
            this.start(found.alpha, found.beta)
        } else {
            this.phase = this.S ? "build" : "reading"
            this.blockBuilt = false
        }
    }

    // Off track before the first move: the owner may still be fixing the block,
    // or have built another. Start again from whatever block is built now.
    private startsElsewhere() {
        const found = this.findBlock()
        if (found) this.start(found.alpha, found.beta)
        return found !== null
    }

    private start(alpha: number, beta: number) {
        this.alpha = alpha
        this.beta = beta
        this.A = mul(ROTATIONS[alpha].cube, this.S!)
        const start = mul(this.A, ROTATIONS[beta].cube)
        this.targetStates = [start]
        for (const m of this.moves) this.targetStates.push(this.targetStates[this.targetStates.length - 1].apply(m))
        this.targets = this.targetStates.map(t => rotationKeys(t))
        this.phase = "scramble"
        this.setStep(0)
        this.offTrack = false
        this.log = []
        this.blockBuilt = true
        this.evaluate(null)
    }

    private setStep(k: number) {
        this.k = k
        this.partial = false
        this.partialKeys = new Map()
        if (k < this.moves.length) {
            for (const p of partialStates(this.targetStates[k], this.moves[k])) rotationKeys(p, this.partialKeys)
        }
    }

    // A move as the cube reports it. Returns a gesture when it completes four
    // turns of one face in one direction.
    move(move: string, t: number): Gesture {
        if (!Move.all[move]) return null
        this.notice = ""
        const before = this.A
        if (this.S) this.S = this.S.apply(move)
        if (this.A) this.A = this.A.apply(move)
        this.recent.push({ move, t, before, beta: this.beta })
        if (this.recent.length > 4) this.recent.shift()

        if (this.phase === "build") {
            this.tryStart()
        } else if (this.A) {
            this.evaluate(move)
        }

        let gesture: Gesture = null
        const r = this.recent
        if (r.length === 4 && r.every(x => x.move === move) && move.length === 1 + (move.endsWith("'") ? 1 : 0)) {
            const face = heldMove(this.beta, move)[0]
            gesture = face === "U" ? "U" : face === "D" ? "D" : "other"
            this.recent = []
        }
        this.changed()
        return gesture
    }

    // A slice turns the core, which moves the cube's frame against the held one.
    // When two opposite faces turn together the slice way, follow the frame.
    private followSlice() {
        const r = this.recent
        if (r.length < 2 || !this.A) return null
        const [a, b] = [r[r.length - 2], r[r.length - 1]]
        if (OPPOSITE[a.move[0]] !== b.move[0] || b.t - a.t > SLICE_WINDOW_MS) return null
        if (a.move.endsWith("'") === b.move.endsWith("'") || !a.before) return null
        const was = mul(a.before, ROTATIONS[a.beta].cube)
        const now = rotationKeys(this.A)
        for (const s of SLICES) {
            const rho = now.get(key(was.apply(s)))
            if (rho !== undefined) {
                this.beta = rho
                return s
            }
        }
        return null
    }

    private evaluate(move: string | null) {
        const A = this.A!
        const k = key(A)
        if (this.phase === "scramble") {
            let best = -1
            this.targets.forEach((t, j) => { if (t.has(k)) best = j })
            if (best >= 0) {
                this.beta = ROTATIONS[this.targets[best].get(k)!].inv
                this.setStep(best)
                this.offTrack = false
                this.log = []
                if (best === this.moves.length) this.phase = "solve"
            } else if (this.partialKeys.has(k)) {
                this.beta = ROTATIONS[this.partialKeys.get(k)!].inv
                this.partial = true
                this.offTrack = false
                this.log = []
            } else if (this.k === 0 && !this.partial && this.startsElsewhere()) {
                return
            } else {
                if (move) {
                    const slice = this.followSlice()
                    if (slice) this.log[this.log.length - 1] = slice
                    else this.log.push(heldMove(this.beta, move))
                }
                this.offTrack = true
                this.fix = this.findFix()
            }
        } else if (this.phase === "solve" && move) {
            this.followSlice()
        }
        // Is the block built? It fixes the frame when it is.
        const b = ROTATIONS.findIndex(r => this.isBuilt(mul(A, r.cube)))
        this.blockBuilt = b >= 0
        if (b >= 0 && this.phase === "solve") this.beta = b
        if (this.phase === "solve") this.offTrack = false
    }

    // The shortest way back on track (or straight on to the next step), else undo.
    private findFix(): string {
        const held = mul(this.A!, ROTATIONS[this.beta].cube)
        if (this.partial) {
            // Back to the half-done move the cube was in: the log undoes it.
            return new MoveSeq(this.log.join(" ")).inv().collapse().toString().trim()
        }
        // Prefer going on to the next step over going back, at the same length.
        const goals = [this.targets[this.k + 1], this.targets[this.k]].filter(g => g)
        for (const goal of goals) {
            for (const m of FIX_MOVES) if (goal.has(key(held.apply(m)))) return m.name
        }
        for (const goal of goals) {
            for (const m1 of FIX_MOVES) {
                const c1 = held.apply(m1)
                for (const m2 of FIX_MOVES) {
                    if (m2.name[0] === m1.name[0]) continue
                    if (goal.has(key(c1.apply(m2)))) return m1.name + " " + m2.name
                }
            }
        }
        return new MoveSeq(this.log.join(" ")).inv().collapse().toString().trim()
    }
}

// The colour names of a scheme, for telling the owner how to hold the cube.
const COLOUR_NAMES: { [c: string]: string } = { W: "white", Y: "yellow", G: "green", B: "blue", O: "orange", R: "red" }
export function colourName(c: string) { return COLOUR_NAMES[c] || c }

export const tracker = new ScrambleTracker()
