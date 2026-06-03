/**
 * dobot_cr20a.js
 * Visual configuration class for Dobot CR20A.
 */
import { BaseRobot } from './base.js';

export class DobotCR20A extends BaseRobot {
  constructor() {
    super();
    this.modelName = "dobot-cr20a";
    this.pedestalRadius = 0.15;
    this.columnRadius = 0.12;
    // Tapered radii and heights for joint connector rings 1..6
    this.jointRingRadii = [0.13, 0.13, 0.095, 0.095, 0.075, 0.075];
    this.jointRingHeights = [0.13, 0.13, 0.10, 0.10, 0.08, 0.08];
  }
}
