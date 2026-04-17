/**
 * Provider barrel — importing this module triggers all provider self-registrations.
 * Import order matters: specific providers must be registered before the demo
 * catch-all so that their matchers take priority.
 */
export { providerRegistry } from './registry.js';

// Registration order: most specific → least specific
import './claude.js';
import './openai.js';
import './demo.js'; // catch-all, must be last
