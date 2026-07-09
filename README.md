# Trajectory Studio

**Trajectory Studio** is an interactive, web-based dashboard and 3D WebGL viewport designed for inspecting, planning, and validating 6DOF industrial robot arm trajectories. It allows robot engineers to load trajectory profiles, inspect joint kinematic curves, visualize motion in 3D, and detect position/velocity limit violations in real-time.

---

## Key Features

### 1. Interactive 3D WebGL Viewport
- **Visual Robot Mesh**: Renders robot links and axis joints dynamically using Denavit-Hartenberg (DH) parameters.
- **Dashed Joint-Limit Rings**: Visual circles appear around joint caps when joints approach their limits:
  - **Approach Warning**: A thin dashed red circle appears when a joint gets within $20^\circ$ (0.35 rad) or $15\%$ of its range limits, or when joint velocity exceeds $75\%$ of its speed limit.
  - **Critical Approach**: Two concentric dashed red circles appear when getting closer than 5% of limits.
  - **Limit Violation**: Three concentric dashed red circles appear (simulating a thick red line) if limits are exceeded.
- **TCP Path & Target Marker**: Highlights the Tool Center Point (TCP) path trajectory with a glowing cyan tube and tracks the active position with a cyan sphere marker.
- **X (Red) & Y (Green) Coordinate Guides**: Renders physical axis paths at the origin $(0, 0, 0)$.

### 2. Kinematics Charting (Chart.js)
- Renders curves for **Position**, **Velocity**, **Acceleration**, and **Jerk** over time.
- **Vertical Cursor**: Tracks the active playback position with a dashed cyan line.
- **Joint-Colored Limit Lines**: If any joint gets within 5% of its position or velocity limit, a dashed horizontal line is drawn on the graph using that joint's color (Purple for J1, Blue for J2, etc.) along with a clear label.
- **Exceeded States**: Exceeding a limit draws a thick, solid red line (`3.0px`) with an `EXCEEDED!` label. The chart's Y-axis auto-expands (adding 8% padding) to guarantee limit lines are fully visible.

### 3. Integrated Timeline & Playback
- Consolidates play/pause, loop, speed factor (0.25x to 2x), and current/total time display labels inside a unified controls row aligned under the chart.
- A custom-aligned HTML timeline slider sits directly on top of the chart's bottom boundary line, mapping perfectly to 0% and 100% of the active curve bounds.

### 4. Interactive Kinematic State Table
- Displays active values for Joint, Position (rad), Velocity (rad/s), and Accel (rad/s²).
- Features visual progress tracks displaying the current joint position/speed centered between its negative and positive limit markers. Exceeding limits highlights values in glowing red.

### 5. Geometric Spline Recalculation
- **Path Editing**: Users can graphically manipulate the 3D trajectory geometry using interactive drag-and-drop handles directly in the scene viewport.
- **Kinematic Re-Planning**: A Python backend leverages an Inverse Kinematics (IK) solver (BFGS optimization) to calculate accurate continuous joint configurations for the modified path. It automatically locks and preserves the initial orientation (e.g., wrist-down) throughout the entire trajectory.
- **Dynamic Time Scaling & Limits**: Uses Scipy's `CubicSpline` algorithm to re-parameterize the trajectory in time. It calculates safe velocity profiles that strictly obey user-configurable TCP Speed and Centripetal Force constraints, preventing dynamic torque violations.

---

## Directory Structure

```text
trajectory-studio/
├── README.md                    # Project overview and run guide
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
├── docs/                        # Specifications and design references
│   └── design.md                # Comprehensive technical specification document
├── robots/                      # Robot-specific geometric properties
└── Trajectories/                # Raw data storage (traj/, csv/, mcap/)
```

---

## Installation & How to Run

### Prerequisites
- Python 3.x installed on your system.

### Running the Application
1. Clone or copy the repository files to a local folder.
2. Open a terminal inside the project root directory and run the web server:
   ```bash
   python run.py
   ```
3. Open your browser and navigate to:
   ```text
   http://localhost:8000
   ```
4. Selecting any trajectory from the left sidebar will render the 3D robot, compute its forward kinematics, populate motion charts, and display limits validation.

---

## Technology Stack
- **Frontend Logic**: Vanilla JavaScript (ES modules, OrbitControls).
- **3D Engine**: Three.js (WebGL renderer).
- **Charting**: Chart.js (custom layout and annotations plugins).
- **Styling**: Vanilla CSS (CSS Variables, Flexbox, absolute layouts, backdrop-filters).
- **Backend Utility**: Python (HTTP serving, file system monitoring, spline scaling computations).
