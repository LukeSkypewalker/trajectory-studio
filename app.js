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
    this.activeMode = 'traj'; // 'traj', 'csv', 'mcap'
    this.globalCSVRobot = 'dobot-cr20a';
    this.globalCSVTimingMode = 'hz';
    this.globalCSVTimingVal = 20;
    
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
    
    // 7. Start polling database changes once per second
    this.startIndexPolling();
    
    // Trigger Lucide icons replacing
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  cacheElements() {
    const ids = [
      'search-input', 'trajectory-list',
      'active-trajectory-id', 'copy-id-btn', 'meta-robot-model', 'meta-duration', 'meta-parts', 'meta-interpolation',
      'canvas-loader', 'loader-text', 'failed-trajectory-overlay', 'warning-status-code',
      'timeline-slider', 'timeline-progress-bar', 'time-current', 'time-total',
      'btn-play-pause', 'btn-loop',
      'tab-position', 'tab-velocity', 'tab-acceleration', 'tab-jerk',
      'tcp-x', 'tcp-y', 'tcp-z',
      'time-scale-slider', 'time-scale-val',
      'btn-edit-traj', 'btn-rename-traj', 'btn-delete-traj', 'btn-recalculate', 'btn-calculate-new', 'btn-cancel-edit', 'view-mode-panels', 'edit-mode-panels', 'limit-tcp-speed', 'limit-centripetal',
      'scale-tools-panel', 'scene-csv-controls', 'scene-model-text', 'csv-robot-select', 'csv-timing-mode', 'csv-timing-val',
      'mode-btn-traj', 'mode-btn-csv', 'mode-btn-mcap'
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



    // Edit mode buttons
    this.elements['btn-edit-traj'].addEventListener('click', () => {
      if (this.selectedTraj && this.activeTraj && this.activeTraj.status === 70) {
        this.setEditMode(true);
      }
    });

    this.elements['btn-rename-traj'].addEventListener('click', async () => {
      if (!this.selectedTraj) return;
      const newName = prompt('Enter new name for this trajectory:', this.selectedTraj);
      if (newName && newName.trim() !== '' && newName !== this.selectedTraj) {
        try {
          const response = await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: this.selectedTraj, new_id: newName.trim() })
          });
          if (response.ok) {
            await this.loadTrajectoryIndex();
            this.selectTrajectory(newName.trim());
          } else {
            const err = await response.text();
            alert('Rename failed: ' + err);
          }
        } catch(e) {
          console.error(e);
          alert('Rename failed: ' + e.message);
        }
      }
    });

    this.elements['btn-delete-traj'].addEventListener('click', async () => {
      if (!this.selectedTraj) return;
      if (confirm('Are you sure you want to delete this trajectory?')) {
        try {
          const response = await fetch('/api/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: this.selectedTraj })
          });
          if (response.ok) {
            await this.loadTrajectoryIndex();
            // Select the first available trajectory if any exist
            if (this.trajectories.length > 0) {
              this.selectTrajectory(this.trajectories[0].id);
            } else {
              this.selectedTraj = null;
              this.activeTraj = null;
              this.elements['trajectory-list'].value = "";
              this.elements['trajectory-list'].innerHTML = '<option value="" disabled selected>No trajectories available</option>';
              this.viewer.drawTrajectoryPath([]);
            }
          } else {
            const err = await response.text();
            alert('Delete failed: ' + err);
          }
        } catch(e) {
          console.error(e);
          alert('Delete failed: ' + e.message);
        }
      }
    });

    this.elements['btn-cancel-edit'].addEventListener('click', () => {
      this.setEditMode(false);
    });

    this.elements['btn-recalculate'].addEventListener('click', () => {
      this.recalculateTrajectory();
    });


    // Segmented Mode Switcher
    const modeButtons = document.querySelectorAll('.mode-switch-container .mode-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        modeButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.switchMode(e.target.dataset.mode);
      });
    });

    // CSV configuration listeners
    this.elements['csv-robot-select'].addEventListener('change', () => {
      this.reloadCSVTrajectory();
    });

    this.elements['csv-timing-mode'].addEventListener('change', (e) => {
      const val = parseFloat(this.elements['csv-timing-val'].value);
      if (!isNaN(val) && val > 0) {
        const converted = 1.0 / val;
        this.elements['csv-timing-val'].value = Number(converted.toFixed(5)).toString();
      }
      this.reloadCSVTrajectory();
    });

    this.elements['csv-timing-val'].addEventListener('input', () => {
      this.reloadCSVTrajectory();
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
          this.chart.update(this.activeTraj, this.activeTab, this.activeRepr);
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
      const response = await fetch(`trajectories.json?v=${Date.now()}`);
      this.trajectories = await response.json();
      this.applyFilters();
    } catch (e) {
      console.error("Error loading index:", e);
    } finally {
      this.hideLoader();
    }
  }

  startIndexPolling() {
    setInterval(async () => {
      try {
        const response = await fetch(`trajectories.json?v=${Date.now()}`);
        if (!response.ok) return;
        const newTrajectories = await response.json();
        
        // Check if there is any difference in content
        if (this.checkIndexDifference(this.trajectories, newTrajectories)) {
          console.log("Trajectories database changed, reloading sidebar...");
          this.trajectories = newTrajectories;
          this.applyFilters();
          
          // Fallback selection if active is lost or none selected
          if (this.filteredTrajectories.length > 0 && (!this.selectedTraj || !this.trajectories.some(t => t.id === this.selectedTraj))) {
            this.selectTrajectory(this.filteredTrajectories[0].id);
          }
        }
      } catch (e) {
        // Ignore silent polling network errors
      }
    }, 1000);
  }

  checkIndexDifference(arr1, arr2) {
    if (!arr1 || !arr2 || arr1.length !== arr2.length) return true;
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i].id !== arr2[i].id || 
          arr1[i].duration !== arr2[i].duration ||
          arr1[i].status !== arr2[i].status ||
          arr1[i].model !== arr2[i].model ||
          arr1[i].format !== arr2[i].format) {
        return true;
      }
    }
    return false;
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
      
      const shortId = t.id.length > 33 ? `${t.id.slice(0, 15)}...${t.id.slice(-15)}` : t.id;
      const statusColor = t.status === 70 ? 'var(--success-color)' : t.status === 40 ? 'var(--danger-color)' : 'var(--warning-color)';
      const statusLabel = t.status === 70 ? 'Planned' : t.status === 40 ? 'Collided' : 'Timeout';
      
      li.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; margin-right: 8px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background-color: ${statusColor}; box-shadow: 0 0 4px ${statusColor};" title="${statusLabel}"></div>
          <span class="item-id monospace" style="font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${shortId}</span>
        </div>
        <span style="font-size: 0.7rem; color: var(--text-muted); flex-shrink: 0;">${t.duration.toFixed(2)}s</span>
      `;
      
      li.addEventListener('click', () => this.selectTrajectory(t.id));
      list.appendChild(li);
    });
    
    if (window.lucide) {
      window.lucide.createIcons({ attrs: { class: 'meta-group-icon' } });
    }
  }

  updateSidebarStats() {
    const searchVal = this.elements['search-input'] ? this.elements['search-input'].value.toLowerCase() : '';
    
    // Count based on active mode (format) and search query
    const modeTrajectories = this.trajectories.filter(t => {
      const matchesMode = t.format === this.activeMode;
      const matchesSearch = t.id.toLowerCase().includes(searchVal);
      return matchesMode && matchesSearch;
    });
    
    const totalCount = modeTrajectories.length;
    const successCount = modeTrajectories.filter(t => t.status === 70).length;
    const failCount = totalCount - successCount;
    
    const btnAll = document.getElementById('filter-status-all');
    const btnSuccess = document.getElementById('filter-status-success');
    const btnFail = document.getElementById('filter-status-fail');
    
    if (btnAll) btnAll.innerText = `All (${totalCount})`;
    if (btnSuccess) btnSuccess.innerText = `Success (${successCount})`;
    if (btnFail) btnFail.innerText = `Failed (${failCount})`;
  }

  applyFilters() {
    const searchVal = this.elements['search-input'].value.toLowerCase();
    
    // Status filter
    const activeStatusBtn = document.querySelector('#status-filters .badge-btn.active');
    const statusVal = activeStatusBtn ? activeStatusBtn.dataset.val : 'all'; // 'all', '70', 'fail'
    
    // Recalculate CSV durations globally before filtering
    let dt = 0.01;
    if (this.globalCSVTimingMode === 'hz') {
      dt = 1.0 / this.globalCSVTimingVal;
    } else {
      dt = this.globalCSVTimingVal;
    }
    this.trajectories.forEach(t => {
      if (t.format === 'csv') {
        const rows = t.num_rows || 0;
        t.duration = rows * dt;
      }
    });

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
      
      // 3. Format/Mode filter
      const matchesMode = t.format === this.activeMode;
      
      return matchesSearch && matchesStatus && matchesMode;
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
      
      const reprUrl = `Trajectories/${format}/${id}.repr?v=${Date.now()}`;
      const fileUrl = `Trajectories/${format}/${id}.${format}?v=${Date.now()}`;
      
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
        this.rawCSVText = csvText;
        
        // Toggle panels
        this.elements['scale-tools-panel'].classList.add('hidden');
        this.elements['scene-csv-controls'].classList.remove('hidden');
        this.elements['scene-model-text'].classList.add('hidden');
        
        // Apply global configuration values to inputs
        this.elements['csv-robot-select'].value = this.globalCSVRobot;
        this.elements['csv-timing-mode'].value = this.globalCSVTimingMode;
        this.elements['csv-timing-val'].value = this.globalCSVTimingVal;
        
        let dt = 0.01;
        if (this.globalCSVTimingMode === 'hz') {
          dt = 1.0 / this.globalCSVTimingVal;
        } else {
          dt = this.globalCSVTimingVal;
        }
        
        trajData = parseCSV(csvText, dt);
        if (!reprData) {
          if (this.globalCSVRobot === 'dobot-cr30h') {
            reprData = createDobotCR30hRepr(id);
          } else {
            reprData = createDobotCR20ARepr(id);
          }
        }
      } else if (format === 'mcap') {
        this.rawCSVText = null;
        this.elements['scale-tools-panel'].classList.add('hidden');
        this.elements['scene-csv-controls'].classList.add('hidden');
        this.elements['scene-model-text'].classList.remove('hidden');
        
        const trajJson = await fileResponse.json();
        trajData = parseTraj(trajJson);
      } else {
        this.rawCSVText = null;
        this.elements['scale-tools-panel'].classList.remove('hidden');
        this.elements['scene-csv-controls'].classList.add('hidden');
        this.elements['scene-model-text'].classList.remove('hidden');
        
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
      this.chart.update(this.activeTraj, this.activeTab, this.activeRepr);
      
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
    this.chart.update(this.activeTraj, this.activeTab, this.activeRepr);
    
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
    this.viewer.updatePose(linkTransforms, state.q, state.v);
    
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
    
    this.elements['tcp-x'].innerText = T_flange_base[3].toFixed(3);
    this.elements['tcp-y'].innerText = T_flange_base[7].toFixed(3);
    this.elements['tcp-z'].innerText = T_flange_base[11].toFixed(3);
    
    // 6. Update vertical line cursor in graphs
    this.chart.setCursor(t);
  }

  getRobotSpeedLimits(modelName) {
    const name = (modelName || '').toLowerCase();
    if (name.includes('cr20a') || name.includes('cr20')) {
      // CR20A J1-J2: 120°/s, J3: 150°/s, J4-J6: 180°/s
      return [
        120 * Math.PI / 180,
        120 * Math.PI / 180,
        150 * Math.PI / 180,
        180 * Math.PI / 180,
        180 * Math.PI / 180,
        180 * Math.PI / 180
      ];
    } else if (name.includes('cr30') || name.includes('dobot')) {
      // CR30H J1-J2: 150°/s, J3: 200°/s, J4-J6: 300°/s
      return [
        150 * Math.PI / 180,
        150 * Math.PI / 180,
        200 * Math.PI / 180,
        300 * Math.PI / 180,
        300 * Math.PI / 180,
        300 * Math.PI / 180
      ];
    } else if (name.includes('aubo-is25') || name.includes('is25')) {
      // Aubo iS25 standard velocity limits
      return [
        150 * Math.PI / 180,
        150 * Math.PI / 180,
        150 * Math.PI / 180,
        180 * Math.PI / 180,
        180 * Math.PI / 180,
        180 * Math.PI / 180
      ];
    } else {
      // Standard default collaborative robot speed limits: 150°/s
      return Array(6).fill(150 * Math.PI / 180);
    }
  }

  updateJointTableUI(state, dh) {
    const limits = this.activeRepr.equipment_model.range_limits || [];
    const modelName = this.activeRepr.equipment_model.model_name || "generic";
    const speedLimits = this.getRobotSpeedLimits(modelName);
    
    for (let j = 0; j < 6; j++) {
      const qVal = state.q[j];
      const qDeg = (qVal * 180 / Math.PI).toFixed(1);
      
      const vVal = state.v[j];
      const vDeg = (vVal * 180 / Math.PI).toFixed(1);
      
      const aVal = state.a[j];
      
      const row = document.getElementById(`joint-row-${j+1}`);
      if (!row) continue;
      
      const valCell = row.querySelector('.val-cell');
      const velCell = row.querySelector('.vel-cell');
      const accelCell = row.querySelector('.accel-cell');
      
      // 1. Position limit checking & visualization
      const limit = limits.find(l => l.joint_id === j);
      let isPosExceeded = false;
      let posMinDeg = -180;
      let posMaxDeg = 180;
      let posPct = 50;
      
      if (limit) {
        posMinDeg = Math.round(limit.min_value * 180 / Math.PI);
        posMaxDeg = Math.round(limit.max_value * 180 / Math.PI);
        if (qVal < limit.min_value || qVal > limit.max_value) {
          isPosExceeded = true;
        }
        posPct = ((qVal - limit.min_value) / (limit.max_value - limit.min_value)) * 100;
        posPct = Math.max(0, Math.min(100, posPct));
      }
      
      const posExceededClass = isPosExceeded ? 'exceeded' : '';
      const posColorStyle = isPosExceeded ? 'color: var(--danger-color);' : '';
      
      valCell.innerHTML = `
        <div class="limit-container">
          <span class="limit-min">${posMinDeg}°</span>
          <div class="limit-track-wrapper">
            <span class="current-value" style="${posColorStyle}">${qDeg}°</span>
            <div class="limit-track">
              <div class="limit-marker ${posExceededClass}" style="left: ${posPct}%;"></div>
            </div>
          </div>
          <span class="limit-max">${posMaxDeg}°</span>
        </div>
      `;
      
      // 2. Velocity limit checking & visualization
      const maxSpeed = speedLimits[j];
      const minSpeed = -maxSpeed;
      const speedMinDeg = Math.round(minSpeed * 180 / Math.PI);
      const speedMaxDeg = Math.round(maxSpeed * 180 / Math.PI);
      
      let isVelExceeded = false;
      if (Math.abs(vVal) > maxSpeed) {
        isVelExceeded = true;
      }
      
      let velPct = ((vVal - minSpeed) / (maxSpeed - minSpeed)) * 100;
      velPct = Math.max(0, Math.min(100, velPct));
      
      const velExceededClass = isVelExceeded ? 'exceeded' : '';
      const velColorStyle = isVelExceeded ? 'color: var(--danger-color);' : '';
      
      velCell.innerHTML = `
        <div class="limit-container">
          <span class="limit-min">${speedMinDeg}°/s</span>
          <div class="limit-track-wrapper">
            <span class="current-value" style="${velColorStyle}">${vDeg}°/s</span>
            <div class="limit-track">
              <div class="limit-marker ${velExceededClass}" style="left: ${velPct}%;"></div>
            </div>
          </div>
          <span class="limit-max">${speedMaxDeg}°/s</span>
        </div>
      `;
      
      // 3. Acceleration display
      accelCell.innerText = aVal.toFixed(2);
    }
  }

  switchMode(mode) {
    if (this.activeMode === mode) return;
    this.activeMode = mode;
    
    // Stop playback
    this.isPlaying = false;
    this.updatePlayPauseButtonUI();

    // Toggle panels visibility based on mode
    if (mode === 'csv') {
      this.elements['scale-tools-panel'].classList.add('hidden');
      this.elements['scene-csv-controls'].classList.remove('hidden');
      this.elements['scene-model-text'].classList.add('hidden');
    } else if (mode === 'traj') {
      this.elements['scale-tools-panel'].classList.remove('hidden');
      this.elements['scene-csv-controls'].classList.add('hidden');
      this.elements['scene-model-text'].classList.remove('hidden');
    } else { // mcap
      this.elements['scale-tools-panel'].classList.add('hidden');
      this.elements['scene-csv-controls'].classList.add('hidden');
      this.elements['scene-model-text'].classList.remove('hidden');
    }

    // Update active state class on mode buttons
    const modeButtons = document.querySelectorAll('.mode-switch-container .mode-btn');
    modeButtons.forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Re-apply filters which will filter files in list based on mode
    this.applyFilters();

    // Select the first trajectory in the new filtered list if available
    if (this.filteredTrajectories.length > 0) {
      this.selectTrajectory(this.filteredTrajectories[0].id);
    } else {
      // Clear visualizer and chart
      this.activeTraj = null;
      this.activeRepr = null;
      this.selectedTraj = null;
      this.viewer.drawTrajectoryPath([]);
      this.chart.clear();
      // Clear current trajectory stats
      this.elements['active-trajectory-id'].innerText = 'None';
      this.elements['meta-robot-model'].innerText = '--';
      this.elements['meta-parts'].innerText = '--';
      this.elements['meta-interpolation'].innerText = '--';
      this.elements['time-current'].innerText = '0.00s';
      this.elements['time-total'].innerText = '0.00s';
      this.elements['timeline-slider'].value = 0;
      this.elements['timeline-slider'].disabled = true;
      this.elements['timeline-progress-bar'].style.width = '0%';
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

  reloadCSVTrajectory() {
    const robotModel = this.elements['csv-robot-select'].value;
    const timingMode = this.elements['csv-timing-mode'].value;
    const timingVal = parseFloat(this.elements['csv-timing-val'].value);

    if (isNaN(timingVal) || timingVal <= 0) {
      return; // Do nothing for invalid inputs
    }

    // Update global variables
    this.globalCSVRobot = robotModel;
    this.globalCSVTimingMode = timingMode;
    this.globalCSVTimingVal = timingVal;

    // Recalculate durations and redraw left panel sidebar list
    this.applyFilters();

    // If active trajectory is CSV, recompute kinematics, paths, and graphs
    if (this.selectedTraj) {
      const activeMeta = this.trajectories.find(t => t.id === this.selectedTraj);
      if (activeMeta && activeMeta.format === 'csv') {
        let dt = 0.01;
        if (timingMode === 'hz') {
          dt = 1.0 / timingVal;
        } else {
          dt = timingVal;
        }

        try {
          if (this.rawCSVText) {
            // Re-parse CSV with new dt
            this.originalTraj = parseCSV(this.rawCSVText, dt);
            this.activeTraj = JSON.parse(JSON.stringify(this.originalTraj));

            // Re-create representation with selected global model
            let reprData = null;
            if (robotModel === 'dobot-cr30h') {
              reprData = createDobotCR30hRepr(this.selectedTraj);
            } else {
              reprData = createDobotCR20ARepr(this.selectedTraj);
            }
            this.activeRepr = reprData;

            // Reset playback scaling if any
            this.elements['time-scale-slider'].value = 0;
            this.elements['time-scale-val'].innerText = '0%';

            // Rebuild UI and 3D scene
            this.updateActiveMetadata();
            this.viewer.buildRobot(this.activeRepr);
            this.viewer.buildSceneObstacles(this.activeRepr);

            // Recompute duration
            const duration = activeMeta.duration;
            this.totalDuration = duration;

            this.elements['timeline-slider'].value = 0;
            this.elements['timeline-slider'].disabled = (duration === 0);
            this.elements['time-total'].innerText = `${duration.toFixed(2)}s`;

            if (this.activeTraj.status === 70 && duration > 0) {
              this.computeAndDraw3dPath();
            } else {
              this.viewer.drawTrajectoryPath([]);
            }

            this.chart.update(this.activeTraj, this.activeTab, this.activeRepr);

            // Clamp current playback time to new duration
            if (this.currentTime > this.totalDuration) {
              this.currentTime = this.totalDuration;
            }
            this.updatePlaybackState(this.currentTime);
          }
        } catch (err) {
          console.error("Error reloading active CSV configuration:", err);
        }
      }
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

  setEditMode(isEdit) {
    if (isEdit) {
      this.stopReset();
      this.elements['view-mode-panels'].classList.add('hidden');
      this.elements['edit-mode-panels'].classList.remove('hidden');
      if (this.viewer.setEditMode) {
        this.viewer.setEditMode(true);
      }
    } else {
      this.elements['edit-mode-panels'].classList.add('hidden');
      this.elements['view-mode-panels'].classList.remove('hidden');
      if (this.viewer.setEditMode) {
        this.viewer.setEditMode(false);
      }
    }
  }

  async recalculateTrajectory(points = null, joint_path = null) {
    const limitTcp = parseFloat(this.elements['limit-tcp-speed'].value);
    const limitCentripetal = parseFloat(this.elements['limit-centripetal'].value);
    
    if (!points) {
      if (this.viewer.getEditedControlPoints) {
        points = this.viewer.getEditedControlPoints();
      } else {
        points = [];
      }
    }
    
    this.elements['btn-recalculate'].disabled = true;
    this.elements['btn-recalculate'].innerHTML = '<div class="spinner" style="width: 14px; height: 14px; display: inline-block; border-width: 2px;"></div> Recalculating...';
    
    try {
      const response = await fetch('/api/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: this.selectedTraj,
          tcp_limit: limitTcp,
          centripetal_limit: limitCentripetal,
          control_points: points,
          joint_path: joint_path,
          base_pos: this.activeRepr.equipment_model.position || [0,0,0],
          base_quat: this.activeRepr.equipment_model.quaternion || [1,0,0,0],
          dh: this.activeRepr.equipment_model.dh_parameters
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        this.setEditMode(false);
        if (result.new_id) {
           await this.loadTrajectoryIndex();
           this.selectTrajectory(result.new_id);
        } else {
           await this.loadTrajectoryIndex();
           this.selectTrajectory(this.selectedTraj);
        }
      } else {
        const errText = await response.text();
        throw new Error('Server returned ' + response.status + ': ' + errText);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to recalculate: ' + err.message);
    } finally {
      this.elements['btn-recalculate'].disabled = false;
      this.elements['btn-recalculate'].innerHTML = '<i data-lucide="refresh-cw" style="width: 16px; height: 16px;"></i> Recalculate Trajectory';
      if (window.lucide) window.lucide.createIcons();
    }
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
      position: [0.0, 0.0, 1.0],
      quaternion: [0.7071, 0.0, 0.0, -0.7071],
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
            position: [0.375, 0, 0],
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
            position: [0.75, 0, 0],
            quaternion: [1, 0, 0, 0],
            radius: 0.11
          }
        },
        // Link 3 (Forearm)
        {
          link: 3,
          shape: {
            shape_type: "capsule",
            position: [0.35, 0, 0],
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
            position: [0.70, 0, 0],
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

// Helper to construct fallback .repr for Dobot CR30H
function createDobotCR30hRepr(id) {
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
      model_name: "dobot-cr30h",
      position: [0.0, 0.0, 1.0],
      quaternion: [0.7071, 0.0, 0.0, -0.7071],
      hitbox: [
        {
          link: 1,
          shape: {
            shape_type: "capsule",
            position: [0.0, -0.09, 0.0],
            quaternion: [0.7071, -0.7071, 0.0, 0.0],
            radius: 0.115,
            height: 0.08
          }
        },
        {
          link: 1,
          shape: {
            shape_type: "capsule",
            position: [0.0, 0.0, 0.09],
            quaternion: [1.0, 0.0, 0.0, 0.0],
            radius: 0.115,
            height: 0.08
          }
        },
        {
          link: 2,
          shape: {
            shape_type: "capsule",
            position: [0.005, 0.0, 0.27],
            quaternion: [1.0, 0.0, 0.0, 0.0],
            radius: 0.1,
            height: 0.105
          }
        },
        {
          link: 2,
          shape: {
            shape_type: "capsule",
            position: [0.43, 0.0, 0.378],
            quaternion: [0.7071, 0, 0.7071, 0],
            radius: 0.1,
            height: 0.77
          }
        },
        {
          link: 2,
          shape: {
            shape_type: "capsule",
            position: [0.84, 0.0, 0.27],
            quaternion: [1.0, 0.0, 0.0, 0.0],
            radius: 0.115,
            height: 0.115
          }
        },
        {
          link: 3,
          shape: {
            shape_type: "capsule",
            position: [0.0, 0.0, 0.12],
            quaternion: [1.0, 0.0, 0.0, 0.0],
            radius: 0.065,
            height: 0.12
          }
        },
        {
          link: 3,
          shape: {
            shape_type: "capsule",
            position: [0.36, 0.0, 0.057],
            quaternion: [0.7071, 0, 0.7071, 0],
            radius: 0.07,
            height: 0.6
          }
        },
        {
          link: 3,
          shape: {
            shape_type: "sphere",
            position: [0.73, 0.0, 0.09],
            quaternion: [1.0, 0.0, 0.0, 0.0],
            radius: 0.1
          }
        },
        {
          link: 4,
          shape: {
            shape_type: "capsule",
            position: [0.0, 0.0, 0.07],
            quaternion: [1.0, 0.0, 0.0, 0.0],
            radius: 0.065,
            height: 0.14
          }
        },
        {
          link: 5,
          shape: {
            shape_type: "capsule",
            position: [0.0, 0.0, 0.03],
            quaternion: [1.0, 0.0, 0.0, 0.0],
            radius: 0.06,
            height: 0.06
          }
        },
        {
          link: 6,
          shape: {
            shape_type: "box",
            position: [0.0, 0.0, 0.158],
            quaternion: [0.9239, 0.0, 0.0, -0.3827],
            extents: [0.13, 0.18, 0.05]
          }
        },
        {
          link: 6,
          shape: {
            shape_type: "sphere",
            position: [0.0, 0.0, -0.01],
            quaternion: [1.0, 0.0, 0.0, 0.0],
            radius: 0.065
          }
        }
      ],
      rigid_bodies: [],
      dh_parameters: {
        a: [0.0, -0.84, -0.74, 0.0, 0.0, 0.0],
        d: [0.386, 0.0, 0.0, 0.275, 0.22, 0.211],
        alpha: [1.57079637, 0.0, 0.0, 1.57079637, -1.57079637, 0.0],
        theta: [-1.57079637, -1.57079637, 0.0, -1.57079637, 0.0, 0.0],
        joint_type: ["Revolute", "Revolute", "Revolute", "Revolute", "Revolute", "Revolute"]
      },
      range_limits: [
        { type: "Static", joint_id: 0, min_value: -1.5359, max_value: 4.5728 },
        { type: "Static", joint_id: 1, min_value: -6.2832, max_value: 6.2832 },
        { type: "Static", joint_id: 2, min_value: -2.7751, max_value: 2.7751 },
        { type: "Static", joint_id: 3, min_value: -6.2832, max_value: 6.2832 },
        { type: "Static", joint_id: 4, min_value: -6.2832, max_value: 6.2832 },
        { type: "Static", joint_id: 5, min_value: -3.3161, max_value: 3.3161 }
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
