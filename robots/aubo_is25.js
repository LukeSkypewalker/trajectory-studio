/**
 * aubo_is25.js
 * Visual configuration class for Aubo iS25.
 */
import { BaseRobot } from './base.js';

export class AuboIS25 extends BaseRobot {
  constructor() {
    super();
    this.modelName = "aubo-is25";
    this.pedestalRadius = 0.15;
    this.columnRadius = 0.12;
    // Aubo iS25 is larger than iS20, tapering down to the wrist
    this.jointRingRadii = [0.13, 0.13, 0.095, 0.095, 0.075, 0.075];
    this.jointRingHeights = [0.13, 0.13, 0.10, 0.10, 0.08, 0.08];
  }
}
