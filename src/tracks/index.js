import { createCity } from './city.js';
import { createDocks } from './docks.js';
import { createMountain } from './mountain.js';

export const TRACKS = [
  {
    id: 'city',
    name: 'Neon Downtown',
    tag: 'Night · wet streets',
    desc: 'Four-lane grid, 90° junctions and a central plaza built for donuts. Walls are close.',
    swatch: 'linear-gradient(135deg,#0b0d1f 0%,#2a1450 55%,#ff3df2 130%)',
    create: createCity,
  },
  {
    id: 'mountain',
    name: 'Touge Pass',
    tag: 'Golden hour · 2.1 km loop',
    desc: 'Sixty metres of climb, linked sweepers and tight esses between guardrails. Gravel on the shoulders.',
    swatch: 'linear-gradient(135deg,#27407a 0%,#d98b5f 60%,#ffcf8a 110%)',
    create: createMountain,
  },
  {
    id: 'docks',
    name: 'Harbour Terminal',
    tag: 'Day · open apron',
    desc: 'Painted skidpad, figure-eight islands, a container canyon and a soaked low-grip pad.',
    swatch: 'linear-gradient(135deg,#2a66c8 0%,#9fc2e0 55%,#d9541e 130%)',
    create: createDocks,
  },
];

export const trackById = (id) => TRACKS.find((t) => t.id === id) ?? TRACKS[0];
