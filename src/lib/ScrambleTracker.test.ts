import { CubieCube, Mask, Move } from './CubeLib'
import { ScrambleTracker, cubieFromFacelets, key, heldMove, ROTATIONS } from './ScrambleTracker'

const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"

function run(t: ScrambleTracker, reports: string[]) {
    let time = 0
    return reports.map(m => { time += 400; return t.move(m, time) })
}
function done(t: ScrambleTracker) {
    return t.view().steps.filter(s => s.status === "done").length
}

it('reads facelets into the trainer\'s cube', () => {
    expect(key(cubieFromFacelets(SOLVED)!)).toBe(key(new CubieCube()))
    const r = "UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB"
    expect(key(cubieFromFacelets(r)!)).toBe(key(new CubieCube().apply("R")))
    const u = "UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB"
    expect(key(cubieFromFacelets(u)!)).toBe(key(new CubieCube().apply("U")))
})

it('names a reported move in the held frame', () => {
    const A = new CubieCube().apply("R U F' L2 D")
    ROTATIONS.forEach((r, beta) => {
        for (const m of ["U", "R'", "F", "D'", "L", "B"]) {
            const viaCube = A.apply(m).apply(r.name)
            const viaHeld = A.apply(r.name).apply(heldMove(beta, m))
            expect(key(viaCube)).toBe(key(viaHeld))
        }
    })
})

it('follows a scramble with slices and wide moves as the cube reports them', () => {
    const t = new ScrambleTracker()
    t.setPhysical(new CubieCube())
    t.setCase("R U M' U2 r", Mask.fbdr_mask, "WG", "block")
    expect(t.view().phase).toBe("scramble")
    run(t, ["R", "U"])
    expect(done(t)).toBe(2)
    run(t, ["R'"])                       // first half of M'
    expect(t.view().steps[2].status).toBe("partial")
    run(t, ["L"])                        // M' done; the F centre is now on top
    expect(done(t)).toBe(3)
    run(t, ["F"])
    expect(t.view().steps[3].status).toBe("partial")
    run(t, ["F"])
    expect(done(t)).toBe(4)
    run(t, ["L"])                        // r
    expect(t.view().phase).toBe("solve")
    const held = t.view().held!
    expect(key(held).slice(0, 8 + 8)).toBe(key(new CubieCube().apply("R U M' U2 r")).slice(0, 16))
})

it('suggests a fix after a wrong turn, and resumes', () => {
    const t = new ScrambleTracker()
    t.setPhysical(new CubieCube())
    t.setCase("R U F", Mask.fbdr_mask, "WG", "block")
    run(t, ["R", "U'"])
    expect(t.view().fix).toBe("U2")
    run(t, ["U", "U"])
    expect(t.view().fix).toBe("")
    expect(done(t)).toBe(2)
})

it('finds a block built anywhere, in any colours', () => {
    // The trainer's block (L and D) solved, the rest not, then recoloured.
    const X = new Move(new CubieCube().apply("R U R' U2 R2 U'"), "_")
    for (const r of ROTATIONS) {
        const physical = new CubieCube().apply(r.name).apply(X).apply(ROTATIONS[r.inv].name)
        expect(physical.tp).toEqual([0, 1, 2, 3, 4, 5])
        const t = new ScrambleTracker()
        t.setPhysical(physical)
        t.setCase("U R", Mask.fb_mask, "WG", "block")
        expect(t.view().phase).toBe("scramble")
    }
})

it('waits for the block, and reports gestures', () => {
    const t = new ScrambleTracker()
    t.setPhysical(new CubieCube().apply("L F2 R' B U' D2 F L'"))
    t.setCase("F", Mask.fb_mask, "WG", "block")
    expect(t.view().phase).toBe("build")
    run(t, ["L", "F'", "D", "D", "U", "B'", "R", "F", "F", "L'"])
    expect(t.view().phase).toBe("scramble")
    run(t, ["F"])
    expect(t.view().phase).toBe("solve")
    expect(t.view().blockBuilt).toBe(false)
    const g = run(t, ["U", "U", "U", "U"])
    expect(g).toEqual([null, null, null, "U"])
    run(t, ["F'"])
    expect(t.view().blockBuilt).toBe(true)
    expect(run(t, ["D'", "D'", "D'", "D'"])[3]).toBe("D")
})

it('takes U4 as a gesture before the first scramble move', () => {
    const t = new ScrambleTracker()
    t.setPhysical(new CubieCube())
    t.setCase("F R", Mask.fb_mask, "WG", "block")
    expect(run(t, ["U", "U", "U", "U"])[3]).toBe("U")
    expect(t.view().phase).toBe("scramble")
})
