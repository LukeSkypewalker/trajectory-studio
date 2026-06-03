/**
 * app.js
 * Main entry point and state coordinator.
 */

import * as THREE from 'three';
import { TrajectoryViewer } from './viewer.js?v=36';
import { TrajectoryChart } from './charts.js?v=36';
import { evaluateSpline, computeForwardKinematics, quatToMatrix } from './robot.js?v=36';
import { parseTraj, parseCSV } from './readers.js?v=36';

class TrajectoryApp {
  constructor() {
    this.viewer = null;
    this.chart = null;
    
    // Application state
    this.trajectories = [];
    this.filteredTrajectories = [];
    this.selectedTraj = null;
    
    this.activeRepr = null;
    this.activeTraj = null;
    
    // Playback state
    this.isPlaying = false;
    this.currentTime = 0.0;
    this.totalDuration = 0.0;
    this.speedMultiplier = 1.0;
    this.loopPlayback = false;
    
    // Graph state
    this.activeTab = 'position'; // 'position', 'velocity', 'acceleration', 'jerk'
    
    // HTML elements references
    this.elements = {};
    
    // Timing logic
    this.lastFrameTime = 0;
  }

  async init() {
    // 1. Instantiate 3D Viewer & Chart
    this.viewer = new TrajectoryViewer('three-canvas');
    this.chart = new TrajectoryChart('motion-chart');
    
    // 2. Fetch UI Element References
    this.cacheElements();
    
    // 3. Register Event Listeners
    this.registerEvents();
    
    // 4. Fetch Trajectory index
    await this.loadTrajectoryIndex();
    
    // 5. Start animation loop
    requestAnimationFrame((timestamp) => this.playbackLoop(timestamp));
    
    // 6. Select the first trajectory as default if available
    if (this.filteredTrajectories.length > 0) {
      this.selectTrajectory(this.filteredTrajectories[0].id);
    }
    
    // Trigger Lucide icons replacing
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  cacheElements() {
    const ids = [
      'search-input', 'trajectory-list', 'db-stats-summary',
      'active-trajectory-id', 'copy-id-btn', 'meta-robot-model', 'meta-duration', 'meta-parts', 'meta-interpolation',
      'canvas-loader', 'loader-text', 'failed-trajectory-overlay', 'warning-status-code',
      'timeline-slider', 'timeline-progress-bar', 'time-current', 'time-total',
      'btn-play-pause', 'btn-loop',
      'tab-position', 'tab-velocity', 'tab-acceleration', 'tab-jerk',
      'tcp-x', 'tcp-y', 'tcp-z',
      'time-scale-slider', 'time-scale-val', 'btn-save-scaled'
    ];
    
    ids.forEach(id => {
      this.elements[id] = document.getElementById(id);
    });
  }

  registerEvents() {
    // Search input
    this.elements['search-input'].addEventListener('input', () => this.applyFilters());
    
    // Status filter badges
    const filterButtons = document.querySelectorAll('#status-filters .badge-btn');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        filterButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.applyFilters();
      });
    });
    
    // Playback Buttons
    this.elements['btn-play-pause'].addEventListener('click', () => this.togglePlayPause());
    this.elements['btn-loop'].addEventListener('click', () => {
      this.loopPlayback = !this.loopPlayback;
      this.elements['btn-loop'].classList.toggle('toggled', this.loopPlayback);
    });

    // Scale Tools
    this.elements['time-scale-slider'].addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.elements['time-scale-val'].innerText = val > 0 ? `+${val}%` : `${val}%`;
      const scale = Math.max(0.05, 1.0 + (val / 100.0));
      this.applyTimeScaleToActiveTraj(scale);
    });

    this.elements['btn-save-scaled'].addEventListener('click', async () => {
      if (!this.selectedTraj) return;
      const val = parseFloat(this.elements['time-scale-slider'].value);
      const scale = Math.max(0.05, 1.0 + (val / 100.0));
      
      this.elements['btn-save-scaled'].disabled = true;
      this.elements['btn-save-scaled'].innerText = 'Saving...';
      
      try {
        const response = await fetch('/api/scale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: this.selectedTraj, scale: scale })
        });
        
        if (response.ok) {
          this.elements['btn-save-scaled'].innerText = 'Saved!';
          this.originalTraj = JSON.parse(JSON.stringify(this.activeTraj));
          this.elements['time-scale-slider'].value = 0;
          this.elements['time-scale-val'].innerText = '0%';
          setTimeout(() => {
            this.elements['btn-save-scaled'].innerText = 'Save Scaled';
            this.elements['btn-save-scaled'].disabled = false;
          }, 2000);
        } else {
          throw new Error('Server returned ' + response.status);
        }
      } catch (err) {
        console.error(err);
        this.elements['btn-save-scaled'].innerText = 'Error';
        setTimeout(() => {
          this.elements['btn-save-scaled'].innerText = 'Save Scaled';
          this.elements['btn-save-scaled'].disabled = false;
        }, 2000);
      }
    });

    // Timeline slider
    this.elements['timeline-slider'].addEventListener('input', (e) => {
      const sliderVal = parseFloat(e.target.value);
      this.currentTime = (sliderVal / 100.0) * this.totalDuration;
      this.updatePlaybackState(this.currentTime);
      if (!this.isPlaying) {
        this.updatePlayPauseButtonUI();
      }
    });
    
    // Speed badges
    const speedButtons = document.querySelectorAll('.speed-btn');
    speedButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        speedButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.speedMultiplier = parseFloat(e.target.dataset.speed);
      });
    });
    
    // Toggle buttons removed
    
    // Graph Tabs
    const tabButtons = document.querySelectorAll('.graph-tabs .tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        tabButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.activeTab = e.target.dataset.tab;
        
        // Redraw chart
        if (this.activeTraj) {
          this.chart.update(this.activeTraj, this.activeTab);
          this.chart.setCursor(this.currentTime);
        }
      });
    });
    
    // Copy ID button
    this.elements['copy-id-btn'].addEventListener('click', () => {
      if (this.selectedTraj) {
        navigator.clipboard.writeText(this.selectedTraj)
          .then(() => {
            const icon = this.elements['copy-id-btn'].querySelector('i');
            if (window.lucide) {
              this.elements['copy-id-btn'].innerHTML = '<i data-lucide="check" style="color: var(--success-color);"></i>';
              window.lucide.createIcons();
              setTimeout(() => {
                this.elements['copy-id-btn'].innerHTML = '<i data-lucide="copy"></i>';
                window.lucide.createIcons();
              }, 1500);
            }
          });
      }
    });
  }

  async loadTrajectoryIndex() {
    this.showLoader("Loading database index...");
    try {
      const response = await fetch('trajectories.json');
      this.trajectories = await response.json();
      this.filteredTrajectories = [...this.trajectories];
      this.renderSidebarList();
      this.updateSidebarStats();
    } catch (e) {
      console.error("Error loading index:", e);
      this.elements['db-stats-summary'].innerText = "Error loading index database.";
    } finally {
      this.hideLoader();
    }
  }

  renderSidebarList() {
    const list = this.elements['trajectory-list'];
    list.innerHTML = '';
    
    if (this.filteredTrajectories.length === 0) {
      list.innerHTML = '<li class="scene-item" style="padding: 20px; justify-content: center; color: var(--text-muted);">No trajectories match filters</li>';
      return;
    }
    
    this.filteredTrajectories.forEach(t => {
      const li = document.createElement('li');
      li.className = `list-item ${this.selectedTraj === t.id ? 'selected' : ''}`;
      li.setAttribute('role', 'option');
      li.setAttribute('data-id', t.id);
      
      const shortId = `${t.id.slice(0, 8)}...${t.id.slice(-8)}`;
      const statusColor = t.status === 70 ? 'var(--success-color)' : t.status === 40 ? 'var(--danger-color)' : 'var(--warning-color)';
      const statusLabel = t.status === 70 ? 'Planned' : t.status === 40 ? 'Collided' : 'Timeout';
      
      const isCsv = t.format === 'csv';
      const badgeHtml = isCsv ? `<span style="font-size: 0.6rem; font-weight: bold; background-color: rgba(6, 182, 212, 0.15); color: #06b6d4; padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(6, 182, 212, 0.3); margin-left: 6px;">CSV</span>` : '';
      
      li.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background-color: ${statusColor}; box-shadow: 0 0 4px ${statusColor};" title="${statusLabel}"></div>
          <span class="item-id monospace" style="font-size: 0.75rem;">${shortId}</span>
          ${badgeHtml}
        </div>
        <span style="font-size: 0.7rem; color: var(--text-muted);">${t.duration.toFixed(2)}s</span>
      `;
      
      li.addEventListener('click', () => this.selectTrajectory(t.id));
      list.appendChild(li);
    });
    
    if (window.lucide) {
      window.lucide.createIcons({ attrs: { class: 'meta-group-icon' } });
    }
  }

  updateSidebarStats() {
    const total = this.trajectories.length;
    const showing = this.filteredTrajectories.length;
    const success = this.trajectories.filter(t => t.status === 70).length;
    this.elements['db-stats-summary'].innerText = `${showing} of ${total} paths (${success} planned)`;
  }

  applyFilters() {
    const searchVal = this.elements['search-input'].value.toLowerCase();
    
    // Status filter
    const activeStatusBtn = document.querySelector('#status-filters .badge-btn.active');
    const statusVal = activeStatusBtn.dataset.val; // 'all', '70', 'fail'
    
    this.filteredTrajectories = this.trajectories.filter(t => {
      // 1. Search filter (match full ID or parts of it)
      const matchesSearch = t.id.toLowerCase().includes(searchVal);
      
      // 2. Status filter
      let matchesStatus = true;
      if (statusVal === '70') {
        matchesStatus = t.status === 70;
      } else if (statusVal === 'fail') {
        matchesStatus = t.status !== 70;
      }
      
      return matchesSearch && matchesStatus;
    });
    
    this.renderSidebarList();
    this.updateSidebarStats();
  }

  async selectTrajectory(id) {
    if (this.selectedTraj === id && this.activeTraj) return;
    
    // Stop playback
    this.isPlaying = false;
    this.updatePlayPauseButtonUI();
    
    this.selectedTraj = id;
    
    // Update selected item in sidebar list
    const items = this.elements['trajectory-list'].querySelectorAll('.list-item');
    items.forEach(item => {
      if (item.dataset.id === id) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
    
    this.showLoader(`Loading trajectory data...`);
    
    try {
      const trajMeta = this.trajectories.find(t => t.id === id) || {};
      const format = trajMeta.format || 'traj';
      
      const reprUrl = `Trajectories/${id}.repr`;
      const fileUrl = `Trajectories/${id}.${format}`;
      
      let reprData = null;
      let trajData = null;
      
      // Try to load repr if it exists, otherwise fallback to dobot-cr20a
      try {
        const reprResponse = await fetch(reprUrl);
        if (reprResponse.ok) {
          reprData = await reprResponse.json();
        }
      } catch (err) {
        console.warn("Could not fetch repr file, using fallback:", err);
      }
      
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        throw new Error(`Failed to load trajectory file: ${fileUrl}`);
      }
      
      if (format === 'csv') {
        const csvText = await fileResponse.text();
        trajData = parseCSV(csvText, 0.01);
        if (!reprData) {
          reprData = createDobotCR20ARepr(id);
        }
      } else {
        const trajJson = await fileResponse.json();
        trajData = parseTraj(trajJson);
      }
      
      this.activeRepr = reprData;
      this.originalTraj = trajData;
      this.activeTraj = JSON.parse(JSON.stringify(this.originalTraj));
      
      // Reset scale UI on new load
      this.elements['time-scale-slider'].value = 0;
      this.elements['time-scale-val'].innerText = '0%';
      
      this.updateActiveMetadata();
      
      // Build 3D elements
      this.viewer.buildRobot(this.activeRepr);
      this.viewer.buildSceneObstacles(this.activeRepr);
      
      // Compute duration
      let duration = 0.0;
      const parts = this.activeTraj.parts;
      if (parts && parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart.knots && lastPart.knots.length > 0) {
          duration = lastPart.knots[lastPart.knots.length - 1];
        }
      }
      this.totalDuration = duration;
      
      // Timeline slider properties
      this.elements['timeline-slider'].value = 0;
      this.elements['timeline-slider'].disabled = (duration === 0);
      this.elements['time-total'].innerText = `${duration.toFixed(2)}s`;
      
      // 3. Build 3D trajectory path
      if (this.activeTraj.status === 70 && duration > 0) {
        this.elements['failed-trajectory-overlay'].classList.add('hidden');
        this.computeAndDraw3dPath();
      } else {
        // Planning failed or static pose
        this.elements['failed-trajectory-overlay'].classList.remove('hidden');
        this.elements['warning-status-code'].innerText = this.activeTraj.status;
        
        // Explain reason based on status code
        const reasonEl = document.getElementById('failed-trajectory-reason');
        if (this.activeTraj.status === 40) {
          reasonEl.innerHTML = `Trajectory planning was aborted due to a <strong>collision</strong> in the workspace. No motion path is available.`;
        } else if (this.activeTraj.status === 50) {
          reasonEl.innerHTML = `Trajectory planning <strong>timed out</strong> before finding a valid motion path.`;
        } else {
          reasonEl.innerHTML = `Trajectory contains a static configuration pose (Status ${this.activeTraj.status}). No movement spline is present.`;
        }
        
        this.viewer.drawTrajectoryPath([]); // Clear path
      }
      
      // Set chart data
      this.chart.update(this.activeTraj, this.activeTab);
      
      // Reset play time
      this.currentTime = 0.0;
      this.updatePlaybackState(0.0);
      
    } catch (e) {
      console.error("Error loading active trajectory details:", e);
      this.showLoader(`Error loading files for ID: ${id.slice(0, 8)}...`);
    } finally {
      this.hideLoader();
    }
  }

  updateActiveMetadata() {
    this.elements['active-trajectory-id'].innerText = this.selectedTraj;
    
    const equipment = this.activeRepr.equipment_model || {};
    this.elements['meta-robot-model'].innerText = equipment.model_name || "unknown";
    
    // Status text and parts count
    const partsCount = this.activeTraj.parts ? this.activeTraj.parts.length : 0;
    this.elements['meta-parts'].innerText = partsCount > 0 ? `${partsCount} Segment(s)` : "Static Pose";
    
    const linearMovement = this.activeRepr.parts ? any(this.activeRepr.parts, p => p.linear) : false;
    this.elements['meta-interpolation'].innerText = linearMovement ? "Linear (Cartesian)" : "Joint Space";
  }

  applyTimeScaleToActiveTraj(scale) {
    if (!this.originalTraj) return;
    
    // Deep clone the original trajectory
    this.activeTraj = JSON.parse(JSON.stringify(this.originalTraj));
    
    if (this.activeTraj.parts && scale !== 1.0) {
      this.activeTraj.parts.forEach(part => {
        const timeKey = part.knots ? 'knots' : (part.nodes ? 'nodes' : null);
        if (timeKey && part[timeKey]) {
          part[timeKey] = part[timeKey].map(t => t * scale);
        }
        if (part.coeffs) {
          const d1 = scale * scale * scale;
          const d2 = scale * scale;
          const d3 = scale;
          for (let dof = 0; dof < part.coeffs.length; dof++) {
            for (let seg = 0; seg < part.coeffs[dof][0].length; seg++) {
              part.coeffs[dof][0][seg] /= d1;
              part.coeffs[dof][1][seg] /= d2;
              part.coeffs[dof][2][seg] /= d3;
            }
          }
        }
      });
    }
    
    // Recompute duration
    let duration = 0.0;
    const parts = this.activeTraj.parts;
    if (parts && parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      if (lastPart.knots && lastPart.knots.length > 0) {
        duration = lastPart.knots[lastPart.knots.length - 1];
      }
    }
    
    // Maintain relative progress
    const ratio = this.totalDuration > 0 ? this.currentTime / this.totalDuration : 0;
    
    this.totalDuration = duration;
    this.elements['timeline-slider'].disabled = (duration === 0);
    this.elements['time-total'].innerText = `${duration.toFixed(2)}s`;
    
    if (this.activeTraj.status === 70 && duration > 0) {
      this.computeAndDraw3dPath();
    }
    this.chart.update(this.activeTraj, this.activeTab);
    
    this.currentTime = isNaN(ratio) ? 0 : ratio * this.totalDuration;
    if (this.currentTime > this.totalDuration) this.currentTime = this.totalDuration;
    this.updatePlaybackState(this.currentTime);
  }

  computeAndDraw3dPath() {
    const samples = 250;
    const points = [];
    
    const dh = this.activeRepr.equipment_model.dh_parameters;
    const basePos = this.activeRepr.equipment_model.position || [0,0,0];
    const baseQuat = this.activeRepr.equipment_model.quaternion || [1,0,0,0];
    
    const T_base = quatToMatrix(baseQuat, basePos);
    
    for (let i = 0; i < samples; i++) {
      const t = (this.totalDuration * i) / (samples - 1);
      const state = evaluateSpline(this.activeTraj, t);
      
      // Compute Forward Kinematics for this point
      const linkTransforms = computeForwardKinematics(state.q, dh, T_base);
      
      // Get the flange transform (link 6)
      const T_flange = linkTransforms[6];
      // Flange position (translation component of final 4x4 matrix)
      // Flat array indices for translation columns are 3 (x), 7 (y), 11 (z)
      const x = T_flange[3];
      const y = T_flange[7];
      const z = T_flange[11];
      
      points.push(new THREE.Vector3(x, y, z));
    }
    
    this.viewer.drawTrajectoryPath(points);
  }

  updatePlaybackState(t) {
    this.elements['time-current'].innerText = `${t.toFixed(2)}s`;
    
    // Update timeline progress bar
    if (this.totalDuration > 0) {
      const percentage = (t / this.totalDuration) * 100;
      this.elements['timeline-progress-bar'].style.width = `${percentage}%`;
      this.elements['timeline-slider'].value = percentage;
    } else {
      this.elements['timeline-progress-bar'].style.width = '0%';
      this.elements['timeline-slider'].value = 0;
    }
    
    if (!this.activeTraj || !this.activeRepr) return;
    
    // 1. Evaluate spline at time t
    const state = evaluateSpline(this.activeTraj, t);
    
    // 2. Solve Forward Kinematics
    const dh = this.activeRepr.equipment_model.dh_parameters;
    const basePos = this.activeRepr.equipment_model.position || [0,0,0];
    const baseQuat = this.activeRepr.equipment_model.quaternion || [1,0,0,0];
    const T_base = quatToMatrix(baseQuat, basePos);
    
    const linkTransforms = computeForwardKinematics(state.q, dh, T_base);
    
    // 3. Update 3D Viewer pose
    this.viewer.updatePose(linkTransforms);
    
    // 4. Update Joint Info table in UI
    this.updateJointTableUI(state, dh);
    
    // 5. Update Flange Cartesian Info in UI
    const T_flange = linkTransforms[6];
    
    // Extract base-relative flange position by back-applying the base transform
    // (Or we can just extract relative to base from the DH product prior to T_base)
    // T_flange_base is the DH product without T_base applied first.
    // Let's compute it quickly or extract it from T_flange in base coordinate system:
    // To do this simply, we can run computeForwardKinematics with base=Identity
    const T_flange_base = computeForwardKinematics(state.q, dh, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])[6];
    
    this.elements['tcp-x'].innerText = `${T_flange_base[3].toFixed(3)} m`;
    this.elements['tcp-y'].innerText = `${T_flange_base[7].toFixed(3)} m`;
    this.elements['tcp-z'].innerText = `${T_flange_base[11].toFixed(3)} m`;
    
    // 6. Update vertical line cursor in graphs
    this.chart.setCursor(t);
  }

  updateJointTableUI(state, dh) {
    const limits = this.activeRepr.equipment_model.range_limits || [];
    
    for (let j = 0; j < 6; j++) {
      const qVal = state.q[j];
      const qDeg = (qVal * 180 / Math.PI).toFixed(1);
      
      const vVal = state.v[j];
      const aVal = state.a[j];
      const jVal = state.j[j];
      
      const row = document.getElementById(`joint-row-${j+1}`);
      if (!row) continue;
      
      // Update cell content
      const valCell = row.querySelector('.val-cell');
      const velCell = row.querySelector('.vel-cell');
      
      // Check limits
      let isExceeded = false;
      const limit = limits.find(l => l.joint_id === j);
      if (limit) {
        if (qVal < limit.min_value || qVal > limit.max_value) {
          isExceeded = true;
        }
      }
      
      // Style cells
      if (isExceeded) {
        valCell.style.color = 'var(--danger-color)';
        valCell.style.fontWeight = 'bold';
      } else {
        valCell.style.color = 'var(--text-primary)';
        valCell.style.fontWeight = 'normal';
      }
      
      // Find limits label to show min/max
      const maxLimDeg = limit ? (limit.max_value * 180 / Math.PI).toFixed(0) : '';
      const minLimDeg = limit ? (limit.min_value * 180 / Math.PI).toFixed(0) : '';
      const limitStr = limit ? `[${minLimDeg}°, ${maxLimDeg}°]` : '';
      
      // Set content
      valCell.innerHTML = `<span class="j-val">${qDeg}°</span> <span class="j-lim">${limitStr}</span>`;
      
      // Show requested tab value in the third column
      if (this.activeTab === 'position') {
        velCell.innerText = `${qVal.toFixed(3)} rad`;
      } else if (this.activeTab === 'velocity') {
        velCell.innerText = `${vVal.toFixed(2)} rad/s`;
      } else if (this.activeTab === 'acceleration') {
        velCell.innerText = `${aVal.toFixed(2)} rad/s²`;
      } else if (this.activeTab === 'jerk') {
        velCell.innerText = `${jVal.toFixed(1)} rad/s³`;
      }
    }
  }

  // Playback control functions
  togglePlayPause() {
    if (!this.isPlaying && this.totalDuration > 0 && this.currentTime >= this.totalDuration - 0.001) {
      this.currentTime = 0.0;
    }
    this.isPlaying = !this.isPlaying;
    this.updatePlayPauseButtonUI();
  }

  updatePlayPauseButtonUI() {
    const btn = this.elements['btn-play-pause'];
    let iconName = 'play';
    if (this.isPlaying) {
      iconName = 'pause';
    } else if (this.totalDuration > 0 && this.currentTime >= this.totalDuration - 0.001) {
      iconName = 'rotate-ccw'; // Restart icon in Lucide
    }
    
    btn.innerHTML = `<i data-lucide="${iconName}" id="play-icon"></i>`;
      
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  stopReset() {
    this.isPlaying = false;
    this.currentTime = 0.0;
    this.updatePlayPauseButtonUI();
    this.updatePlaybackState(0.0);
  }

  playbackLoop(timestamp) {
    if (!this.lastFrameTime) this.lastFrameTime = timestamp;
    const delta = (timestamp - this.lastFrameTime) / 1000.0; // Seconds since last frame
    this.lastFrameTime = timestamp;
    
    if (this.isPlaying && this.totalDuration > 0) {
      this.currentTime += delta * this.speedMultiplier;
      
      if (this.currentTime >= this.totalDuration) {
        if (this.loopPlayback) {
          this.currentTime = 0.0;
        } else {
          this.currentTime = this.totalDuration;
          this.isPlaying = false;
          this.updatePlayPauseButtonUI();
        }
      }
      
      this.updatePlaybackState(this.currentTime);
    }
    
    requestAnimationFrame((timestamp) => this.playbackLoop(timestamp));
  }

  showLoader(text) {
    this.elements['loader-text'].innerText = text;
    this.elements['canvas-loader'].classList.remove('hidden');
  }

  hideLoader() {
    this.elements['canvas-loader'].classList.add('hidden');
  }
}

// Helper to construct fallback .repr for Dobot CR20A
function createDobotCR20ARepr(id) {
  return {
    parts: [
      {
        start: { position: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
        target: { position: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
        wrist_down: false,
        linear: false,
        ignore_collisions: false,
        start_tcp_position: [0, 0, 0],
        start_tcp_rotation: [1, 0, 0, 0],
        target_tcp_position: [0, 0, 0],
        target_tcp_rotation: [1, 0, 0, 0]
      }
    ],
    scene: {
      shapes: []
    },
    equipment_model: {
      model_name: "dobot-cr20a",
      position: [0.0, 0.0, 0.0],
      quaternion: [1.0, 0.0, 0.0, 0.0],
      hitbox: [
        // Link 1
        {
          link: 1,
          shape: {
            shape_type: "capsule",
            position: [0, 0, 0],
            quaternion: [1, 0, 0, 0],
            radius: 0.13,
            height: 0.25
          }
        },
        // Link 2 (Shoulder/Upper arm)
        {
          link: 2,
          shape: {
            shape_type: "capsule",
            position: [-0.375, 0, 0],
            quaternion: [0.7071, 0, 0.7071, 0],
            radius: 0.11,
            height: 0.75
          }
        },
        {
          link: 2,
          shape: {
            shape_type: "sphere",
            position: [0, 0, 0],
            quaternion: [1, 0, 0, 0],
            radius: 0.13
          }
        },
        {
          link: 2,
          shape: {
            shape_type: "sphere",
            position: [-0.75, 0, 0],
            quaternion: [1, 0, 0, 0],
            radius: 0.11
          }
        },
        // Link 3 (Forearm)
        {
          link: 3,
          shape: {
            shape_type: "capsule",
            position: [-0.35, 0, 0],
            quaternion: [0.7071, 0, 0.7071, 0],
            radius: 0.09,
            height: 0.70
          }
        },
        {
          link: 3,
          shape: {
            shape_type: "sphere",
            position: [0, 0, 0],
            quaternion: [1, 0, 0, 0],
            radius: 0.095
          }
        },
        {
          link: 3,
          shape: {
            shape_type: "sphere",
            position: [-0.70, 0, 0],
            quaternion: [1, 0, 0, 0],
            radius: 0.085
          }
        },
        // Link 4
        {
          link: 4,
          shape: {
            shape_type: "capsule",
            position: [0, 0, 0.09],
            quaternion: [1, 0, 0, 0],
            radius: 0.08,
            height: 0.18
          }
        },
        // Link 5
        {
          link: 5,
          shape: {
            shape_type: "capsule",
            position: [0, 0, 0.065],
            quaternion: [1, 0, 0, 0],
            radius: 0.08,
            height: 0.13
          }
        },
        // Link 6
        {
          link: 6,
          shape: {
            shape_type: "capsule",
            position: [0, 0, 0.055],
            quaternion: [1, 0, 0, 0],
            radius: 0.08,
            height: 0.11
          }
        }
      ],
      rigid_bodies: [],
      dh_parameters: {
        a: [0.0, -0.75, -0.70, 0.0, 0.0, 0.0],
        d: [0.25, 0.0, 0.0, 0.18, 0.13, 0.11],
        alpha: [1.5707963267948966, 0.0, 0.0, 1.5707963267948966, -1.5707963267948966, 0.0],
        theta: [-1.5707963267948966, -1.5707963267948966, 0.0, -1.5707963267948966, 0.0, 0.0],
        joint_type: ["Revolute", "Revolute", "Revolute", "Revolute", "Revolute", "Revolute"]
      },
      range_limits: [
        { type: "Static", joint_id: 0, min_value: -6.28318, max_value: 6.28318 },
        { type: "Static", joint_id: 1, min_value: -6.28318, max_value: 6.28318 },
        { type: "Static", joint_id: 2, min_value: -6.28318, max_value: 6.28318 },
        { type: "Static", joint_id: 3, min_value: -6.28318, max_value: 6.28318 },
        { type: "Static", joint_id: 4, min_value: -6.28318, max_value: 6.28318 },
        { type: "Static", joint_id: 5, min_value: -6.28318, max_value: 6.28318 }
      ]
    }
  };
}

// Utility check helper
function any(arr, predicate) {
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return true;
  }
  return false;
}

// Matrix helper converter to Quat ( Craig's matrix components )
function matrixToQuat(m) {
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

  return [w, x, y, z];
}

// Start App when loaded
window.addEventListener('DOMContentLoaded', () => {
  const app = new TrajectoryApp();
  app.init();
});
