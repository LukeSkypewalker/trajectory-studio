/**
 * dobot.js
 * Visual configuration class for Dobot CR30h.
 */
import { BaseRobot } from './base.js';

export class DobotCR30h extends BaseRobot {
  constructor() {
    super();
    this.modelName = "dobot-cr30h";
    this.pedestalRadius = 0.12;
    this.columnRadius = 0.10;
    this.jointRingRadii = [0.085, 0.085, 0.075, 0.075, 0.065, 0.065];
    this.jointRingHeights = [0.09, 0.09, 0.08, 0.08, 0.07, 0.07];
  }
}
