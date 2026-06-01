/**
 * aubo.js
 * Visual configuration class for Aubo iS20.
 */
import { BaseRobot } from './base.js';

export class AuboIS20 extends BaseRobot {
  constructor() {
    super();
    this.modelName = "aubo-is20_arcs";
    this.pedestalRadius = 0.14;
    this.columnRadius = 0.11;
    // Aubo iS20 is wider at base joints, tapering down to the wrist
    this.jointRingRadii = [0.115, 0.115, 0.085, 0.085, 0.065, 0.065];
    this.jointRingHeights = [0.11, 0.11, 0.09, 0.09, 0.075, 0.075];
  }
}
