/**
 * charts.js
 * Joint graphs management using Chart.js.
 */

import { evaluateSpline } from './robot.js?v=36';

// Custom plugin to draw a vertical timeline cursor line
const verticalCursorPlugin = {
  id: 'verticalCursor',
  afterDraw: (chart) => {
    const cursorOpts = chart.options.plugins.verticalCursor;
    if (cursorOpts && cursorOpts.timeVal !== null) {
      const timeVal = cursorOpts.timeVal;
      const ctx = chart.ctx;
      const xAxis = chart.scales.x;
      const yAxis = chart.scales.y;
      
      if (timeVal >= xAxis.min && timeVal <= xAxis.max) {
        const xPixel = xAxis.getPixelForValue(timeVal);
        
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = '#22d3ee'; // Bright Cyan cursor
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]); // Dashed line
        
        // Draw line
        ctx.moveTo(xPixel, yAxis.top);
        ctx.lineTo(xPixel, yAxis.bottom);
        ctx.stroke();
        
        // Draw small handle circle at top
        ctx.beginPath();
        ctx.arc(xPixel, yAxis.top, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#22d3ee';
        ctx.fill();
        
        ctx.restore();
      }
    }
  }
};

// Custom plugin to align the play slider with the chart's vertical grid edges
const alignSliderPlugin = {
  id: 'alignSlider',
  afterLayout: (chart) => {
    if (!chart.chartArea) return;
    const left = chart.chartArea.left;
    const right = chart.width - chart.chartArea.right;
    const bottom = chart.chartArea.bottom;
    
    const sliderWrapper = document.getElementById('timeline-slider-wrapper');
    if (sliderWrapper) {
      sliderWrapper.style.left = `${left}px`;
      sliderWrapper.style.right = `${right}px`;
      sliderWrapper.style.top = `${bottom - 9}px`; // Center directly on bottom x-axis line
    }

    const controlsRow = document.getElementById('timeline-controls-row');
    if (controlsRow) {
      controlsRow.style.left = `${left}px`;
      controlsRow.style.right = `${right}px`;
    }
  }
};

// Register custom plugins
Chart.register(verticalCursorPlugin, alignSliderPlugin);

export class TrajectoryChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.chart = null;
    
    // Consistent color coding for joints J1..J6
    this.jointColors = [
      '#a855f7', // J1 Purple
      '#3b82f6', // J2 Blue
      '#14b8a6', // J3 Teal
      '#22c55e', // J4 Green
      '#f59e0b', // J5 Amber
      '#f43f5e'  // J6 Rose
    ];
    
    this.currentMetric = 'position'; // Default
    this.activeTrajData = null;
    this.cursorTime = 0.0;
    
    this.init();
  }
  
  init() {
    const ctx = this.canvas.getContext('2d');
    
    // Create empty chart initially
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Turn off transitions for raw speed
        elements: {
          point: { radius: 0 }, // Hide points, only show lines
          line: { borderDelta: 0, tension: 0.1, borderWidth: 1.8 }
        },
        layout: {
          padding: {
            left: 10,
            right: 15,
            top: 15,
            bottom: 90
          }
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: false
            },
            grid: { color: 'rgba(255, 255, 255, 0.03)' },
            ticks: { color: '#94a3b8', font: { size: 9 } }
          },
          y: {
            afterFit: (scale) => {
              scale.width = 60;
            },
            title: {
              display: true,
              text: 'Value',
              color: '#94a3b8',
              font: { size: 10, family: 'Inter' }
            },
            grid: { color: 'rgba(255, 255, 255, 0.03)' },
            ticks: { color: '#94a3b8', font: { size: 9 } }
          }
        },
        plugins: {
          legend: { display: false }, // Custom legend used in UI
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(10, 12, 22, 0.95)',
            titleColor: '#22d3ee',
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont: { family: 'Inter', size: 11 },
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.08)',
            callbacks: {
              title: (context) => `Time: ${context[0].parsed.x.toFixed(3)}s`
            }
          },
          verticalCursor: {
            timeVal: 0.0 // Value managed by app
          }
        }
      }
    });
  }
  
  /**
   * Evaluates the active trajectory splines and updates chart lines
   * @param {Object} trajData - Spline trajectory JSON data
   * @param {string} metric - 'position', 'velocity', 'acceleration', 'jerk'
   */
  update(trajData, metric = 'position') {
    this.activeTrajData = trajData;
    this.currentMetric = metric;
    
    if (!trajData) {
      this.clear();
      return;
    }
    
    // 1. Get trajectory duration
    let duration = 0.0;
    if (trajData.parts && trajData.parts.length > 0) {
      const lastPart = trajData.parts[trajData.parts.length - 1];
      const knots = lastPart.knots;
      if (knots && knots.length > 0) {
        duration = knots[knots.length - 1];
      }
    }
    
    // Fallback if it is a failed or static pose trajectory (duration = 0)
    if (duration === 0.0) {
      this.showStaticPlot(trajData, metric);
      return;
    }
    
    // 2. Generate points to evaluate (e.g., 200 samples)
    const samplesCount = 200;
    const timeSteps = [];
    for (let i = 0; i < samplesCount; i++) {
      timeSteps.push((duration * i) / (samplesCount - 1));
    }
    
    // Initialize 6 datasets
    const datasetsData = Array.from({ length: 6 }, () => []);
    
    // Evaluate spline for each time step
    timeSteps.forEach(t => {
      const state = evaluateSpline(trajData, t);
      // Retrieve the requested metric
      let vals = [];
      if (metric === 'position') vals = state.q;
      else if (metric === 'velocity') vals = state.v;
      else if (metric === 'acceleration') vals = state.a;
      else if (metric === 'jerk') vals = state.j;
      
      for (let j = 0; j < 6; j++) {
        datasetsData[j].push({ x: t, y: vals[j] });
      }
    });
    
    // 3. Update Chart.js datasets
    this.chart.data.datasets = datasetsData.map((dataPoints, jIdx) => {
      return {
        label: `Joint J${jIdx + 1}`,
        data: dataPoints,
        borderColor: this.jointColors[jIdx],
        backgroundColor: 'transparent',
        borderWidth: 1.8,
        pointRadius: 0,
        fill: false
      };
    });
    
    // Set labels and titles
    let yTitle = 'Position (rad)';
    if (metric === 'velocity') yTitle = 'Velocity (rad/s)';
    else if (metric === 'acceleration') yTitle = 'Acceleration (rad/s²)';
    else if (metric === 'jerk') yTitle = 'Jerk (rad/s³)';
    
    this.chart.options.scales.y.title.text = yTitle;
    this.chart.options.scales.x.max = duration;
    this.chart.options.scales.x.min = 0;
    
    this.chart.update('none'); // Update immediately without animation
  }
  
  /**
   * Show horizontal curves for static pose trajectories
   */
  showStaticPlot(trajData, metric) {
    const targetState = trajData.targetState || [0, 0, 0, 0, 0, 0];
    
    const datasetsData = Array.from({ length: 6 }, () => []);
    const timeSteps = [0.0, 1.0]; // Simple flat 0 to 1 seconds line
    
    timeSteps.forEach(t => {
      for (let j = 0; j < 6; j++) {
        let val = 0.0;
        if (metric === 'position') val = targetState[j];
        // Velocity, Acceleration, Jerk are zero for static states
        datasetsData[j].push({ x: t, y: val });
      }
    });
    
    this.chart.data.datasets = datasetsData.map((dataPoints, jIdx) => {
      return {
        label: `Joint J${jIdx + 1}`,
        data: dataPoints,
        borderColor: this.jointColors[jIdx],
        backgroundColor: 'transparent',
        borderWidth: 1.8,
        pointRadius: 0,
        fill: false
      };
    });
    
    this.chart.options.scales.x.max = 1.0;
    this.chart.options.scales.x.min = 0.0;
    this.chart.update('none');
  }
  
  /**
   * Sets the timeline cursor position on the graph
   * @param {number} timeVal - Playback time in seconds
   */
  setCursor(timeVal) {
    this.cursorTime = timeVal;
    if (this.chart && this.chart.options.plugins.verticalCursor) {
      this.chart.options.plugins.verticalCursor.timeVal = timeVal;
      this.chart.update('none'); // Update line quickly
    }
  }
  
  clear() {
    this.chart.data.datasets = [];
    this.chart.update('none');
  }
}
