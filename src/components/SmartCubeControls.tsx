import React from "react";

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import BluetoothIcon from '@mui/icons-material/Bluetooth';
import BluetoothConnectedIcon from '@mui/icons-material/BluetoothConnected';
import BluetoothSearchingIcon from '@mui/icons-material/BluetoothSearching';
import ScreenRotationIcon from '@mui/icons-material/ScreenRotation';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';

import { Action } from "../Types";
import * as SmartCube from '../lib/SmartCube';

// Top-bar buttons for a smart cube: connect, Reveal/Next gestures or controller,
// and (as a controller) gyro on/off and reset the view.
// Nothing shows in browsers without Web Bluetooth.
function SmartCubeControls(props: { dispatch: React.Dispatch<Action>, size: "small" | "large" }) {
    let { dispatch, size } = props
    const [status, setStatus] = React.useState(SmartCube.getStatus())

    React.useEffect(() => SmartCube.onStatus(setStatus), [])
    React.useEffect(() => {
        SmartCube.setMoveHandler(move => dispatch({ type: "key", content: move }))
        return () => SmartCube.setMoveHandler(null)
    }, [dispatch])

    if (!SmartCube.isSupported()) return null

    const handleConnect = () => {
        if (status.connected) SmartCube.disconnect()
        else SmartCube.connect()
    }
    const battery = status.battery === null ? "" : ` (battery ${status.battery}%)`
    const connectTitle = status.connected ? `${status.name}${battery}: click to disconnect`
        : status.connecting ? "Connecting…"
        : status.error ? `Connect smart cube (last attempt failed: ${status.error})`
        : "Connect smart cube"

    const control = status.mode === "control"
    return (
        <React.Fragment>
            {status.connected &&
                <Tooltip title={control ? "The cube is a controller: click to use it for Reveal/Next only"
                                        : "Four turns of one face press Reveal/Next: click to use the cube as a controller instead"}>
                    <IconButton onClick={() => SmartCube.setMode(control ? "buttons" : "control")} size={size}
                        onFocus={(e) => e.target.blur()}>
                        {control ? <SportsEsportsIcon /> : <TouchAppIcon />}
                    </IconButton>
                </Tooltip>
            }
            {status.connected && control && status.gyro &&
                <Tooltip title={status.gyroEnabled ? "Gyro moves the view: click to turn off" : "Gyro is off: click to turn on"}>
                    <IconButton onClick={() => SmartCube.setGyroEnabled(!status.gyroEnabled)} size={size}
                        style={{ opacity: status.gyroEnabled ? 1 : 0.5 }} onFocus={(e) => e.target.blur()}>
                        <ScreenRotationIcon />
                    </IconButton>
                </Tooltip>
            }
            {status.connected && control && status.gyro && status.gyroEnabled &&
                <Tooltip title="Reset view: hold the cube as the trainer shows it, then click">
                    <IconButton onClick={SmartCube.resetGyro} size={size} onFocus={(e) => e.target.blur()}>
                        <CenterFocusStrongIcon />
                    </IconButton>
                </Tooltip>
            }
            <Tooltip title={connectTitle}>
                <IconButton onClick={handleConnect} size={size} onFocus={(e) => e.target.blur()}>
                    {status.connected ? <BluetoothConnectedIcon />
                        : status.connecting ? <BluetoothSearchingIcon />
                        : <BluetoothIcon />}
                </IconButton>
            </Tooltip>
        </React.Fragment>
    )
}

export default SmartCubeControls
