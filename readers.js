/**
 * readers.js
 * Multi-format trajectory readers and parsers.
 */

/**
 * Standard .traj JSON parser.
 * @param {Object} jsonData - The raw parsed JSON object
 * @returns {Object} Standardized trajectory structure
 */
export function parseTraj(jsonData) {
  return jsonData;
}

/**
 * CSV trajectory parser.
 * Fits a continuous cubic hermite spline through discrete joint states.
 * @param {string} csvText - Raw CSV file content
 * @param {number} dt - Time spacing between consecutive rows (default 0.01 seconds)
 * @returns {Object} Standardized trajectory structure with knots and spline coeffs
 */
export function parseCSV(csvText, dt = 0.01) {
  const lines = csvText.split('\n');
  const jointRows = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Skip header lines starting with letters
    if (i === 0 && (line.toLowerCase().startsWith('j') || line.toLowerCase().startsWith('axis'))) {
      continue;
    }
    
    const parts = line.split(',').map(p => parseFloat(p.trim()));
    if (parts.length >= 6 && parts.every(val => !isNaN(val))) {
      // Convert degrees to radians
      const radians = parts.map(deg => deg * Math.PI / 180.0);
      jointRows.push(radians);
    }
  }
  
  if (jointRows.length < 2) {
    throw new Error("CSV trajectory must contain at least 2 data rows");
  }
  
  const N = jointRows.length;
  const numJoints = 6;
  
  // Calculate knots: [0, dt, 2dt, ..., (N-1)dt]
  const knots = [];
  for (let k = 0; k < N; k++) {
    knots.push(k * dt);
  }
  
  // Estimate velocities at each knot using finite differences
  const velocities = []; // velocities[k][joint]
  for (let k = 0; k < N; k++) {
    const vJoints = new Array(numJoints).fill(0);
    for (let j = 0; j < numJoints; j++) {
      if (k === 0) {
        // Forward difference at start
        vJoints[j] = (jointRows[1][j] - jointRows[0][j]) / dt;
      } else if (k === N - 1) {
        // Backward difference at end
        vJoints[j] = (jointRows[N - 1][j] - jointRows[N - 2][j]) / dt;
      } else {
        // Central difference for interior points
        vJoints[j] = (jointRows[k + 1][j] - jointRows[k - 1][j]) / (2 * dt);
      }
    }
    velocities.push(vJoints);
  }
  
  // Compute cubic spline coefficients for each joint and interval
  // coeffs[joint][coeff_idx][interval]
  // coeff_idx 0 is c3, 1 is c2, 2 is c1, 3 is c0
  const coeffs = [];
  for (let j = 0; j < numJoints; j++) {
    const c3List = [];
    const c2List = [];
    const c1List = [];
    const c0List = [];
    
    for (let k = 0; k < N - 1; k++) {
      const q_k = jointRows[k][j];
      const q_kp1 = jointRows[k + 1][j];
      const v_k = velocities[k][j];
      const v_kp1 = velocities[k + 1][j];
      
      const c0 = q_k;
      const c1 = v_k;
      const c2 = (3 * (q_kp1 - q_k) - dt * (2 * v_k + v_kp1)) / (dt * dt);
      const c3 = (2 * (q_k - q_kp1) + dt * (v_k + v_kp1)) / (dt * dt * dt);
      
      c0List.push(c0);
      c1List.push(c1);
      c2List.push(c2);
      c3List.push(c3);
    }
    
    coeffs.push([c3List, c2List, c1List, c0List]);
  }
  
  return {
    status: 70,
    parts: [
      {
        knots: knots,
        coeffs: coeffs
      }
    ],
    targetState: jointRows[N - 1]
  };
}
