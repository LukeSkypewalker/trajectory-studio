/**
 * robot.js
 * Kinematics calculations and Spline equations solver for Dobot CR30h (6DOF).
 */

// Helper to convert Quaternion [w, x, y, z] to 4x4 transform matrix
export function quatToMatrix(q, pos = [0, 0, 0]) {
  const w = q[0];
  const x = q[1];
  const y = q[2];
  const z = q[3];

  const m00 = 1 - 2*y*y - 2*z*z;
  const m01 = 2*x*y - 2*z*w;
  const m02 = 2*x*z + 2*y*w;

  const m10 = 2*x*y + 2*z*w;
  const m11 = 1 - 2*x*x - 2*z*z;
  const m12 = 2*y*z - 2*x*w;

  const m20 = 2*x*z - 2*y*w;
  const m21 = 2*y*z + 2*x*w;
  const m22 = 1 - 2*x*x - 2*y*y;

  return [
    m00, m01, m02, pos[0],
    m10, m11, m12, pos[1],
    m20, m21, m22, pos[2],
    0,   0,   0,   1
  ];
}

// Matrix multiplication: A * B (4x4 flat arrays)
export function multiplyMatrices(A, B) {
  const C = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += A[i * 4 + k] * B[k * 4 + j];
      }
      C[i * 4 + j] = sum;
    }
  }
  return C;
}

// Convert 4x4 matrix rotation component to Quaternion [w, x, y, z]
export function matrixToQuat(m) {
  // m is 16-element flat array
  const r00 = m[0], r01 = m[1], r02 = m[2];
  const r10 = m[4], r11 = m[5], r12 = m[6];
  const r20 = m[8], r21 = m[9], r22 = m[10];

  const tr = r00 + r11 + r22;
  let w, x, y, z;

  if (tr > 0) {
    const S = Math.sqrt(tr + 1.0) * 2;
    w = 0.25 * S;
    x = (r21 - r12) / S;
    y = (r02 - r20) / S;
    z = (r10 - r01) / S;
  } else if ((r00 > r11) && (r00 > r22)) {
    const S = Math.sqrt(1.0 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / S;
    x = 0.25 * S;
    y = (r01 + r10) / S;
    z = (r02 + r20) / S;
  } else if (r11 > r22) {
    const S = Math.sqrt(1.0 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / S;
    x = (r01 + r10) / S;
    y = 0.25 * S;
    z = (r12 + r21) / S;
  } else {
    const S = Math.sqrt(1.0 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / S;
    x = (r02 + r20) / S;
    y = (r12 + r21) / S;
    z = 0.25 * S;
  }

  // Normalize
  const len = Math.sqrt(w*w + x*x + y*y + z*z);
  return [w/len, x/len, y/len, z/len];
}

// Compute DH matrix for joint index
export function getDHMatrixStandard(theta, d, a, alpha) {
  const c_th = Math.cos(theta);
  const s_th = Math.sin(theta);
  const c_al = Math.cos(alpha);
  const s_al = Math.sin(alpha);

  return [
    c_th, -s_th * c_al,  s_th * s_al, a * c_th,
    s_th,  c_th * c_al, -c_th * s_al, a * s_th,
    0.0,   s_al,         c_al,        d,
    0.0,   0.0,          0.0,         1.0
  ];
}

/**
 * Computes Forward Kinematics for a given joint state and DH parameters
 * @param {Array<number>} q - Joint angles (6 values)
 * @param {Object} dh - DH parameters (a, d, alpha, theta offsets)
 * @param {Array<number>} baseTransform - Flat 4x4 matrix of the base pose in the world
 * @returns {Array<Array<number>>} - Link transformations in the world frame (T0, T1, ... T6)
 */
export function computeForwardKinematics(q, dh, baseTransform) {
  const a = dh.a;
  const d = dh.d;
  const alpha = dh.alpha;
  const thetaOffsets = dh.theta;

  const linkTransforms = [baseTransform]; // T_base is index 0
  let T_curr = baseTransform;

  for (let i = 0; i < 6; i++) {
    const th = thetaOffsets[i] + q[i];
    const Ti = getDHMatrixStandard(th, d[i], a[i], alpha[i]);
    T_curr = multiplyMatrices(T_curr, Ti);
    linkTransforms.push(T_curr); // linkTransforms[i+1] is T_joint_(i+1)_world
  }

  return linkTransforms;
}

/**
 * Evaluates spline parameters at time t
 * @param {Object} trajData - The contents of the .traj file
 * @param {number} t - Time in seconds
 * @returns {Object} - Joint kinematics (q, v, a, j) for all 6 joints
 */
export function evaluateSpline(trajData, t) {
  const numJoints = 6;
  const q = new Array(numJoints).fill(0);
  const v = new Array(numJoints).fill(0);
  const a = new Array(numJoints).fill(0);
  const j = new Array(numJoints).fill(0);

  // If planning failed or there are no parts, return static targetState
  if (trajData.status !== 70 || !trajData.parts || trajData.parts.length === 0) {
    const targetState = trajData.targetState || new Array(numJoints).fill(0);
    return { q: targetState, v, a, j };
  }

  const parts = trajData.parts;
  
  // Find which part contains time t
  let selectedPart = null;
  let partIndex = 0;
  
  for (let p = 0; p < parts.length; p++) {
    const knots = parts[p].knots;
    if (knots && knots.length > 0) {
      const startKnot = knots[0];
      const endKnot = knots[knots.length - 1];
      if (t >= startKnot && t <= endKnot) {
        selectedPart = parts[p];
        partIndex = p;
        break;
      }
    }
  }

  // Handle boundary cases (out of bounds time)
  if (!selectedPart) {
    if (t < parts[0].knots[0]) {
      // Clamp to start
      return evaluateSpline(trajData, parts[0].knots[0]);
    } else {
      // Clamp to end
      const lastPart = parts[parts.length - 1];
      return evaluateSpline(trajData, lastPart.knots[lastPart.knots.length - 1]);
    }
  }

  const knots = selectedPart.knots;
  const coeffs = selectedPart.coeffs; // coeffs[joint][coeff][interval]

  // Find the interval index
  let intervalIdx = 0;
  for (let idx = 0; idx < knots.length - 1; idx++) {
    if (t >= knots[idx] && t <= knots[idx+1]) {
      intervalIdx = idx;
      break;
    }
  }

  const tStart = knots[intervalIdx];
  const h = t - tStart; // delta time from segment start

  for (let joint = 0; joint < numJoints; joint++) {
    const c3 = coeffs[joint][0][intervalIdx];
    const c2 = coeffs[joint][1][intervalIdx];
    const c1 = coeffs[joint][2][intervalIdx];
    const c0 = coeffs[joint][3][intervalIdx];

    // Cubic Spline Formulas
    q[joint] = c3 * Math.pow(h, 3) + c2 * Math.pow(h, 2) + c1 * h + c0;
    v[joint] = 3 * c3 * Math.pow(h, 2) + 2 * c2 * h + c1;
    a[joint] = 6 * c3 * h + 2 * c2;
    j[joint] = 6 * c3;
  }

  return { q, v, a, j };
}
