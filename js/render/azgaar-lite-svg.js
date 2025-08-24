// js/render/azgaar-lite-svg.js
// Minimal SVG renderer for Azgaar-Lite baseline generator
// Matches JSFiddle behavior: ocean mask, coastlines, shallow patterns

import { state } from '../state.js';

export function renderAzgaarLite(svg, world) {
  const ns = svg.namespaceURI;
  
  // defs + mask (ocean clipped by islands)
  let defs = svg.querySelector('defs'); 
  if (!defs){ 
    defs=document.createElementNS(ns,'defs'); 
    svg.appendChild(defs); 
  }
  
  let mask = defs.querySelector('#shape'); 
  if (!mask){
    mask = document.createElementNS(ns,'mask'); 
    mask.setAttribute('id','shape'); 
    defs.appendChild(mask);
    
    const rect = document.createElementNS(ns,'rect');
    rect.setAttribute('x','0'); 
    rect.setAttribute('y','0'); 
    rect.setAttribute('width','100%'); 
    rect.setAttribute('height','100%');
    rect.setAttribute('fill','white'); 
    mask.appendChild(rect);
    
    const holes = document.createElementNS(ns,'g'); 
    holes.setAttribute('id','mask-islands'); 
    mask.appendChild(holes);
    
    const hatch = document.createElementNS(ns,'pattern'); 
    hatch.setAttribute('id','shallowHatch');
    hatch.setAttribute('width','2'); 
    hatch.setAttribute('height','4'); 
    hatch.setAttribute('patternUnits','userSpaceOnUse');
    hatch.setAttribute('patternTransform','rotate(90 0 0)');
    
    const ln = document.createElementNS(ns,'line'); 
    ln.setAttribute('x1','0'); 
    ln.setAttribute('y1','0'); 
    ln.setAttribute('x2','0'); 
    ln.setAttribute('y2','4');
    ln.setAttribute('style','stroke:black;stroke-width:0.5;fill:black;'); 
    hatch.appendChild(ln); 
    defs.appendChild(hatch);
  }
  
  // layers
  const wipe = sel => { 
    const g = svg.querySelector(sel); 
    if (g) g.remove(); 
  };
  wipe('#ocean-bg'); 
  wipe('#world');
  
  const ocean = document.createElementNS(ns,'rect');
  ocean.setAttribute('id','ocean-bg'); 
  ocean.setAttribute('x','0'); 
  ocean.setAttribute('y','0');
  ocean.setAttribute('width','100%'); 
  ocean.setAttribute('height','100%');
  ocean.setAttribute('fill','#5E4FA2'); 
  if (state.drawMaskOcean) ocean.setAttribute('mask','url(#shape)');
  svg.appendChild(ocean);
  
  const worldG = document.createElementNS(ns,'g'); 
  worldG.setAttribute('id','world'); 
  svg.appendChild(worldG);
  
  const polysG = document.createElementNS(ns,'g'); 
  polysG.setAttribute('id','cells'); 
  worldG.appendChild(polysG);
  
  const coastG = document.createElementNS(ns,'g'); 
  coastG.setAttribute('id','coast'); 
  coastG.setAttribute('fill','none'); 
  coastG.setAttribute('stroke','black'); 
  coastG.setAttribute('stroke-width','0.6'); 
  worldG.appendChild(coastG);
  
  const shelfG = document.createElementNS(ns,'g'); 
  shelfG.setAttribute('id','shallow'); 
  shelfG.setAttribute('fill','url(#shallowHatch)'); 
  shelfG.setAttribute('opacity','0.8'); 
  worldG.appendChild(shelfG);

  // cells (land only, with spectral-ish colors like fiddle)
  const color = t => { // t in [0,1], crude spectral
    const h = (0.1 + 0.6 * (1-t)) * 360; 
    const s = 60; 
    const l = 50;
    return `hsl(${h.toFixed(0)},${s}%,${l}%)`;
  };
  
  for (let i=0;i<world.polygons.length;i++){
    if (!world.isLand[i]) continue;
    const P = world.polygons[i];
    const path = document.createElementNS(ns,'path');
    let d = `M ${P[0]} ${P[1]}`; 
    for (let p=2;p<P.length;p+=2) d += ` L ${P[p]} ${P[p+1]}`; 
    d += ' Z';
    path.setAttribute('d', d);
    path.setAttribute('fill', color(world.height[i]));
    path.setAttribute('stroke', color(world.height[i]));
    path.setAttribute('stroke-width', '0.2');
    polysG.appendChild(path);
  }

  // update mask holes for islands
  const holes = svg.querySelector('#mask-islands'); 
  while (holes.firstChild) holes.removeChild(holes.firstChild);
  
  for (const loop of world.coastLoops){
    const p = document.createElementNS(ns,'path');
    let d = `M ${loop[0][0]} ${loop[0][1]}`; 
    for (let i=1;i<loop.length;i++) d += ` L ${loop[i][0]} ${loop[i][1]}`; 
    d += ' Z';
    p.setAttribute('d', d); 
    p.setAttribute('fill','black'); 
    holes.appendChild(p);
  }
  
  // coastline strokes
  if (state.drawCoastlines){
    for (const loop of world.coastLoops){
      const p = document.createElementNS(ns,'path');
      let d = `M ${loop[0][0]} ${loop[0][1]}`; 
      for (let i=1;i<loop.length;i++) d += ` L ${loop[i][0]} ${loop[i][1]}`; 
      d += ' Z';
      p.setAttribute('d', d); 
      coastG.appendChild(p);
    }
  }
}
