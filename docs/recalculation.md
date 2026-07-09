# Trajectory Recalculation & Editing Architecture

Trajectory Studio allows users to manipulate the physical geometry of an industrial robot trajectory in the 3D viewport, and dynamically recalculates the underlying spline parameters to guarantee smooth continuous motion that strictly adheres to physical limits.

This document details the complete backend workflow executed during a trajectory recalculation.

---

## 1. Flow Overview

When the "Recalculate Trajectory" button is pressed, the frontend transmits an array of 3D control points (the physical path nodes) alongside configurable limit parameters (TCP speed, Centripetal Force) to the backend `POST /api/recalculate` endpoint.

The backend performs three major computation phases:
1. **Inverse Kinematics Resolution**: Resolves the 3D Cartesian points into 6DOF Joint Space points ($q$) while strictly maintaining the initial TCP orientation.
2. **Dynamic Time-Scaling**: Evaluates path curvature and limits traversal speed to ensure forces and TCP limits are obeyed, mapping arc-length to a time domain ($t_{\text{grid}}$).
3. **Continuous Spline Interpolation**: Generates a smooth $C^2$ continuous Cubic Spline for the joint angles to ensure smooth velocities and accelerations.

---

## 2. Inverse Kinematics (IK) with Orientation Lock

A 6DOF robot like the Dobot CR20A possesses infinite combinations of joint angles capable of satisfying a specific 3D Cartesian coordinate if orientation is ignored. 

To ensure stable, predictable motions (e.g., keeping a heavy payload completely flat), the IK solver enforces a strict **Orientation Constraint**.

### Process:
1. **Extract Initial Orientation**: From the original trajectory file, the starting joint configuration $q_{\text{start}}$ is evaluated via Forward Kinematics to extract the initial 3x3 rotation matrix, $R_{\text{target}}$.
2. **Optimization**: For every control point, the backend utilizes the `scipy.optimize.minimize` function with the `BFGS` algorithm.
3. **Loss Function**: The solver minimizes the weighted sum of positional drift and rotational deviation.
   $$ \text{Loss}(q) = \| \text{pos}(q) - \text{pos}_{\text{target}} \|^2 + 10.0 \cdot \sum \left( R(q) - R_{\text{target}} \right)^2 $$
4. **Seed Continuity**: The IK solver for point $N+1$ uses the optimized solution from point $N$ as its initial guess ($q_{\text{guess}}$). This guarantees the robot does not unpredictably "flip" its elbow or shoulder joint between adjacent points, finding the nearest local minimum in joint space.

---

## 3. Dynamic Time-Scaling & Limits Planning

Once the discrete joint configurations ($q_{\text{grid}}$) are found, the algorithm must assign them specific timestamps ($t_{\text{grid}}$) to govern how fast the robot moves between them. 

### Geometric Differentials
The path is parameterized by a uniform variable $u \in [0, 1]$. We compute the spatial derivatives (Jacobians and Hessians) of the 3D position vector $r(u)$ with respect to $u$.

- First derivative: $r'(u) = \frac{dr}{du}$
- Second derivative: $r''(u) = \frac{d^2r}{du^2}$

### Centripetal & TCP Velocity Limiting
The physical centripetal acceleration vector along a curved path is related to its curvature $\kappa$. The maximum allowable speed traversing that curve is bounded by the centripetal force limit $F_c$ and the payload mass $m$:

$$ \kappa = \frac{\| r'(u) \times r''(u) \|}{\| r'(u) \|^3} $$
$$ v_{\text{max, centripetal}} = \sqrt{ \frac{F_c}{m \cdot \kappa} } $$

The solver computes the maximum safe instantaneous velocity at every point $u$ as:
$$ \dot{s}_{\text{max}}(u) = \min \left( V_{\text{tcp\_limit}}, \quad v_{\text{max, centripetal}} \right) $$

### Constructing the Time Grid
The rate of traversal $\dot{u} = \frac{du}{dt}$ is computed from the arc-length derivative $\frac{ds}{du}$:
$$ \dot{u} = \frac{\dot{s}_{\text{max}}}{\| r'(u) \|} $$

The time elapsed between points is numerically integrated over the grid:
$$ \Delta t = \frac{\Delta u}{\frac{1}{2}(\dot{u}_i + \dot{u}_{i-1})} $$
$$ t_i = t_{i-1} + \Delta t $$

---

## 4. Cubic Spline Generation

With $t_{\text{grid}}$ and $q_{\text{grid}}$ finalized, the discrete points must be converted into a continuous $C^2$ polynomial that the robot firmware (and frontend viewer) can natively evaluate.

The `scipy.interpolate.CubicSpline` algorithm processes the arrays to output piecewise third-degree polynomial coefficients.
For any time interval $h = t - t_i$, the joint angle is evaluated as:
$$ q(h) = c_3 h^3 + c_2 h^2 + c_1 h + c_0 $$

These coefficients ($c_3, c_2, c_1, c_0$) for all 6 joints across all segments are serialized into the `.traj` JSON schema under `parts[0].coeffs`.

---

## 5. State Persistence

The new trajectory is saved with a unique identifier derived from the timestamp (e.g., `[original_id]_edited_1783633161`). 

Crucially, the server strictly duplicates the source trajectory's `.repr` file into the new ID's slot. This guarantees that the newly formed geometry retains identical context regarding:
- Base pedestal position (`[0, 0, 1.0]`)
- Scene collision obstacles
- Robot model type (e.g. `dobot-cr20a`)
