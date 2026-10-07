// The backdrop for argon's README art: a ShaderGradient (shadergradient.co) in Helium blues, full screen.
// URL options: mode=banner (adds the wordmark), t (moment in the animation), c1/c2/c3 (colors), b (brightness),
// grain=off, d (camera distance), s (wave strength).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react';

const p = new URLSearchParams(location.search);
const mode = p.get('mode') || 'plain';
const t = p.get('t') || '2.4';
// Helium blue (#3450d1) with a pale periwinkle and a deep navy.
const url = 'https://www.shadergradient.co/customize?' + new URLSearchParams({
  animate: 'off', axesHelper: 'off', brightness: p.get('b') || '1.05', cAzimuthAngle: '180', cDistance: p.get('d') || '3.4',
  cPolarAngle: '90', cameraZoom: '1', color1: p.get('c1') || '#3450d1', color2: p.get('c2') || '#8a9dff', color3: p.get('c3') || '#0b1450',
  destination: 'onCanvas', embedMode: 'off', envPreset: 'city', fov: '45', gizmoHelper: 'hide', grain: p.get('grain') || 'on', lightType: '3d',
  pixelDensity: '2', positionX: '-1.4', positionY: '0', positionZ: '0', range: 'disabled', rangeEnd: '40', rangeStart: '0',
  reflection: '0.1', rotationX: '0', rotationY: '10', rotationZ: '50', shader: 'defaults', type: p.get('type') || 'plane',
  uDensity: '1.3', uFrequency: '5.5', uSpeed: '0.4', uStrength: p.get('s') || '4', uTime: t, wireframe: 'false'
}).toString();

function App() {
  return (
    <>
      <ShaderGradientCanvas style={{ position: 'fixed', inset: 0 }} pixelDensity={2} fov={45} pointerEvents="none">
        <ShaderGradient control="query" urlString={url} />
      </ShaderGradientCanvas>
      {mode === 'banner' && (
        <div className="banner">
          <div className="mark">argon</div>
          <div className="tag">Ctrl+T, reimagined for Helium.</div>
          <div className="keys"><kbd>Ctrl</kbd><kbd>T</kbd></div>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById('root')).render(<App />);
