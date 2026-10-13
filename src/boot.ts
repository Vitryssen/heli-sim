import './style.css';
import { loadHeliAsset } from './render/heliAsset';

// the AH-6 model (~0.4 MB) loads before the game starts; if it can't, the game uses the built-in one
loadHeliAsset()
  .catch(e => console.warn('Helicopter model failed to load; using the built-in one.', e))
  .finally(() => void import('./main'));
