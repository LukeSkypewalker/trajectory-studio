/**
 * factory.js
 * Factory to retrieve the correct robot configuration instance by model name.
 */
import { BaseRobot } from './base.js';
import { DobotCR30h } from './dobot.js';
import { AuboIS20 } from './aubo.js';
import { AuboIS25 } from './aubo_is25.js';

export function getRobotConfig(modelName) {
  const name = (modelName || '').toLowerCase();
  if (name.includes('dobot')) {
    return new DobotCR30h();
  } else if (name.includes('aubo-is25') || name.includes('is25')) {
    return new AuboIS25();
  } else if (name.includes('aubo-is20') || name.includes('is20') || name.includes('aubo')) {
    return new AuboIS20();
  }
  return new BaseRobot(); // Fallback
}
