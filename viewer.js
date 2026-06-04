/**
 * viewer.js
 * 3D rendering workspace using Three.js.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { quatToMatrix } from './robot.js?v=36';
import { getRobotConfig } from './robots/factory.js?v=36';

export class TrajectoryViewer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.container = this.canvas.parentElement;
    
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    
    // Group references
    this.robotGroup = null;
    this.obstaclesGroup = null;
    this.trajectoryGroup = null;
    this.linkGroups = []; // Array of THREE.Group (0 to 6)
    
    // Trajectory visual components
    this.pathLine = null;
    this.pathTube = null;
    this.currentTcpMarker = null;
    this.trajectoryPoints = [];
    
    // Visibility toggles
    this.showGrid = true;
    this.showObstacles = true;
    this.xRayMode = false;
    
    // Materials
    this.robotMaterials = {
      solid: new THREE.MeshStandardMaterial({
        color: 0x94a3b8, // slate-400 (bright silver-grey)
        metalness: 0.8,
        roughness: 0.25,
        transparent: true,
        opacity: 0.9
      }),
      xray: new THREE.MeshStandardMaterial({
        color: 0x06b6d4, // cyan-500
        metalness: 0.1,
        roughness: 0.5,
        transparent: true,
        opacity: 0.35,
        wireframe: false
      }),
      joint: new THREE.MeshStandardMaterial({
        color: 0x64748b, // slate-500 (contrasting metallic joint rings)
        metalness: 0.9,
        roughness: 0.15
      })
    };
    
    this.obstacleMaterial = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // amber-500
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.6
    });

    this.init();
  }

  init() {
    // 1. Create Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070c);
    
    // 2. Camera
    // 2. Camera
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(
      45,
      width / height,
      0.1,
      100.0
    );
    this.camera.position.set(3.5, 3.5, 3.5); // Cinematic isometric angle
    this.camera.up.set(0, 0, 1); // Set Camera UP before OrbitControls
    
    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // 4. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05; // Ultra-smooth gliding damping
    this.controls.maxPolarAngle = Math.PI / 2 + 0.05; // Keep camera above floor
    this.controls.minDistance = 0.5;    // Keep camera from clipping inside robot
    this.controls.maxDistance = 15.0;   // Keep robot visible in center of workspace
    this.controls.target.set(0, 0, 1.2); // Target center of workspace
    
    // Normalize trackpad vs mousewheel zoom sensitivity by implementing custom zoom damping
    this.controls.enableZoom = false; // Disable OrbitControls broken zoom
    this.targetZoomDist = this.camera.position.distanceTo(this.controls.target);
    
    this.renderer.domElement.addEventListener('wheel', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation(); // Block any remaining OrbitControls zoom
      
      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= 100;
      
      // Calculate continuous logarithmic zoom target (100 delta = ~10% zoom)
      const zoomSensitivity = 0.0015;
      this.targetZoomDist *= Math.exp(delta * zoomSensitivity);
      this.targetZoomDist = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, this.targetZoomDist));
    }, { capture: true, passive: false });
    
    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);
    
    // Key directional light (casting shadows)
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(4, 5, 4);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048;
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.camera.near = 0.5;
    dirLight1.shadow.camera.far = 15;
    const d = 3;
    dirLight1.shadow.camera.left = -d;
    dirLight1.shadow.camera.right = d;
    dirLight1.shadow.camera.top = d;
    dirLight1.shadow.camera.bottom = -d;
    dirLight1.shadow.bias = -0.0005;
    this.scene.add(dirLight1);
    
    // Fill light (no shadows)
    const dirLight2 = new THREE.DirectionalLight(0x06b6d4, 0.3); // Muted blue fill
    dirLight2.position.set(-4, 3, -4);
    this.scene.add(dirLight2);
    
    // Subtle floor bounce light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x111222, 0.3);
    this.scene.add(hemiLight);
    
    // 6. Helpers
    this.gridHelper = new THREE.GridHelper(10, 50, 0x06b6d4, 0x222533);
    this.gridHelper.rotation.x = Math.PI / 2; // Make grid in XY plane instead of XZ?
    // Wait, in robotics, usually Z is UP, X is forward, Y is left.
    // Three.js by default has Y UP.
    // Let's set THREE.Object3D.DEFAULT_UP to Z-up, OR rotate our camera and grid!
    // Rotated grid is much cleaner and avoids breaking OrbitControls UP vector:
    // In our system, let's keep Three.js default Y-up, but map coordinates:
    // Robot Z-up -> Three.js Y-up
    // Robot X-forward -> Three.js Z-forward
    // Robot Y-left -> Three.js X-left
    // Wait, actually, it is much simpler to just set:
    // camera.up.set(0, 0, 1) and make OrbitControls work with Z-up!
    // Yes! Three.js supports Z-up natively if we set camera.up.set(0, 0, 1) before controls.
    this.controls.update();
    
    // Floor grid (in XY plane, Z = 0)
    const grid = new THREE.GridHelper(10, 40, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2; // grid is drawn in XZ plane by default. Rotated by 90deg, it lies in XY plane!
    grid.position.z = 0;
    this.scene.add(grid);
    
    // Floor plane to catch shadows
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.4 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    floor.position.z = -0.001; // Just below grid
    this.scene.add(floor);
    
    // Custom X (Red) and Y (Green) axes, 1m long, 0.005m radius
    const axesGroup = new THREE.Group();
    
    // X axis (Red) - rotated to lie along X, centered at x = 0.5
    const xAxisGeo = new THREE.CylinderGeometry(0.005, 0.005, 1.0, 8);
    xAxisGeo.rotateZ(-Math.PI / 2);
    const xAxisMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const xAxis = new THREE.Mesh(xAxisGeo, xAxisMat);
    xAxis.position.set(0.5, 0, 0.001); // offset Z slightly to avoid Z-fighting with grid
    axesGroup.add(xAxis);
    
    // Y axis (Green) - lying along Y, centered at y = 0.5
    const yAxisGeo = new THREE.CylinderGeometry(0.005, 0.005, 1.0, 8);
    const yAxisMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const yAxis = new THREE.Mesh(yAxisGeo, yAxisMat);
    yAxis.position.set(0, 0.5, 0.001); // offset Z slightly to avoid Z-fighting with grid
    axesGroup.add(yAxis);
    
    this.scene.add(axesGroup);
    
    // 7. Groups setup
    this.robotGroup = new THREE.Group();
    this.scene.add(this.robotGroup);
    
    this.obstaclesGroup = new THREE.Group();
    this.scene.add(this.obstaclesGroup);
    
    this.trajectoryGroup = new THREE.Group();
    this.scene.add(this.trajectoryGroup);
    
    // Create 7 link groups (0 = base, 1 to 6 = joints)
    for (let i = 0; i <= 6; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false; // We will update matrices manually via FK
      this.robotGroup.add(g);
      this.linkGroups.push(g);
    }
    
    // TCP Current position marker
    const markerGeo = new THREE.SphereGeometry(0.02, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    this.currentTcpMarker = new THREE.Mesh(markerGeo, markerMat);
    this.scene.add(this.currentTcpMarker);
 
    // 8. Resize Observer
    // Monitors the container dimensions directly, capturing the initial flex layout computations and any subsequent layout reflows.
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);
    
    this.animate();
  }
 
  onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    // Custom zoom damping
    if (this.targetZoomDist !== undefined && this.controls) {
      const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      const currentDist = offset.length();
      
      // Lerp current distance towards target distance
      if (Math.abs(currentDist - this.targetZoomDist) > 0.001) {
        const newDist = THREE.MathUtils.lerp(currentDist, this.targetZoomDist, 0.15); // 0.15 damping factor
        offset.normalize().multiplyScalar(newDist);
        this.camera.position.copy(this.controls.target).add(offset);
      }
    }
    
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Set visibility toggles
  setGridVisible(visible) {
    this.showGrid = visible;
    this.scene.traverse((child) => {
      if (child instanceof THREE.GridHelper) {
        child.visible = visible;
      }
    });
  }

  setRobotXRay(xRay) {
    this.xRayMode = xRay;
    const material = xRay ? this.robotMaterials.xray : this.robotMaterials.solid;
    
    this.linkGroups.forEach(group => {
      group.traverse(child => {
        if (child instanceof THREE.Mesh && child.name === 'hitbox') {
          child.material = material;
        }
      });
    });
  }

  setObstaclesVisible(visible) {
    this.showObstacles = visible;
    this.obstaclesGroup.visible = visible;
  }

  /**
   * Rebuilds the robot arm meshes using hitbox parameters from .repr file
   * @param {Object} reprData - The representation JSON data
   */
  buildRobot(reprData) {
    // 1. Clear existing meshes in link groups
    for (let i = 0; i <= 6; i++) {
      // Remove all children
      const group = this.linkGroups[i];
      while (group.children.length > 0) {
        group.remove(group.children[0]);
      }
      // Reset matrix to identity
      group.matrix.identity();
    }
    
    const equipment = reprData.equipment_model;
    if (!equipment) return;
    
    const pos = equipment.position || [0, 0, 0];
    const quat = equipment.quaternion || [1, 0, 0, 0];
    const dh = equipment.dh_parameters;
    const modelName = equipment.model_name || "generic";
    const config = getRobotConfig(modelName);
    
    // Keep robotGroup at identity, as transforms in linkTransforms already include the base transform.
    // Setting position/quaternion here would apply base transforms twice!
    this.robotGroup.position.set(0, 0, 0);
    this.robotGroup.quaternion.set(0, 0, 0, 1);
    
    // Draw base pedestal cylinder (from ground z=0 to z=1.2 base height)
    const baseCylGeo = new THREE.CylinderGeometry(config.pedestalRadius, config.pedestalRadius, pos[2], 32);
    baseCylGeo.rotateX(Math.PI / 2); // Make it align along Z axis
    const baseCyl = new THREE.Mesh(baseCylGeo, this.robotMaterials.joint);
    baseCyl.position.set(0, 0, -pos[2] / 2);
    baseCyl.receiveShadow = true;
    baseCyl.castShadow = true;
    this.linkGroups[0].add(baseCyl); // Attach to link index 0 (base)
    
    // Draw visual cylinder representing Link 1 column (height = d[0] = 0.386)
    if (dh && dh.d && dh.d[0]) {
      const colHeight = dh.d[0];
      const columnGeo = new THREE.CylinderGeometry(config.columnRadius, config.columnRadius, colHeight, 32);
      // In Link 1's DH frame, the shoulder column lies along the Y axis,
      // which matches Three.js CylinderGeometry's default alignment.
      const column = new THREE.Mesh(columnGeo, this.robotMaterials.solid);
      column.name = 'hitbox'; // So X-ray matches its material
      column.position.set(0, -colHeight / 2, 0);
      column.castShadow = true;
      column.receiveShadow = true;
      this.linkGroups[1].add(column);
    }

    // Build robot links from hitbox shapes
    const hitbox = equipment.hitbox || [];
    const material = this.xRayMode ? this.robotMaterials.xray : this.robotMaterials.solid;
    
    hitbox.forEach(item => {
      const linkId = item.link;
      const s = item.shape;
      if (linkId < 0 || linkId > 6) return;
      
      let geo = null;
      if (s.shape_type === 'box') {
        const ext = s.extents;
        // Box extents represent half-extents in physics representations.
        // In Three.js, BoxGeometry takes full size, so we multiply by 2.
        geo = new THREE.BoxGeometry(ext[0] * 2, ext[1] * 2, ext[2] * 2);
      } else if (s.shape_type === 'sphere') {
        geo = new THREE.SphereGeometry(s.radius, 32, 32);
      } else if (s.shape_type === 'capsule') {
        const r = s.radius;
        const totalHeight = s.height;
        // Three.js CapsuleGeometry(radius, length) -> total length is length + 2*radius
        // Bullet/Collision capsule height refers to total height.
        // So cylindrical part length = totalHeight - 2 * r
        const cylLength = Math.max(0.01, totalHeight - 2 * r);
        geo = new THREE.CapsuleGeometry(r, cylLength, 16, 32);
        
        // In collision representations, capsules are aligned along Z.
        // Three.js CapsuleGeometry is aligned along Y.
        // We rotate the geometry vertices by 90 degrees around X to align it with Z.
        geo.rotateX(Math.PI / 2);
      }
      
      if (geo) {
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = 'hitbox';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Apply shape offsets relative to link frame
        const sPos = s.position || [0, 0, 0];
        const sQuat = s.quaternion || [1, 0, 0, 0]; // [w,x,y,z]
        
        mesh.position.set(sPos[0], sPos[1], sPos[2]);
        mesh.quaternion.set(sQuat[1], sQuat[2], sQuat[3], sQuat[0]); // [x,y,z,w]
        
        this.linkGroups[linkId].add(mesh);
      }
    });

    // Add visual joint cylinders to show revolute axes
    if (dh) {
      this.jointIndicators = [];
      this.jointLimits = [];
      const limits = reprData.equipment_model.range_limits || [];
      const jointHexColors = [0xa855f7, 0x3b82f6, 0x14b8a6, 0x22c55e, 0xf59e0b, 0xf43f5e];
      
      // Render simple joint connector rings at the actual joint axes.
      // The axis of Joint i is the Z-axis of Link i-1.
      for (let i = 1; i <= 6; i++) {
        const j = i - 1;
        const r = config.jointRingRadii[j];
        const h = config.jointRingHeights[j];
        
        const ringGeo = new THREE.CylinderGeometry(r, r, h, 24);
        ringGeo.rotateX(Math.PI / 2);
        const ring = new THREE.Mesh(ringGeo, this.robotMaterials.joint);
        ring.name = 'joint-decor';
        this.linkGroups[j].add(ring);
        
        // Retrieve limits and speed limits for this joint
        const limit = limits.find(l => l.joint_id === j);
        const minVal = limit ? limit.min_value : -Math.PI;
        const maxVal = limit ? limit.max_value : Math.PI;
        const speedLimits = this.getRobotSpeedLimits(modelName);
        const maxSpeed = speedLimits[j];
        
        this.jointLimits.push({ min: minVal, max: maxVal, maxSpeed: maxSpeed });
        
        // Create dashed ring indicator around the joint cap
        const points = [];
        const segments = 64;
        const radius = r * 1.25;
        for (let sIdx = 0; sIdx <= segments; sIdx++) {
          const theta = (sIdx / segments) * Math.PI * 2;
          points.push(new THREE.Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius, 0));
        }
        const circleGeo = new THREE.BufferGeometry().setFromPoints(points);
        const jointColor = jointHexColors[j];
        const circleMat = new THREE.LineDashedMaterial({
          color: jointColor,
          dashSize: 0.015,
          gapSize: 0.01,
          linewidth: 2
        });
        const dashedCircle = new THREE.Line(circleGeo, circleMat);
        dashedCircle.computeLineDistances();
        dashedCircle.position.set(0, 0, h / 2 + 0.005);
        dashedCircle.visible = false; // Hidden by default
        
        this.linkGroups[j].add(dashedCircle);
        
        this.jointIndicators.push({
          dashedCircle: dashedCircle,
          jointColor: jointColor
        });
      }
    }
  }

  /**
   * Builds the static scene obstacles from .repr file
   * @param {Object} reprData - The representation JSON data
   */
  buildSceneObstacles(reprData) {
    // Clear old obstacles
    while (this.obstaclesGroup.children.length > 0) {
      this.obstaclesGroup.remove(this.obstaclesGroup.children[0]);
    }
    
    const shapes = reprData.scene?.shapes || [];
    const containerHtml = document.getElementById('scene-obstacle-list');
    if (containerHtml) containerHtml.innerHTML = '';
    
    if (shapes.length === 0) {
      if (containerHtml) containerHtml.innerHTML = '<div class="scene-item">No obstacle shapes</div>';
      return;
    }
    
    shapes.forEach((s, idx) => {
      let geo = null;
      if (s.shape_type === 'box') {
        const ext = s.extents;
        // Box extents represent half-extents in physics representations.
        // In Three.js, BoxGeometry takes full size, so we multiply by 2.
        geo = new THREE.BoxGeometry(ext[0] * 2, ext[1] * 2, ext[2] * 2);
      } else if (s.shape_type === 'sphere') {
        geo = new THREE.SphereGeometry(s.radius, 32, 32);
      }
      
      if (geo) {
        const mesh = new THREE.Mesh(geo, this.obstacleMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        const pos = s.position || [0, 0, 0];
        const quat = s.quaternion || [1, 0, 0, 0];
        
        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.quaternion.set(quat[1], quat[2], quat[3], quat[0]);
        
        this.obstaclesGroup.add(mesh);
        
        // Add to UI overlay list
        if (containerHtml) {
          const item = document.createElement('div');
          item.className = 'scene-item';
          const sizeStr = s.shape_type === 'box' 
            ? `${(s.extents[0] * 2).toFixed(3)}x${(s.extents[1] * 2).toFixed(3)}x${(s.extents[2] * 2).toFixed(3)}m`
            : `R=${s.radius}m`;
          item.innerHTML = `<span class="scene-item-dot"></span> <span>Obstacle ${idx+1} (${s.shape_type}: ${sizeStr})</span>`;
          containerHtml.appendChild(item);
        }
      }
    });
  }

  /**
   * Draws the entire TCP trajectory path curve in 3D
   * @param {Array<THREE.Vector3>} points - Position points of the TCP curve in world coordinates
   */
  drawTrajectoryPath(points) {
    // Clear old trajectory lines
    while (this.trajectoryGroup.children.length > 0) {
      this.trajectoryGroup.remove(this.trajectoryGroup.children[0]);
    }
    
    this.trajectoryPoints = points;
    if (points.length < 2) return;
    
    // Draw glowing tube
    const curve = new THREE.CatmullRomCurve3(points);
    // Cylinder tube geometry around trajectory path
    const tubeGeo = new THREE.TubeGeometry(curve, 100, 0.006, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4, // Cyan
      transparent: true,
      opacity: 0.6
    });
    this.pathTube = new THREE.Mesh(tubeGeo, tubeMat);
    this.trajectoryGroup.add(this.pathTube);

    // Draw solid thin path core
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      linewidth: 2
    });
    this.pathLine = new THREE.Line(lineGeo, lineMat);
    this.trajectoryGroup.add(this.pathLine);
  }

  /**
   * Updates the robot meshes to a set of link matrices
   * @param {Array<Array<number>>} linkTransforms - The computed 4x4 matrix transforms for links 0..6
   * @param {Array<number>} [q] - Active joint angles
   * @param {Array<number>} [v] - Active joint velocities
   */
  updatePose(linkTransforms, q, v) {
    // Helper to transpose 4x4 flat row-major matrix to column-major
    const toColumnMajor = (m) => {
      return [
        m[0], m[4], m[8],  m[12],
        m[1], m[5], m[9],  m[13],
        m[2], m[6], m[10], m[14],
        m[3], m[7], m[11], m[15]
      ];
    };

    // Update link groups matrices
    for (let i = 0; i <= 6; i++) {
      const transform = linkTransforms[i];
      if (transform && this.linkGroups[i]) {
        this.linkGroups[i].matrix.fromArray(toColumnMajor(transform));
      }
    }
    
    // Position of link 6 TCP marker
    if (linkTransforms[6]) {
      const t6 = linkTransforms[6];
      // Flange position (translation component of final 4x4 matrix)
      // Flat array indices for translation columns in row-major are 3 (x), 7 (y), 11 (z)
      const x = t6[3];
      const y = t6[7];
      const z = t6[11];
      this.currentTcpMarker.position.set(x, y, z);
    }

    // Update joint limits warning indicators visibility and color
    if (this.jointIndicators && this.jointLimits && q) {
      for (let j = 0; j < 6; j++) {
        const indicator = this.jointIndicators[j];
        const limitInfo = this.jointLimits[j];
        if (!indicator || !limitInfo) continue;

        const qVal = q[j];
        const vVal = v ? v[j] : 0;

        const minVal = limitInfo.min;
        const maxVal = limitInfo.max;
        const maxSpeed = limitInfo.maxSpeed;
        const range = maxVal - minVal;

        const isViolatingPos = (qVal < minVal || qVal > maxVal);
        const isViolatingVel = (Math.abs(vVal) > maxSpeed);
        const isViolation = isViolatingPos || isViolatingVel;

        const isWarningPos = (qVal - minVal <= 0.35) || (maxVal - qVal <= 0.35) || 
                              (qVal - minVal <= 0.15 * range) || (maxVal - qVal <= 0.15 * range);
        const isWarningVel = (Math.abs(vVal) >= 0.75 * maxSpeed);
        const isWarning = isWarningPos || isWarningVel;

        if (isViolation) {
          indicator.dashedCircle.visible = true;
          indicator.dashedCircle.material.color.setHex(0xef4444); // red
        } else if (isWarning) {
          indicator.dashedCircle.visible = true;
          indicator.dashedCircle.material.color.setHex(indicator.jointColor);
        } else {
          indicator.dashedCircle.visible = false;
        }
      }
    }
  }

  /**
   * Retrieves maximum velocity limits (radians/second) for each joint
   * @param {string} modelName - The model identifier
   * @returns {Array<number>} Joint velocity limits
   */
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

  /**
   * Highlights the active TCP marker in 3D scene
   * @param {THREE.Vector3} pos - Position of the current TCP in world space
   */
  updateTcpMarker(pos) {
    this.currentTcpMarker.position.copy(pos);
  }
}
