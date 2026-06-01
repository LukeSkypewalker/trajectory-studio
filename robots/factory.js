/**
 * factory.js
 * Factory to retrieve the correct robot configuration instance by model name.
 */
import { BaseRobot } from './base.js';
import { DobotCR30h } from './dobot.js';
import { AuboIS20 } from './aubo.js';

export function getRobotConfig(modelName) {
  const name = (modelName || '').toLowerCase();
  if (name.includes('dobot')) {
    return new DobotCR30h();
  } else if (name.includes('aubo')) {
    return new AuboIS20();
  }
  return new BaseRobot(); // Fallback
}
