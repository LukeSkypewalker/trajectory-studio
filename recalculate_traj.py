import json
import math
import numpy as np
import time
from pathlib import Path
from scipy.optimize import minimize
from scipy.interpolate import make_interp_spline

def quat_to_matrix(q, pos):
    w, x, y, z = q
    T = np.eye(4)
    T[0,0] = 1 - 2*y*y - 2*z*z
    T[0,1] = 2*x*y - 2*z*w
    T[0,2] = 2*x*z + 2*y*w
    T[1,0] = 2*x*y + 2*z*w
    T[1,1] = 1 - 2*x*x - 2*z*z
    T[1,2] = 2*y*z - 2*x*w
    T[2,0] = 2*x*z - 2*y*w
    T[2,1] = 2*y*z + 2*x*w
    T[2,2] = 1 - 2*x*x - 2*y*y
    T[0,3] = pos[0]
    T[1,3] = pos[1]
    T[2,3] = pos[2]
    return T

def dh_transform(a, d, alpha, theta):
    ca = np.cos(alpha)
    sa = np.sin(alpha)
    ct = np.cos(theta)
    st = np.sin(theta)
    return np.array([
        [ct, -st*ca,  st*sa, a*ct],
        [st,  ct*ca, -ct*sa, a*st],
        [ 0,     sa,     ca,    d],
        [ 0,      0,      0,    1]
    ])

def forward_kinematics(q, T_base):
    a = [0.0, -0.75, -0.70, 0.0, 0.0, 0.0]
    d = [0.25, 0.0, 0.0, 0.18, 0.13, 0.11]
    alpha = [math.pi/2, 0.0, 0.0, math.pi/2, -math.pi/2, 0.0]
    theta_offset = [-math.pi/2, -math.pi/2, 0.0, -math.pi/2, 0.0, 0.0]
    
    T = T_base.copy()
    for i in range(6):
        theta = q[i] + theta_offset[i]
        Ti = dh_transform(a[i], d[i], alpha[i], theta)
        T = T @ Ti
    return T

def inverse_kinematics(target_pos, q_guess, T_base, R_target=None):
    def loss(q):
        T = forward_kinematics(q, T_base)
        pos = T[:3, 3]
        err = np.linalg.norm(pos - target_pos)**2
        if R_target is not None:
            R = T[:3, :3]
            err += np.sum((R - R_target)**2) * 10.0
        return err
        
    res = minimize(loss, q_guess, method='BFGS', options={'maxiter': 100})
    return res.x

def plan_dynamics(q_path, tcp_limit, centripetal_limit, T_base, payload_mass=20.0):
    N = len(q_path)
    if N < 2: return None, None
    
    u_pts = np.linspace(0, 1, N)
    k = min(3, N - 1)
    q_spline = make_interp_spline(u_pts, q_path, k=k)
    
    grid_size = 100
    u_grid = np.linspace(0, 1, grid_size)
    q_grid = q_spline(u_grid)
    q_prime = q_spline.derivative()(u_grid)
    
    p_grid = np.array([forward_kinematics(q, T_base)[:3, 3] for q in q_grid])
    
    du = 1.0 / (grid_size - 1)
    p_prime = np.gradient(p_grid, du, axis=0)
    p_double_prime = np.gradient(p_prime, du, axis=0)
    
    q_dot_max = np.array([120, 120, 150, 180, 180, 180]) * math.pi / 180.0
    V_max = tcp_limit / 1000.0
    F_max = centripetal_limit
    
    u_dots = []
    for i in range(grid_size):
        dp = p_prime[i]
        ddp = p_double_prime[i]
        dp_norm = np.linalg.norm(dp)
        if dp_norm < 1e-5:
            u_dots.append(0.0)
            continue
            
        u_dot_tcp = V_max / dp_norm
        
        cross_prod = np.cross(dp, ddp)
        kappa = np.linalg.norm(cross_prod) / (dp_norm ** 3)
        if kappa > 1e-5:
            v_c = math.sqrt(F_max / (payload_mass * kappa))
            u_dot_cent = v_c / dp_norm
        else:
            u_dot_cent = float('inf')
            
        u_dot_joints = float('inf')
        for j in range(6):
            if abs(q_prime[i, j]) > 1e-5:
                u_dot_j = q_dot_max[j] / abs(q_prime[i, j])
                u_dot_joints = min(u_dot_joints, u_dot_j)
                
        u_dots.append(min(u_dot_tcp, u_dot_cent, u_dot_joints))
        
    u_dots = np.array(u_dots)
    window = max(3, grid_size // 10)
    u_dots_smooth = np.convolve(u_dots, np.ones(window)/window, mode='same')
    u_dots_final = np.minimum(u_dots, u_dots_smooth)
    
    t_grid = np.zeros(grid_size)
    for i in range(1, grid_size):
        avg_u_dot = (u_dots_final[i-1] + u_dots_final[i]) / 2.0
        dt = du / avg_u_dot if avg_u_dot > 1e-5 else du / 1e-5
        t_grid[i] = t_grid[i-1] + dt
        
    return t_grid, q_grid

def recalculate(traj_id, tcp_limit, centripetal_limit, control_points, base_pos=None, base_quat=None):
    # Load original
    src_path = Path("Trajectories") / "traj" / f"{traj_id}.traj"
    if not src_path.exists():
        raise FileNotFoundError(f"Trajectory {traj_id} not found.")
        
    with open(src_path, 'r') as f:
        traj_data = json.load(f)
        
    if not traj_data.get('parts'):
        raise ValueError("Trajectory has no parts")
        
    # T_base from repr
    if base_pos is None:
        base_pos = [0.0, 0.0, 1.0]
    if base_quat is None:
        base_quat = [0.7071, 0.0, 0.0, -0.7071]
    T_base = quat_to_matrix(base_quat, base_pos)
    
    # 1. Run IK for all control points
    q_path = []
    # Start with original start pose
    start_pos = []
    part0 = traj_data['parts'][0]
    for dof in range(len(part0['coeffs'])):
        # index 3 is c0 (constant term), index 0 is first segment
        start_pos.append(part0['coeffs'][dof][3][0])
    q_current = np.array(start_pos)
    
    # Extract original orientation to maintain it throughout the trajectory
    T_start = forward_kinematics(q_current, T_base)
    R_target = T_start[:3, :3]
    
    for pt in control_points:
        target_pos = np.array(pt)
        q_new = inverse_kinematics(target_pos, q_current, T_base, R_target)
        q_path.append(q_new.tolist())
        q_current = q_new

    q_path = np.array(q_path)
    num_pts = len(q_path)
    
    if num_pts < 2:
        raise ValueError("Not enough control points to generate spline")
    
    # 2. Re-parameterize time based on dynamics
    t_grid, q_grid = plan_dynamics(q_path, tcp_limit, centripetal_limit, T_base, payload_mass=20.0)
    
    # 3. Create Spline for Joint Space
    from scipy.interpolate import CubicSpline
    spline = CubicSpline(t_grid, q_grid)
    
    knots = t_grid.tolist()
    segments = len(knots) - 1
    
    part = {
        "start": {"position": q_grid[0].tolist(), "velocity": [0]*6, "acceleration": [0]*6},
        "target": {"position": q_grid[-1].tolist(), "velocity": [0]*6, "acceleration": [0]*6},
        "knots": knots,
        "coeffs": [],
        "linear": False
    }
    
    coeffs = []
    for dof in range(6):
        dof_coeffs = []
        for order_idx in range(4):
            dof_coeffs.append(spline.c[order_idx, :, dof].tolist())
        coeffs.append(dof_coeffs)
        
    part["coeffs"] = coeffs
    
    # Generate new ID
    new_id = f"{traj_id}_edited_{int(time.time())}"
    
    new_traj = {
        "status": 70,
        "parts": [part]
    }
    
    out_path = Path("Trajectories") / "traj" / f"{new_id}.traj"
    with open(out_path, 'w') as f:
        json.dump(new_traj, f)
        
    import shutil
    src_repr = Path("Trajectories") / "traj" / f"{traj_id}.repr"
    if src_repr.exists():
        dst_repr = Path("Trajectories") / "traj" / f"{new_id}.repr"
        shutil.copy(src_repr, dst_repr)
        
    return new_id
