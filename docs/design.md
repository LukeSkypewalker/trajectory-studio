# Trajectory Studio - Technical Design Document

This document serves as the complete, comprehensive technical specification and layout design system for **Trajectory Studio**, an interactive 6DOF robot trajectory viewer and motion analysis dashboard. With this document, the entire application—including server configuration, kinematics mathematics, UI styles, and frontend state machines—can be reconstructed from scratch.

---

## 1. Directory Structure

The application follows a lightweight frontend-heavy architecture served by a Python backend utility. All trajectory data resides within structured folders.

```text
trajectory-studio/
├── .gitignore
├── trajectories.json            # Registry index populated by generator script
├── generate_index.py            # Automated script to scan directories and compile index
├── run.py                       # Python Web Server, file watcher & scaling API
├── scale_traj_time.py           # Helper to scale time intervals in .traj files
├── index.html                   # Core layout structure and DOM definitions
├── index.css                    # Complete modern glassmorphic styling system
├── app.js                       # Frontend entry point & global controller state machine
├── charts.js                    # Chart.js integration, visual cursor & layout plugins
├── readers.js                   # Trajectory and CSV parser logic
├── robot.js                     # Kinematics solvers (Spline curves & Forward DH Solver)
├── viewer.js                    # Three.js 3D WebGL renderer and canvas scene controller
├── robots/                      # Robot-specific geometric properties
│   ├── base.js                  # Base class for visual links representation
│   ├── aubo.js                  # Aubo iS20 representation
│   ├── aubo_is25.js             # Aubo iS25 representation
│   ├── dobot.js                 # Dobot CR30H representation
│   ├── dobot_cr20a.js           # Dobot CR20A representation
│   └── factory.js               # Visual robot config instantiation factory
└── Trajectories/                # Raw data storage
    ├── traj/                    # Raw .traj and .repr planning outputs
    ├── csv/                     # Dynamic CSV trajectories
    └── mcap/                    # MCAP container recordings (Placeholder structure)
```

---

## 2. Server Architecture and Backend Flow

The backend handles static file serving, real-time file updates tracking, and a trajectory-time scaling computation utility.

### Web Server & File Watcher (`run.py`)
- **Static Hosting**: Uses `http.server.SimpleHTTPRequestHandler` to serve the project directory on port `8000`.
- **Cache Prevention**: Inject headers:
  ```http
  Cache-Control: no-store, no-cache, must-revalidate, max-age=0
  Pragma: no-cache
  Expires: 0
  ```
- **Scale Time Endpoint (`/api/scale`)**:
  - Listens to HTTP `POST` requests.
  - Takes a JSON payload `{"id": "[id]", "scale": 1.5}`.
  - Resolves the source path at `Trajectories/traj/{id}.traj`, computes scaled knots, and outputs the result to `Trajectories/traj/export/{id}.traj` using `scale_traj_time.py`.
- **Background Watcher**:
  - Runs in a background thread.
  - Scans `Trajectories/` recursively for `.csv`, `.traj`, `.repr`, and `.mcap` files.
  - Compares file list modifications. On changes, invokes `generate_index.py` to rebuild the index database registry.

### Trajectory Re-Indexer (`generate_index.py`)
- **Subdirectory Crawl**: Scans the nested folders: `Trajectories/traj/`, `Trajectories/csv/`, and `Trajectories/mcap/`.
- **Record Compilation**: For each file, compiles:
  - `id`: The filename root (e.g. `0306fa7574...`).
  - `format`: `"traj"`, `"csv"`, or `"mcap"`.
  - `num_rows`: Number of lines (excluding header) for CSV files.
  - `duration`:
    - For `.traj` files: Reads the last knot value in the spline definition.
    - For `.csv` files: Defaults duration to `num_rows * 0.02` (assuming a standard $50\text{Hz}$ frequency).
  - `model`: Parsed from a corresponding `.repr` file if present; defaults to `"dobot-cr20a"` for CSV/MCAP files.
- **Scene Obstacles**: Parses obstacle counts (e.g., shapes of type `"box"`) inside the scene properties of `.repr` files.
- **Sorting & Writing**: Sorts files by number of obstacles and writes a clean JSON array to `trajectories.json`.

---

## 3. User Interface Layout & Styling System

The user interface features a dark glassmorphic design built on a three-column layout, optimized for high density and maximum canvas space.

### Core CSS Design Tokens
- **Background System**: Flat dark blue-black gradient `linear-gradient(135deg, #060814 0%, #0b112c 100%)`.
- **Glassmorphism Panels**: `background: rgba(10, 15, 45, 0.45); border: 1px solid rgba(255, 255, 255, 0.04); backdrop-filter: blur(20px);`.
- **Palette Conventions**:
  - Cyan (Accent Color): `#22d3ee` (active states, focus glow).
  - Red (Danger Color): `#ef4444` (limits exceeded, failure badges).
  - Green (Success Color): `#10b981` (planning success badges).
  - Text Muted: `#94a3b8` (labels, inactive states).
  - Joints Colors J1..J6: Purple (`#a855f7`), Blue (`#3b82f6`), Teal (`#14b8a6`), Green (`#22c55e`), Amber (`#f59e0b`), Rose (`#f43f5e`).
- **Typography**: Inter (UI elements) and JetBrains Mono (coordinate reads, indices, table cells).

### Column 1: Left Sidebar (`#sidebar-left`)
- **Width**: Responsive grid layout clamped between `280px` and `360px` (`grid-template-columns: clamp(280px, 18vw, 360px) 1fr ...`).
- **Segmented Format Switch**:
  - A three-way segmented pill button row: **TRAJ | CSV | MCAP**.
  - Glass buttons with active states featuring a cyan drop-shadow glow and white text.
  - MCAP button is disabled (`cursor: not-allowed; opacity: 0.35`).
- **Search Wrapper**: Custom relative container placing a search icon on the left inside a text input box.
- **Status Filter Badges**: A row of three pill badges (**All**, **Success**, **Failed**). The active count is rendered dynamically inside each badge.
- **List Container**: An auto-scrolling `<ul>` list where items represent trajectories.
  - **Dynamic Filename Trimming**: CSS flex layouts truncate long titles. Javascript trims filenames to: `15 characters prefix` + `...` + `15 characters suffix`.
  - **Status Indicator**: Features a colored dot on the left representing trajectory status.
- **Scale Tools Panel**: Slides into view at the bottom of the left panel in TRAJ mode. Contains a timeline scaling slider (-100% to 100%) with a marker at 0%, and an action button to scale the trajectory times.

### Column 2: Center Viewport (`#main-viewer`)
- **Canvas Space**: Full height container stretched to fill the central workspace.
- **Floating Scene Panel (Top Left)**:
  - Compact glass container floating inside the canvas.
  - Displays the active model in TRAJ mode.
  - Expands to inline config row in CSV mode: **Robot Select (Dropdown) | Timing Mode (Dropdown) | Timing Value (Input)**.
- **Floating TCP Position Panel (Bottom Left)**:
  - Horizontal inline layout container: `X 0.000 | Y 0.000 | Z 0.000`.
  - Colorizes labels for standard coordinate representation: **X** (Red `#ef4444`), **Y** (Green `#22c55e`), and **Z** (Blue `#3b82f6`).

### Column 3: Right Sidebar (`#sidebar-right`)
- **Width**: Responsive grid layout clamped between `500px` and `800px` (`... 1fr clamp(500px, 38vw, 800px)`).
- **Tabs Selectors**: Flat nav buttons displaying Position, Velocity, Accel, Jerk.
- **Chart Container**:
  - Canvas hosting Chart.js canvas.
  - **Overlaid Timeline Slider**: Absolute-positioned custom slider overlapping precisely on top of the chart's bottom boundary axis line.
  - **Consolidated Playback Control Row**: Anchored absolutely at `bottom: 29px` relative to `.chart-container`.
    - **Play Button**: Centered horizontally (`position: absolute; left: 50%; transform: translateX(-50%)`). Scale-zooms smoothly to `translateX(-50%) scale(1.08)` on hover without shifting.
    - **Controls Left**: Left-aligned flex group containing speed selector buttons (0.25x, 0.5x, 1x, 2x) and a looping toggle.
    - **Controls Right**: Right-aligned flex group containing current/total time display labels and the "Time (seconds)" axis label.
- **Joint States Table (`#joint-states-table`)**:
  - Horizontal width layouts: Joint name 12%, Position 38%, Velocity 38%, Accel 12%.
  - **Visual Limit Tracks**:
    - Replaces numeric cells under Position and Velocity with a `.limit-container` layout.
    - Layout: `[Min value text] --[Track line with current value dot marker]-- [Max value text]`.
    - Current value label sits centered above the visual track.
    - **Font Unification**: Current value and min/max limits share the exact same style: `font-size: 0.50rem; font-weight: normal; font-family: 'JetBrains Mono', monospace;`.
    - **Marker Point Dynamics**: The visual marker dot (`.limit-marker`) moves dynamically along the track. If a joint exceeds limits, the marker adds the `.exceeded` class, changing to red and adding a box-shadow glow (`box-shadow: 0 0 6px var(--danger-color)`), and the current value text switches color to `var(--danger-color)`.

---

## 4. Graphing & Playback Mechanics (`charts.js`)

Motion curves are drawn in Chart.js and perfectly aligned with the overlaid timeline controls via custom plugins.

### Chart Plugins
1. **Vertical Cursor Plugin (`verticalCursor`)**:
   - Monitors the active playback time.
   - Evaluates the current timeline position, drawing a dashed cyan vertical cursor line (`#22d3ee`) directly across the chart canvas from top to bottom, with a small handle circle at the top axis bounds.
2. **Dynamic Alignment Plugin (`alignSlider`)**:
   - Calculates the chart's structural grid bounds during the `afterLayout` hook.
   - Sets the absolute position of `#timeline-slider-wrapper` to align with the grid left/right bounds, and places it at `bottom - 9px` to sit directly on top of the chart bottom X-axis line.
   - Positions `#timeline-controls-row` to match the exact left and right limits of the grid area, ensuring control alignment matches the chart ticks.

### Slider Thumb Alignment Mechanics
- A standard `<input type="range">` stops the slider thumb when its edges hit the element boundaries, causing an offset mismatch with the chart grid boundary (half the thumb's width).
- **Solution**: Set the slider element width to `calc(100% + 14px)` (where `14px` is the thumb width) and apply offset margins: `margin-left: -7px; margin-right: -7px;`. This ensures the center of the drag ball maps perfectly to 0% and 100% of the chart grid borders.

---

## 5. Kinematics Mathematics & Solvers

Spline curve resolution and DH-parameter Forward Kinematics computations are handled on the frontend.

### Cubic Splines Evaluation (`robot.js`)
Given time $t$, the spline evaluator identifies the active trajectory segment (or clamps to boundary limits) and evaluates position $q$, velocity $v$, acceleration $a$, and jerk $j$ for each of the 6 joints:

$$\Delta t = t - t_{\text{start}}$$

$$q(t) = c_3 \Delta t^3 + c_2 \Delta t^2 + c_1 \Delta t + c_0$$

$$v(t) = 3 c_3 \Delta t^2 + 2 c_2 \Delta t + c_1$$

$$a(t) = 6 c_3 \Delta t + 2 c_2$$

$$j(t) = 6 c_3$$

Where $c_3, c_2, c_1, c_0$ are the third-degree coefficients stored within the `.traj` file's segment part.

### Forward Kinematics DH Solver (`robot.js`)
Computes spatial link matrices from joint configurations $q$ utilizing Denavit-Hartenberg parameters:
- **Standard DH Matrix**:
  $$T_i = \begin{bmatrix} 
  \cos\theta_i & -\sin\theta_i \cos\alpha_i & \sin\theta_i \sin\alpha_i & a_i \cos\theta_i \\
  \sin\theta_i & \cos\theta_i \cos\alpha_i & -\cos\theta_i \sin\alpha_i & a_i \sin\theta_i \\
  0 & \sin\alpha_i & \cos\alpha_i & d_i \\
  0 & 0 & 0 & 1
  \end{bmatrix}$$
  where $\theta_i = q_i + \text{offset}_i$.
- **Chain Multiplication**:
  $$T_{\text{flange}} = T_{\text{base}} \cdot T_1 \cdot T_2 \cdot T_3 \cdot T_4 \cdot T_5 \cdot T_6$$
- **TCP Parsing**: Extract coordinate indices $3, 7, 11$ from the resulting flat 16-element transform matrix representing the flange position.

### Base Unification & Zero-Pose Orientation
- **Pedestal height**: All robots (Dobot CR20A and CR30H) are unified to start from a pedestal height base translation of `[0.0, 0.0, 1.0]`.
- **Clockwise Rotation**: Apply a base quaternion of `[0.7071, 0.0, 0.0, -0.7071]` (equivalent to a $-90^\circ$ rotation around the vertical Z-axis) to rotate the default base zero-pose representation 90 degrees clockwise on screen.

---

## 6. Joint Speed Limits & Validation

Velocity validation checks are performed on each update loop frame using model-specific limits.

### Velocity (Speed) Limits Database
Speed limits (maximum joint angular velocity in degrees per second) are checked against the absolute joint velocities. Limits vary by robot model:

| Model / Axis | J1 Limit | J2 Limit | J3 Limit | J4 Limit | J5 Limit | J6 Limit |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Dobot CR20A** | $120^\circ\text{/s}$ | $120^\circ\text{/s}$ | $150^\circ\text{/s}$ | $180^\circ\text{/s}$ | $180^\circ\text{/s}$ | $180^\circ\text{/s}$ |
| **Dobot CR30H** | $150^\circ\text{/s}$ | $150^\circ\text{/s}$ | $200^\circ\text{/s}$ | $300^\circ\text{/s}$ | $300^\circ\text{/s}$ | $300^\circ\text{/s}$ |
| **Aubo iS25** | $150^\circ\text{/s}$ | $150^\circ\text{/s}$ | $150^\circ\text{/s}$ | $180^\circ\text{/s}$ | $180^\circ\text{/s}$ | $180^\circ\text{/s}$ |
| **Default/Others** | $150^\circ\text{/s}$ | $150^\circ\text{/s}$ | $150^\circ\text{/s}$ | $150^\circ\text{/s}$ | $150^\circ\text{/s}$ | $150^\circ\text{/s}$ |

### Table Render Loop & Exceeded States (`app.js`)
On every tick, `updateJointTableUI(state, dh)` evaluates:
1. **Position Limits**: Extracts `min_value` and `max_value` from `range_limits`. Checks if current position $q_j$ falls out of bounds. Calculates progress track percentage.
2. **Velocity Limits**: Obtains `maxSpeed` from the speed limits database. Calculates velocity progress percentage between `-maxSpeed` and `+maxSpeed`.
3. **Indicator Update**:
   - If absolute joint velocity $|v_j| > \text{maxSpeed}$, adds `.exceeded` class to the marker, triggering the glowing red style, and applies the danger color to the current value label.
   - Position limits follow the same logic.

---

## 7. 3D Scene Assets & Elements (`viewer.js`)

The 3D environment is rendered via Three.js with basic geometries representing links, coordinate guides, and physical scene details.

- **Pedestal and Column**: Visual links are drawn using cylinders and sphere connectors centered at the link transformations.
- **Scene Grid**: Standard helper grid on the Z=0 plane.
- **Coordinate Reference Guides**:
  - Physical cylinders representing X-axis (Red) and Y-axis (Green) paths drawn at the world origin `(0, 0, 0)`.
  - Dimensions: $1.0\text{m}$ length, $0.005\text{m}$ radius.
  - Position: Elevated slightly by $+0.001\text{m}$ in Z to lie flat on the grid without z-fighting.
- **Camera Configurations**: Orbit controls centered at target `(0, 0, 1.2)` with fixed standard projection view transforms (Front, Side, Top, Reset Ortho).
