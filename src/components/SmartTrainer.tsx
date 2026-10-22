import React from "react";
import { useTheme } from "@mui/material";

import { AppState, Action } from "../Types";
import { Mask, MaskT, ColorScheme } from "../lib/CubeLib";
import * as SmartCube from '../lib/SmartCube';
import { tracker, cubieFromFacelets, key, colourName, Gesture, StepStatus } from '../lib/ScrambleTracker';
import { getMask } from "./BlockTrainerView";

/*
Drives the scramble checker (ScrambleTracker) from a smart cube in "check" mode:
- each new case gives it the scramble and the pieces that matter (the mask);
- the virtual cube follows the physical one, coloured as the owner's cube is;
- four turns of one face are gestures: while the solutions are hidden, any of
  them reveals; after, U4 is the next scramble and D4 the same one again, once
  the block is built.
*/

const BLOCK_MODES = ["fb", "fs", "fsdr", "fbdr", "fbss", "ss", "4c", "eopair"]
const CMLL_MODES = ["cmll", "misc-algs"]

// The CMLL views keep "revealed" in their own state; they listen for this.
export const REVEAL_EVENT = "smartcube-reveal"

type Adapter = { scramble: string, mask: MaskT, cmll: boolean, label: string }

function adapterFor(state: AppState): Adapter | null {
    if (BLOCK_MODES.includes(state.mode) && state.case.desc.length > 0) {
        const lse = state.mode === "4c" || state.mode === "eopair"
        const blocks = state.mode === "ss" || state.mode === "fbss"
        return {
            scramble: state.case.desc[0].setup || "", mask: getMask(state), cmll: false,
            label: lse ? "cube" : blocks ? "blocks" : "block"
        }
    }
    if (CMLL_MODES.includes(state.mode) && state.case.desc.length >= 4) {
        return { scramble: state.case.desc[3].algs[0] || "", mask: Mask.cmll_mask, cmll: true, label: "blocks and corners" }
    }
    return null
}

function useSmartCubeStatus() {
    const [status, setStatus] = React.useState(SmartCube.getStatus())
    React.useEffect(() => SmartCube.onStatus(setStatus), [])
    return status
}

function useTrackerView() {
    const [, setVersion] = React.useState(tracker.getVersion())
    React.useEffect(() => tracker.subscribe(() => setVersion(tracker.getVersion())), [])
    return tracker.view()
}

export function SmartTrainer(props: { state: AppState, dispatch: React.Dispatch<Action> }) {
    const { state, dispatch } = props
    const stateRef = React.useRef(state)
    stateRef.current = state
    const status = useSmartCubeStatus()
    const active = status.connected && status.mode === "check"
    const cmllRevealed = React.useRef(false)
    const lastSynced = React.useRef("")

    // Show the physical cube, as held, on the virtual one.
    const sync = React.useCallback(() => {
        const v = tracker.view()
        if (!v.held || !v.ori) return
        const k = key(v.held) + v.ori
        if (k === lastSynced.current) return
        lastSynced.current = k
        const held = v.held, ori = v.ori
        dispatch({ type: "custom", content: s => ({ ...s, cube: { ...s.cube, state: held, ori } }) })
    }, [dispatch])

    const onGesture = React.useCallback((g: Gesture) => {
        const s = stateRef.current
        const ad = adapterFor(s)
        if (!ad || !g) return
        const revealed = ad.cmll ? cmllRevealed.current : s.name === "revealed"
        if (!revealed) {
            if (ad.cmll) {
                cmllRevealed.current = true
                window.dispatchEvent(new Event(REVEAL_EVENT))
            } else if (s.name === "hiding") {
                dispatch({ type: "key", content: "#space" })
            }
            return
        }
        if (g === "other") return
        if (!tracker.view().blockBuilt) {
            tracker.setNotice(`Build the ${ad.label} first.`)
            return
        }
        if (g === "U") {
            dispatch({ type: "key", content: "#space" })
        } else if (ad.cmll) {
            dispatch({ type: "key", content: "#enter" })
        } else {
            dispatch({ type: "custom", content: s => ({ ...s, name: "hiding" }) })
            lastSynced.current = ""
            tracker.restart()
            sync()
        }
    }, [dispatch, sync])

    React.useEffect(() => {
        SmartCube.setTrackerHandlers({
            move: (move, time) => {
                const g = tracker.move(move, time)
                sync()
                onGesture(g)
            },
            facelets: f => {
                const cube = cubieFromFacelets(f)
                if (!cube) return
                tracker.setPhysical(cube)
                sync()
            },
        })
        return () => SmartCube.setTrackerHandlers(null)
    }, [sync, onGesture])

    // Each new case (or the same one, redone) starts the check again.
    React.useEffect(() => {
        if (!active) {
            tracker.stop()
            return
        }
        const s = stateRef.current
        const ad = adapterFor(s)
        cmllRevealed.current = false
        lastSynced.current = ""
        if (!ad) {
            tracker.clearCase()
            return
        }
        tracker.setCase(ad.scramble, ad.mask, s.cube.ori, ad.label)
        sync()
    }, [active, state.case, state.mode, sync])

    return null
}

const STEP_STYLE: { [s in StepStatus]: (p: any) => React.CSSProperties } = {
    done: p => ({ color: p.success.main }),
    partial: p => ({ color: p.warning.main, textDecoration: "underline" }),
    next: () => ({ textDecoration: "underline" }),
    todo: p => ({ color: p.text.secondary }),
}

// The scramble, each move marked as it's done, with what to do next beneath.
// Plain text unless a smart cube is checking this scramble.
export function SmartScramble(props: { setup: string, revealed: boolean }) {
    const { setup, revealed } = props
    const status = useSmartCubeStatus()
    const v = useTrackerView()
    const palette = useTheme().palette
    if (!status.connected || status.mode !== "check" || v.phase === "off" || v.scramble !== setup) {
        return <React.Fragment>{setup}</React.Fragment>
    }

    const scheme = (v.ori && ColorScheme.valid_schemes_map.get(v.ori)) || ""
    const [U, , F, , L, D] = [scheme[0], scheme[1], scheme[2], scheme[3], scheme[4], scheme[1]].map(colourName)
    const holdIt = v.label === "block"
        ? `Hold the cube with the block at bottom-left (${L} on the left, ${D} on the bottom), then scramble.`
        : `Hold the cube with ${U} on top and ${F} in front, then scramble.`

    let message = ""
    let colour = palette.text.secondary
    if (v.notice) {
        message = v.notice
    } else if (v.phase === "reading") {
        message = "Reading the cube…"
    } else if (v.phase === "build") {
        message = `Build the ${v.label} to start.`
    } else if (v.phase === "scramble" && v.fix) {
        message = `Off track. Fix: ${v.fix}`
        colour = palette.error.main
    } else if (v.phase === "scramble" && v.steps.length > 0 && v.steps[0].status === "next") {
        message = holdIt
    } else if (v.phase === "solve") {
        message = v.blockBuilt
            ? (revealed ? "Built. U4: next scramble. D4: this scramble again." : "Built. U4 shows the solutions.")
            : (revealed ? `Build the ${v.label}, then U4 for the next scramble or D4 for this one again.`
                        : `Scrambled. Build the ${v.label}; U4 shows the solutions.`)
    }

    return (
        <React.Fragment>
            {v.steps.map((s, i) =>
                <React.Fragment key={i}>
                    {i > 0 && " "}
                    <span style={STEP_STYLE[s.status](palette)}>{s.move}</span>
                </React.Fragment>
            )}
            {message &&
                <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 400, marginTop: 4, color: colour }}>
                    {message}
                </span>
            }
        </React.Fragment>
    )
}
