/**
 * base.js
 * Base class for robot configuration and visual parameters.
 */
export class BaseRobot {
  constructor() {
    this.modelName = "generic";
    this.pedestalRadius = 0.12;
    this.columnRadius = 0.10;
    // Tapered radii and heights for visual joint connector rings 1..6
    this.jointRingRadii = [0.085, 0.085, 0.075, 0.075, 0.065, 0.065];
    this.jointRingHeights = [0.09, 0.09, 0.08, 0.08, 0.07, 0.07];
  }
}
