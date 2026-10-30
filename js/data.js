// Static game data: items, fluids, recipes, buildings, technologies.
// Units: power in kW, energy in kJ, time in seconds.

// ---------- Items ----------
// shape is used for both icons and belt rendering buckets.
const I = (name, color, shape, extra = {}) => ({ name, color, shape, stack: 50, ...extra });

export const ITEMS = {
  // raw resources
  'iron-ore': I('Iron Ore', '#7d8fa6', 'ore', { stack: 50 }),
  'copper-ore': I('Copper Ore', '#c8733f', 'ore'),
  'coal': I('Coal', '#2a2a2e', 'ore', { fuel: 4000 }),
  'stone': I('Stone', '#a3957d', 'ore'),
  'quartz': I('Quartz', '#e4def5', 'crystal'),
  'bauxite': I('Bauxite', '#b4532c', 'ore'),
  // smelted / refined
  'iron-plate': I('Iron Plate', '#b9c5d2', 'plate', { stack: 100 }),
  'copper-plate': I('Copper Plate', '#e58a4e', 'plate', { stack: 100 }),
  'stone-brick': I('Stone Brick', '#b8a586', 'brick', { stack: 100 }),
  'steel-plate': I('Steel Plate', '#7f8c99', 'plate', { stack: 100 }),
  'glass': I('Glass', '#9fe3f3', 'plate', { stack: 100 }),
  'silicon': I('Silicon Wafer', '#56607a', 'wafer', { stack: 100 }),
  'alumina': I('Alumina', '#efe9da', 'powder', { stack: 100 }),
  'aluminium-plate': I('Aluminium Plate', '#dce3ea', 'plate', { stack: 100 }),
  'plastic': I('Plastic Bar', '#f4f4f4', 'plate', { stack: 100 }),
  'sulfur': I('Sulfur', '#ead53a', 'powder', { stack: 100 }),
  'tar': I('Tar', '#3b2c22', 'blob', { stack: 100, fuel: 1500 }),
  'solid-fuel': I('Solid Fuel', '#7a6440', 'brick', { fuel: 12000 }),
  // components
  'gear': I('Iron Gear', '#9aa5b1', 'gear', { stack: 100 }),
  'copper-wire': I('Copper Wire', '#ec9a55', 'wire', { stack: 200 }),
  'circuit': I('Circuit', '#45b04e', 'chip', { stack: 200 }),
  'adv-circuit': I('Advanced Circuit', '#e04a4a', 'chip', { stack: 200 }),
  'processor': I('Processor', '#4a72e8', 'chip', { stack: 200 }),
  'engine': I('Engine Unit', '#a08d6c', 'engine'),
  'electric-engine': I('Electric Engine', '#46a6e6', 'engine'),
  'battery': I('Battery', '#c3d642', 'battery', { stack: 200 }),
  'lightweight-frame': I('Lightweight Frame', '#c9ced6', 'frame'),
  'concrete': I('Concrete', '#9b9b95', 'brick', { stack: 100 }),
  'optical-fiber': I('Optical Fiber', '#7ff3ff', 'wire', { stack: 200 }),
  'photonic-chip': I('Photonic Chip', '#b673ff', 'chip', { stack: 100 }),
  'resonator-core': I('Resonator Core', '#ffd23f', 'core', { stack: 10 }),
  // modules
  'speed-module-1': I('Speed Module I', '#4aa3ff', 'module', { module: { speed: 0.2, energy: 0.5 }, tier: 1 }),
  'speed-module-2': I('Speed Module II', '#2f86ff', 'module', { module: { speed: 0.3, energy: 0.6 }, tier: 2 }),
  'speed-module-3': I('Speed Module III', '#1a62e0', 'module', { module: { speed: 0.5, energy: 0.7 }, tier: 3 }),
  'prod-module-1': I('Productivity Module I', '#ff9442', 'module', { module: { prod: 0.04, speed: -0.05, energy: 0.4 }, tier: 1 }),
  'prod-module-2': I('Productivity Module II', '#f57a22', 'module', { module: { prod: 0.06, speed: -0.1, energy: 0.6 }, tier: 2 }),
  'prod-module-3': I('Productivity Module III', '#e05a10', 'module', { module: { prod: 0.1, speed: -0.15, energy: 0.8 }, tier: 3 }),
  'eff-module-1': I('Efficiency Module I', '#5ad466', 'module', { module: { energy: -0.3 }, tier: 1 }),
  'eff-module-2': I('Efficiency Module II', '#3cbc4a', 'module', { module: { energy: -0.4 }, tier: 2 }),
  'eff-module-3': I('Efficiency Module III', '#24a032', 'module', { module: { energy: -0.5 }, tier: 3 }),
  // research data
  'data-kinetic': I('Kinetic Data', '#e5473a', 'pack', { stack: 200 }),
  'data-logistic': I('Logistic Data', '#4fc43c', 'pack', { stack: 200 }),
  'data-chemical': I('Chemical Data', '#3a8ce6', 'pack', { stack: 200 }),
  'data-structural': I('Structural Data', '#a552e6', 'pack', { stack: 200 }),
  'data-quantum': I('Quantum Data', '#f2d43c', 'pack', { stack: 200 }),
};

export const FLUIDS = {
  'water': { name: 'Water', color: '#3d7fd6' },
  'steam': { name: 'Steam', color: '#dfe7ef' },
  'crude-oil': { name: 'Crude Oil', color: '#4a3550' },
  'petroleum': { name: 'Petroleum Gas', color: '#b673c4' },
  'lubricant': { name: 'Lubricant', color: '#52c452' },
  'sulfuric-acid': { name: 'Sulfuric Acid', color: '#d3e342' },
};

export const PACKS = ['data-kinetic', 'data-logistic', 'data-chemical', 'data-structural', 'data-quantum'];

// ---------- Buildings ----------
// size: [w, h] at rotation 0 (facing north). ports: fluid connections in local coords at rot 0.
//   port: { x, y, dir, io: 'in'|'out', link?: group } — dir points outward; pipe sits on the neighbor tile.
//   Ports sharing a `link` group merge into one network (pass-through).
export const BUILDINGS = {
  'burner-drill': { name: 'Burner Drill', size: [2, 2], kind: 'drill', speed: 0.25, area: 2, burner: true, power: 150, desc: 'Mines the 2×2 area beneath it. Burns fuel. Outputs to the tile in front.' },
  'electric-drill': { name: 'Electric Drill', size: [3, 3], kind: 'drill', speed: 0.5, area: 5, power: 90, modules: 3, desc: 'Mines a 5×5 area. Outputs to the tile in front.' },
  'pumpjack': { name: 'Pumpjack', size: [3, 3], kind: 'pumpjack', speed: 1, power: 90, modules: 2, ports: [{ x: 1, y: 0, dir: 0, io: 'out' }], desc: 'Extracts crude oil. Center must sit on an oil seep.' },
  'offshore-pump': { name: 'Offshore Pump', size: [1, 1], kind: 'offshore', rate: 600, ports: [{ x: 0, y: 0, dir: 2, io: 'out' }], desc: 'Place on shore with water in front (arrow). Outputs water behind. No power needed.' },
  'stone-furnace': { name: 'Stone Furnace', size: [2, 2], kind: 'furnace', speed: 1, burner: true, power: 90, cats: ['smelt'], desc: 'Smelts ore. Recipe chosen automatically by input.' },
  'steel-furnace': { name: 'Steel Furnace', size: [2, 2], kind: 'furnace', speed: 2, burner: true, power: 90, cats: ['smelt'], desc: 'Twice as fast as a stone furnace for the same fuel.' },
  'electric-furnace': { name: 'Electric Furnace', size: [3, 3], kind: 'furnace', speed: 2, power: 180, modules: 2, cats: ['smelt'], desc: 'Electric smelting with module slots.' },
  'assembler-1': { name: 'Assembler I', size: [3, 3], kind: 'assembler', speed: 0.5, power: 75, cats: ['craft'], desc: 'Crafts solid-only recipes.' },
  'assembler-2': { name: 'Assembler II', size: [3, 3], kind: 'assembler', speed: 0.75, power: 150, modules: 2, cats: ['craft', 'craft-fluid'], ports: [{ x: 1, y: 0, dir: 0, io: 'in' }], desc: 'Faster; accepts a fluid ingredient through its top port.' },
  'assembler-3': { name: 'Assembler III', size: [3, 3], kind: 'assembler', speed: 1.25, power: 375, modules: 4, cats: ['craft', 'craft-fluid'], ports: [{ x: 1, y: 0, dir: 0, io: 'in' }], desc: 'Fastest assembler with 4 module slots.' },
  'chem-plant': { name: 'Chemical Plant', size: [3, 3], kind: 'assembler', speed: 1, power: 210, modules: 3, cats: ['chem'], ports: [{ x: 0, y: 0, dir: 0, io: 'in' }, { x: 2, y: 0, dir: 0, io: 'in' }, { x: 0, y: 2, dir: 2, io: 'out' }, { x: 2, y: 2, dir: 2, io: 'out' }], desc: 'Chemistry. Fluid inputs on top, outputs on bottom.' },
  'refinery': { name: 'Oil Refinery', size: [5, 5], kind: 'assembler', speed: 1, power: 420, modules: 3, cats: ['refine'], ports: [{ x: 1, y: 4, dir: 2, io: 'in' }, { x: 3, y: 4, dir: 2, io: 'in' }, { x: 2, y: 0, dir: 0, io: 'out' }], desc: 'Refines crude oil. Inputs bottom, outputs top. Tar comes out as items.' },
  'lab': { name: 'Laboratory', size: [3, 3], kind: 'lab', speed: 1, power: 60, modules: 2, desc: 'Consumes data to advance research.' },
  'belt-1': { name: 'Conveyor', size: [1, 1], kind: 'belt', tier: 1, speed: 1.875, desc: '7.5 items/s.' },
  'belt-2': { name: 'Fast Conveyor', size: [1, 1], kind: 'belt', tier: 2, speed: 3.75, desc: '15 items/s.' },
  'belt-3': { name: 'Express Conveyor', size: [1, 1], kind: 'belt', tier: 3, speed: 5.625, desc: '22.5 items/s.' },
  'underground-1': { name: 'Belt Tunnel', size: [1, 1], kind: 'underground', tier: 1, speed: 1.875, range: 5, desc: 'Place an entrance, then an exit up to 4 tiles beyond, same direction.' },
  'underground-2': { name: 'Fast Belt Tunnel', size: [1, 1], kind: 'underground', tier: 2, speed: 3.75, range: 7, desc: 'Range 6.' },
  'underground-3': { name: 'Express Belt Tunnel', size: [1, 1], kind: 'underground', tier: 3, speed: 5.625, range: 9, desc: 'Range 8.' },
  'splitter-1': { name: 'Splitter', size: [2, 1], kind: 'splitter', tier: 1, speed: 1.875, desc: 'Balances two belts. Tap to set filter or priority.' },
  'splitter-2': { name: 'Fast Splitter', size: [2, 1], kind: 'splitter', tier: 2, speed: 3.75 },
  'splitter-3': { name: 'Express Splitter', size: [2, 1], kind: 'splitter', tier: 3, speed: 5.625 },
  'burner-inserter': { name: 'Burner Inserter', size: [1, 1], kind: 'inserter', rate: 0.6, reach: 1, burner: true, power: 100, desc: 'Moves items from behind to front. Fuels itself from coal it carries.' },
  'inserter': { name: 'Inserter', size: [1, 1], kind: 'inserter', rate: 0.83, reach: 1, power: 13, desc: 'Moves items from behind to front.' },
  'long-inserter': { name: 'Long Inserter', size: [1, 1], kind: 'inserter', rate: 1.15, reach: 2, power: 20, desc: 'Reaches 2 tiles in each direction.' },
  'fast-inserter': { name: 'Fast Inserter', size: [1, 1], kind: 'inserter', rate: 2.31, reach: 1, power: 46 },
  'filter-inserter': { name: 'Filter Inserter', size: [1, 1], kind: 'inserter', rate: 2.31, reach: 1, power: 53, filter: true, desc: 'Fast inserter that only moves the chosen item.' },
  'stack-inserter': { name: 'Stack Inserter', size: [1, 1], kind: 'inserter', rate: 2.31, reach: 1, power: 133, stack: true, filter: true, desc: 'Moves whole stacks. Optional filter.' },
  'iron-chest': { name: 'Iron Chest', size: [1, 1], kind: 'chest', slots: 16 },
  'steel-chest': { name: 'Steel Chest', size: [1, 1], kind: 'chest', slots: 32 },
  'uplink-chest': { name: 'Uplink Chest', size: [1, 1], kind: 'uplink', desc: 'Teleports anything inserted straight into your inventory.' },
  'downlink-chest': { name: 'Downlink Chest', size: [1, 1], kind: 'downlink', slots: 8, desc: 'Pulls a chosen item from your inventory, keeping a set amount stocked.' },
  'pole-small': { name: 'Utility Pole', size: [1, 1], kind: 'pole', supply: 2, reach: 7.5 },
  'pole-medium': { name: 'Steel Pylon', size: [1, 1], kind: 'pole', supply: 3, reach: 9 },
  'substation': { name: 'Substation', size: [2, 2], kind: 'pole', supply: 8, reach: 18 },
  'pipe': { name: 'Pipe', size: [1, 1], kind: 'pipe', desc: 'Connects to all neighbouring pipes and matching ports.' },
  'underground-pipe': { name: 'Pipe Tunnel', size: [1, 1], kind: 'upipe', range: 10, desc: 'Entrance then exit, up to 9 tiles apart. Only the open ends connect.' },
  'boiler': { name: 'Boiler', size: [3, 2], kind: 'boiler', power: 1800, burner: true, ports: [{ x: 0, y: 1, dir: 3, io: 'in', link: 'w' }, { x: 2, y: 1, dir: 1, io: 'in', link: 'w' }, { x: 1, y: 0, dir: 0, io: 'out' }], desc: 'Water in (sides, pass-through), steam out (top). 60 steam/s.' },
  'steam-engine': { name: 'Steam Engine', size: [3, 3], kind: 'generator', power: 900, ports: [{ x: 1, y: 0, dir: 0, io: 'in', link: 's' }, { x: 1, y: 2, dir: 2, io: 'in', link: 's' }], desc: 'Burns 30 steam/s for 900 kW. Steam passes through to chain engines.' },
  'solar-panel': { name: 'Solar Panel', size: [3, 3], kind: 'solar', power: 60, desc: '60 kW peak in daylight.' },
  'accumulator': { name: 'Accumulator', size: [2, 2], kind: 'accumulator', capacity: 5000, rate: 300, desc: 'Stores 5 MJ. Charges from surplus, discharges at night.' },
  'beacon': { name: 'Beacon', size: [3, 3], kind: 'beacon', power: 480, modules: 2, range: 3, desc: 'Shares 50% of its module effects with machines within 3 tiles.' },
  'resonance-gate': { name: 'Resonance Gate', size: [7, 7], kind: 'gate', power: 5000, need: 50, desc: 'The final project. Feed it 50 Resonator Cores while powered.' },
};

// ---------- Recipes ----------
// cat: craft (hand + assembler), craft-fluid (assembler II+), smelt, chem, refine
const R = (cat, time, inp, out, extra = {}) => ({ cat, time, in: inp, out, ...extra });

export const RECIPES = {
  // smelting
  'iron-plate': R('smelt', 3.2, { 'iron-ore': 1 }, { 'iron-plate': 1 }),
  'copper-plate': R('smelt', 3.2, { 'copper-ore': 1 }, { 'copper-plate': 1 }),
  'stone-brick': R('smelt', 3.2, { 'stone': 2 }, { 'stone-brick': 1 }),
  'steel-plate': R('smelt', 16, { 'iron-plate': 5 }, { 'steel-plate': 1 }),
  'glass': R('smelt', 3.2, { 'quartz': 2 }, { 'glass': 1 }),
  'aluminium-plate': R('smelt', 6.4, { 'alumina': 2 }, { 'aluminium-plate': 1 }),
  // basic intermediates
  'gear': R('craft', 0.5, { 'iron-plate': 2 }, { 'gear': 1 }),
  'copper-wire': R('craft', 0.5, { 'copper-plate': 1 }, { 'copper-wire': 2 }),
  'circuit': R('craft', 0.5, { 'iron-plate': 1, 'copper-wire': 3 }, { 'circuit': 1 }),
  'pipe': R('craft', 0.5, { 'iron-plate': 1 }, { 'pipe': 1 }),
  'adv-circuit': R('craft', 6, { 'circuit': 2, 'plastic': 2, 'copper-wire': 4 }, { 'adv-circuit': 1 }),
  'processor': R('craft-fluid', 10, { 'circuit': 20, 'adv-circuit': 2, 'silicon': 2, 'sulfuric-acid': 5 }, { 'processor': 1 }),
  'engine': R('craft', 10, { 'steel-plate': 1, 'gear': 1, 'pipe': 2 }, { 'engine': 1 }),
  'electric-engine': R('craft-fluid', 10, { 'engine': 1, 'circuit': 2, 'lubricant': 15 }, { 'electric-engine': 1 }),
  'lightweight-frame': R('craft', 15, { 'aluminium-plate': 4, 'steel-plate': 2, 'plastic': 2 }, { 'lightweight-frame': 1 }),
  'concrete': R('craft-fluid', 10, { 'stone-brick': 5, 'iron-ore': 1, 'water': 100 }, { 'concrete': 10 }),
  'optical-fiber': R('craft', 2, { 'glass': 1, 'plastic': 1 }, { 'optical-fiber': 2 }),
  'photonic-chip': R('craft', 12, { 'optical-fiber': 4, 'processor': 1, 'silicon': 2 }, { 'photonic-chip': 1 }),
  'resonator-core': R('craft', 30, { 'photonic-chip': 5, 'lightweight-frame': 5, 'electric-engine': 2, 'battery': 10 }, { 'resonator-core': 1 }),
  // research data
  'data-kinetic': R('craft', 5, { 'copper-plate': 1, 'gear': 1 }, { 'data-kinetic': 1 }),
  'data-logistic': R('craft', 6, { 'inserter': 1, 'belt-1': 1 }, { 'data-logistic': 1 }),
  'data-chemical': R('craft', 24, { 'engine': 2, 'adv-circuit': 3, 'sulfur': 1 }, { 'data-chemical': 2 }),
  'data-structural': R('craft', 21, { 'electric-furnace': 1, 'lightweight-frame': 1, 'concrete': 20 }, { 'data-structural': 3 }),
  'data-quantum': R('craft', 30, { 'processor': 2, 'electric-engine': 1, 'battery': 2, 'photonic-chip': 1 }, { 'data-quantum': 3 }),
  // chemistry
  'plastic': R('chem', 1, { 'petroleum': 20, 'coal': 1 }, { 'plastic': 2 }),
  'sulfur': R('chem', 1, { 'petroleum': 30, 'water': 30 }, { 'sulfur': 2 }),
  'sulfuric-acid': R('chem', 1, { 'sulfur': 5, 'iron-plate': 1, 'water': 100 }, { 'sulfuric-acid': 50 }),
  'battery': R('chem', 4, { 'sulfuric-acid': 20, 'iron-plate': 1, 'copper-plate': 1 }, { 'battery': 1 }),
  'silicon': R('chem', 4, { 'quartz': 3, 'coal': 1 }, { 'silicon': 2 }),
  'alumina': R('chem', 5, { 'bauxite': 4, 'sulfuric-acid': 20 }, { 'alumina': 2 }),
  'lubricant': R('chem', 1, { 'tar': 2, 'water': 10 }, { 'lubricant': 20 }),
  'solid-fuel-gas': R('chem', 2, { 'petroleum': 20 }, { 'solid-fuel': 1 }, { name: 'Solid Fuel (gas)' }),
  'solid-fuel-tar': R('chem', 2, { 'tar': 3 }, { 'solid-fuel': 1 }, { name: 'Solid Fuel (tar)' }),
  'tar-cracking': R('chem', 2, { 'tar': 4, 'steam': 20 }, { 'petroleum': 30 }, { name: 'Tar Cracking' }),
  // refining
  'basic-refining': R('refine', 5, { 'crude-oil': 100 }, { 'petroleum': 60, 'tar': 2 }, { name: 'Basic Refining' }),
  'advanced-refining': R('refine', 5, { 'crude-oil': 100, 'water': 50 }, { 'petroleum': 80, 'tar': 1 }, { name: 'Advanced Refining' }),
  // buildings & logistics
  'belt-1': R('craft', 0.5, { 'gear': 1, 'iron-plate': 1 }, { 'belt-1': 2 }),
  'belt-2': R('craft', 0.5, { 'gear': 5, 'belt-1': 1 }, { 'belt-2': 1 }),
  'belt-3': R('craft-fluid', 0.5, { 'gear': 10, 'belt-2': 1, 'lubricant': 20 }, { 'belt-3': 1 }),
  'underground-1': R('craft', 1, { 'iron-plate': 10, 'belt-1': 5 }, { 'underground-1': 2 }),
  'underground-2': R('craft', 2, { 'gear': 40, 'underground-1': 2 }, { 'underground-2': 2 }),
  'underground-3': R('craft-fluid', 2, { 'gear': 80, 'underground-2': 2, 'lubricant': 40 }, { 'underground-3': 2 }),
  'splitter-1': R('craft', 1, { 'circuit': 5, 'iron-plate': 5, 'belt-1': 4 }, { 'splitter-1': 1 }),
  'splitter-2': R('craft', 2, { 'splitter-1': 1, 'gear': 10, 'circuit': 10 }, { 'splitter-2': 1 }),
  'splitter-3': R('craft-fluid', 2, { 'splitter-2': 1, 'gear': 10, 'adv-circuit': 10, 'lubricant': 80 }, { 'splitter-3': 1 }),
  'burner-inserter': R('craft', 0.5, { 'iron-plate': 1, 'gear': 1 }, { 'burner-inserter': 1 }),
  'inserter': R('craft', 0.5, { 'circuit': 1, 'gear': 1, 'iron-plate': 1 }, { 'inserter': 1 }),
  'long-inserter': R('craft', 0.5, { 'inserter': 1, 'gear': 1, 'iron-plate': 1 }, { 'long-inserter': 1 }),
  'fast-inserter': R('craft', 0.5, { 'inserter': 1, 'circuit': 2, 'iron-plate': 2 }, { 'fast-inserter': 1 }),
  'filter-inserter': R('craft', 0.5, { 'fast-inserter': 1, 'circuit': 4 }, { 'filter-inserter': 1 }),
  'stack-inserter': R('craft', 0.5, { 'fast-inserter': 1, 'gear': 15, 'circuit': 15, 'adv-circuit': 1 }, { 'stack-inserter': 1 }),
  'iron-chest': R('craft', 0.5, { 'iron-plate': 8 }, { 'iron-chest': 1 }),
  'steel-chest': R('craft', 0.5, { 'steel-plate': 8 }, { 'steel-chest': 1 }),
  'uplink-chest': R('craft', 2, { 'steel-chest': 1, 'circuit': 10 }, { 'uplink-chest': 1 }),
  'downlink-chest': R('craft', 2, { 'steel-chest': 1, 'circuit': 10, 'gear': 10 }, { 'downlink-chest': 1 }),
  'burner-drill': R('craft', 2, { 'gear': 3, 'stone-furnace': 1, 'iron-plate': 3 }, { 'burner-drill': 1 }),
  'electric-drill': R('craft', 2, { 'circuit': 3, 'gear': 5, 'iron-plate': 10 }, { 'electric-drill': 1 }),
  'pumpjack': R('craft', 5, { 'steel-plate': 5, 'gear': 10, 'circuit': 5, 'pipe': 10 }, { 'pumpjack': 1 }),
  'offshore-pump': R('craft', 0.5, { 'circuit': 2, 'pipe': 1, 'gear': 1 }, { 'offshore-pump': 1 }),
  'stone-furnace': R('craft', 0.5, { 'stone': 5 }, { 'stone-furnace': 1 }),
  'steel-furnace': R('craft', 3, { 'steel-plate': 6, 'stone-brick': 10 }, { 'steel-furnace': 1 }),
  'electric-furnace': R('craft', 5, { 'steel-plate': 10, 'adv-circuit': 5, 'stone-brick': 10 }, { 'electric-furnace': 1 }),
  'assembler-1': R('craft', 0.5, { 'circuit': 3, 'gear': 5, 'iron-plate': 9 }, { 'assembler-1': 1 }),
  'assembler-2': R('craft', 0.5, { 'assembler-1': 1, 'circuit': 3, 'gear': 5, 'steel-plate': 2 }, { 'assembler-2': 1 }),
  'assembler-3': R('craft', 0.5, { 'assembler-2': 2, 'speed-module-1': 4 }, { 'assembler-3': 1 }),
  'chem-plant': R('craft', 5, { 'steel-plate': 5, 'gear': 5, 'circuit': 5, 'pipe': 5 }, { 'chem-plant': 1 }),
  'refinery': R('craft', 8, { 'steel-plate': 15, 'gear': 10, 'circuit': 10, 'pipe': 10, 'stone-brick': 10 }, { 'refinery': 1 }),
  'lab': R('craft', 2, { 'circuit': 10, 'gear': 10, 'belt-1': 4 }, { 'lab': 1 }),
  'pole-small': R('craft', 0.5, { 'iron-plate': 1, 'copper-wire': 2 }, { 'pole-small': 2 }),
  'pole-medium': R('craft', 0.5, { 'steel-plate': 2, 'copper-plate': 2 }, { 'pole-medium': 1 }),
  'substation': R('craft', 0.5, { 'steel-plate': 10, 'adv-circuit': 5, 'copper-plate': 5 }, { 'substation': 1 }),
  'underground-pipe': R('craft', 0.5, { 'pipe': 10, 'iron-plate': 5 }, { 'underground-pipe': 2 }),
  'boiler': R('craft', 0.5, { 'stone-furnace': 1, 'pipe': 4 }, { 'boiler': 1 }),
  'steam-engine': R('craft', 0.5, { 'gear': 8, 'pipe': 5, 'iron-plate': 10 }, { 'steam-engine': 1 }),
  'solar-panel': R('craft', 10, { 'steel-plate': 5, 'circuit': 15, 'glass': 5 }, { 'solar-panel': 1 }),
  'accumulator': R('craft', 10, { 'iron-plate': 2, 'battery': 5 }, { 'accumulator': 1 }),
  'beacon': R('craft', 15, { 'adv-circuit': 20, 'circuit': 20, 'steel-plate': 10, 'copper-wire': 10 }, { 'beacon': 1 }),
  'resonance-gate': R('craft', 60, { 'concrete': 500, 'lightweight-frame': 100, 'processor': 100, 'steel-plate': 200, 'electric-engine': 50 }, { 'resonance-gate': 1 }),
  // modules
  'speed-module-1': R('craft', 15, { 'adv-circuit': 5, 'circuit': 5 }, { 'speed-module-1': 1 }),
  'prod-module-1': R('craft', 15, { 'adv-circuit': 5, 'circuit': 5 }, { 'prod-module-1': 1 }),
  'eff-module-1': R('craft', 15, { 'adv-circuit': 5, 'circuit': 5 }, { 'eff-module-1': 1 }),
  'speed-module-2': R('craft', 30, { 'speed-module-1': 4, 'adv-circuit': 5, 'processor': 5 }, { 'speed-module-2': 1 }),
  'prod-module-2': R('craft', 30, { 'prod-module-1': 4, 'adv-circuit': 5, 'processor': 5 }, { 'prod-module-2': 1 }),
  'eff-module-2': R('craft', 30, { 'eff-module-1': 4, 'adv-circuit': 5, 'processor': 5 }, { 'eff-module-2': 1 }),
  'speed-module-3': R('craft', 60, { 'speed-module-2': 4, 'processor': 5, 'photonic-chip': 2 }, { 'speed-module-3': 1 }),
  'prod-module-3': R('craft', 60, { 'prod-module-2': 4, 'processor': 5, 'photonic-chip': 2 }, { 'prod-module-3': 1 }),
  'eff-module-3': R('craft', 60, { 'eff-module-2': 4, 'processor': 5, 'photonic-chip': 2 }, { 'eff-module-3': 1 }),
};

// Building items: every building is also an item.
for (const [id, b] of Object.entries(BUILDINGS)) {
  if (!ITEMS[id]) ITEMS[id] = { name: b.name, color: '#8892a0', shape: 'building', stack: 50, place: id };
  else ITEMS[id].place = id;
}

// Productivity modules only apply to intermediate products (not buildings/modules).
for (const [id, r] of Object.entries(RECIPES)) {
  const outs = Object.keys(r.out);
  r.prodOk = outs.every(o => !(ITEMS[o] && (ITEMS[o].place || ITEMS[o].module)));
  if (!r.name) {
    const o = outs[0];
    r.name = (ITEMS[o] || FLUIDS[o]).name;
  }
  r.hand = r.cat === 'craft';
}

export const isFluid = (id) => !!FLUIDS[id];
export const nameOf = (id) => (ITEMS[id] || FLUIDS[id] || { name: id }).name;
export const colorOf = (id) => (ITEMS[id] || FLUIDS[id] || { color: '#ff00ff' }).color;

// ---------- Technologies ----------
// cost: { pack: n } per unit; count: units; time: seconds per unit at lab speed 1.
// effects: [{ type, value }] — mining-prod, lab-speed, craft-speed, inserter-bonus, stack-bonus
const K = 'data-kinetic', L = 'data-logistic', C = 'data-chemical', S = 'data-structural', Q = 'data-quantum';
const pk = (...ps) => Object.fromEntries(ps.map(p => [p, 1]));
const T = (name, packs, count, time, prereq, unlocks = [], effects = [], desc = '') =>
  ({ name, cost: pk(...packs), count, time, prereq, unlocks, effects, desc });

export const TECHS = {
  'automation': T('Automation', [K], 10, 10, [], ['assembler-1', 'long-inserter'], [], 'Assemblers craft for you. The heart of everything.'),
  'logistics': T('Logistics', [K], 20, 10, [], ['underground-1', 'splitter-1'], [], 'Tunnels and splitters for routing belts.'),
  'nimble-1': T('Nimble Hands I', [K], 25, 10, [], [], [{ type: 'craft-speed', value: 0.5 }], '+50% hand-crafting speed.'),
  'steel-processing': T('Steel Processing', [K], 50, 5, [], ['steel-plate', 'steel-chest'], [], 'Smelt iron plates into steel.'),
  'fluid-handling': T('Fluid Handling', [K], 40, 10, ['automation'], ['underground-pipe'], [], 'Pipe tunnels for crossing fluid lines.'),
  'logistic-data': T('Logistic Data', [K], 75, 5, ['logistics', 'automation'], ['data-logistic'], [], 'A second data type unlocks a wide new branch.'),

  'automation-2': T('Automation II', [K, L], 40, 15, ['logistic-data', 'steel-processing'], ['assembler-2'], [], 'Faster assemblers that accept fluids.'),
  'fast-inserter': T('Fast Inserters', [K, L], 30, 15, ['logistic-data'], ['fast-inserter'], []),
  'filter-inserter': T('Filter Inserters', [K, L], 100, 15, ['fast-inserter'], ['filter-inserter'], [], 'Sort mixed belts precisely.'),
  'logistics-2': T('Logistics II', [K, L], 200, 15, ['logistic-data'], ['belt-2', 'underground-2', 'splitter-2'], [], 'Double belt throughput.'),
  'electric-dist-1': T('Power Distribution I', [K, L], 120, 15, ['logistic-data', 'steel-processing'], ['pole-medium'], []),
  'adv-material-1': T('Advanced Smelting', [K, L], 75, 15, ['logistic-data', 'steel-processing'], ['steel-furnace'], []),
  'glassworking': T('Glassworking', [K, L], 50, 15, ['logistic-data'], ['glass'], [], 'Smelt quartz into glass.'),
  'solar-energy': T('Solar Energy', [K, L], 100, 20, ['glassworking', 'steel-processing'], ['solar-panel'], [], 'Free power by day.'),
  'engine': T('Engines', [K, L], 100, 15, ['logistic-data', 'steel-processing'], ['engine'], []),
  'oil-processing': T('Oil Processing', [K, L], 100, 15, ['fluid-handling', 'logistic-data', 'steel-processing'], ['pumpjack', 'refinery', 'chem-plant', 'basic-refining', 'solid-fuel-gas', 'solid-fuel-tar'], [], 'Crude oil → petroleum gas and tar. Find a use for the tar or it will back up.'),
  'plastics': T('Plastics', [K, L], 200, 15, ['oil-processing'], ['plastic'], []),
  'adv-electronics': T('Advanced Electronics', [K, L], 200, 15, ['plastics'], ['adv-circuit'], []),
  'sulfur-processing': T('Sulfur Processing', [K, L], 150, 15, ['oil-processing'], ['sulfur', 'sulfuric-acid'], []),
  'silicon-refining': T('Silicon Refining', [K, L], 150, 15, ['oil-processing', 'glassworking'], ['silicon'], [], 'Quartz + coal → silicon wafers in a chemical plant.'),
  'batteries': T('Batteries', [K, L], 150, 20, ['sulfur-processing'], ['battery'], []),
  'accumulators': T('Accumulators', [K, L], 150, 20, ['batteries', 'solar-energy'], ['accumulator'], [], 'Store solar surplus for the night.'),
  'matter-uplink': T('Matter Uplink', [K, L], 150, 15, ['logistic-data', 'steel-processing'], ['uplink-chest', 'downlink-chest'], [], 'Chests linked to your personal inventory. Automate your own supply.'),
  'modules': T('Modules', [K, L], 100, 30, ['adv-electronics'], ['speed-module-1', 'prod-module-1', 'eff-module-1'], [], 'Trade energy for speed, productivity or efficiency.'),
  'mining-prod-1': T('Mining Productivity I', [K, L], 250, 30, ['logistic-data'], [], [{ type: 'mining-prod', value: 0.1 }], '+10% ore from every drill, for free.'),
  'lab-speed-1': T('Research Speed I', [K, L], 100, 30, ['logistic-data'], [], [{ type: 'lab-speed', value: 0.2 }]),
  'inserter-cap-1': T('Inserter Capacity I', [K, L], 200, 30, ['fast-inserter'], [], [{ type: 'stack-bonus', value: 2 }], 'Stack inserters carry 2 more items.'),
  'nimble-2': T('Nimble Hands II', [K, L], 100, 20, ['nimble-1', 'logistic-data'], [], [{ type: 'craft-speed', value: 0.5 }]),
  'chemical-data': T('Chemical Data', [K, L], 75, 10, ['adv-electronics', 'sulfur-processing', 'engine', 'automation-2'], ['data-chemical'], [], 'The third data type.'),

  'automation-3': T('Automation III', [K, L, C], 150, 60, ['chemical-data', 'modules'], ['assembler-3'], []),
  'lubricant': T('Lubricant', [K, L, C], 50, 15, ['chemical-data'], ['lubricant'], [], 'Tar + water → lubricant.'),
  'logistics-3': T('Logistics III', [K, L, C], 300, 15, ['lubricant', 'logistics-2'], ['belt-3', 'underground-3', 'splitter-3'], []),
  'electric-engine': T('Electric Engines', [K, L, C], 100, 30, ['lubricant'], ['electric-engine'], []),
  'adv-oil': T('Advanced Oil Processing', [K, L, C], 75, 30, ['chemical-data'], ['advanced-refining', 'tar-cracking'], [], 'More gas, less tar. Crack surplus tar with steam.'),
  'aluminium': T('Aluminium Processing', [K, L, C], 150, 30, ['chemical-data', 'sulfur-processing'], ['alumina', 'aluminium-plate'], [], 'Bauxite + acid → alumina → aluminium.'),
  'lightweight-frames': T('Lightweight Frames', [K, L, C], 250, 30, ['aluminium', 'plastics'], ['lightweight-frame'], []),
  'concrete': T('Concrete', [K, L, C], 100, 30, ['chemical-data'], ['concrete'], []),
  'adv-material-2': T('Electric Smelting', [K, L, C], 250, 30, ['chemical-data', 'adv-material-1'], ['electric-furnace'], []),
  'electric-dist-2': T('Power Distribution II', [K, L, C], 200, 30, ['electric-dist-1', 'chemical-data'], ['substation'], []),
  'stack-inserter': T('Stack Inserters', [K, L, C], 250, 30, ['filter-inserter', 'chemical-data'], ['stack-inserter'], []),
  'beacons': T('Effect Transmission', [K, L, C], 200, 30, ['modules', 'chemical-data'], ['beacon'], [], 'Beacons broadcast module effects to neighbours.'),
  'processors': T('Processors', [K, L, C], 300, 30, ['chemical-data', 'silicon-refining'], ['processor'], []),
  'speed-module-2': T('Speed Module II', [K, L, C], 300, 30, ['modules', 'processors'], ['speed-module-2'], []),
  'prod-module-2': T('Productivity Module II', [K, L, C], 300, 30, ['modules', 'processors'], ['prod-module-2'], []),
  'eff-module-2': T('Efficiency Module II', [K, L, C], 300, 30, ['modules', 'processors'], ['eff-module-2'], []),
  'mining-prod-2': T('Mining Productivity II', [K, L, C], 300, 60, ['mining-prod-1', 'chemical-data'], [], [{ type: 'mining-prod', value: 0.1 }]),
  'lab-speed-2': T('Research Speed II', [K, L, C], 200, 30, ['lab-speed-1', 'chemical-data'], [], [{ type: 'lab-speed', value: 0.3 }]),
  'inserter-cap-2': T('Inserter Capacity II', [K, L, C], 250, 30, ['inserter-cap-1', 'stack-inserter'], [], [{ type: 'stack-bonus', value: 4 }]),
  'structural-data': T('Structural Data', [K, L, C], 300, 30, ['lightweight-frames', 'concrete', 'adv-material-2'], ['data-structural'], [], 'The fourth data type.'),

  'photonics': T('Photonics', [K, L, C, S], 300, 30, ['structural-data', 'processors'], ['optical-fiber', 'photonic-chip'], [], 'Light-based computation.'),
  'quantum-data': T('Quantum Data', [K, L, C, S], 500, 30, ['photonics', 'electric-engine', 'batteries'], ['data-quantum'], [], 'The fifth and final data type.'),
  'mining-prod-3': T('Mining Productivity III', [K, L, C, S], 400, 60, ['mining-prod-2', 'structural-data'], [], [{ type: 'mining-prod', value: 0.1 }]),
  'lab-speed-3': T('Research Speed III', [K, L, C, S], 300, 30, ['lab-speed-2', 'structural-data'], [], [{ type: 'lab-speed', value: 0.4 }]),
  'nimble-3': T('Nimble Hands III', [K, L, C, S], 150, 30, ['nimble-2', 'structural-data'], [], [{ type: 'craft-speed', value: 1 }]),
  'inserter-cap-3': T('Inserter Capacity III', [K, L, C, S], 300, 30, ['inserter-cap-2', 'structural-data'], [], [{ type: 'stack-bonus', value: 4 }]),

  'speed-module-3': T('Speed Module III', [K, L, C, S, Q], 300, 60, ['speed-module-2', 'quantum-data'], ['speed-module-3'], []),
  'prod-module-3': T('Productivity Module III', [K, L, C, S, Q], 300, 60, ['prod-module-2', 'quantum-data'], ['prod-module-3'], []),
  'eff-module-3': T('Efficiency Module III', [K, L, C, S, Q], 300, 60, ['eff-module-2', 'quantum-data'], ['eff-module-3'], []),
  'mining-prod-4': T('Mining Productivity IV', [K, L, C, S, Q], 500, 60, ['mining-prod-3', 'quantum-data'], [], [{ type: 'mining-prod', value: 0.15 }]),
  'lab-speed-4': T('Research Speed IV', [K, L, C, S, Q], 500, 60, ['lab-speed-3', 'quantum-data'], [], [{ type: 'lab-speed', value: 0.5 }]),
  'resonance': T('Resonance Theory', [K, L, C, S, Q], 1000, 60, ['quantum-data', 'speed-module-3', 'prod-module-3'], ['resonator-core', 'resonance-gate'], [], 'Build the Resonance Gate and finish the game.'),
  'mining-prod-inf': T('Deep Mining', [K, L, C, S, Q], 1000, 60, ['mining-prod-4'], [], [{ type: 'mining-prod', value: 0.1 }], 'Repeatable. +10% mining productivity per level.'),
};
TECHS['mining-prod-inf'].infinite = true;

// Recipes available from the start.
export const START_RECIPES = [
  'iron-plate', 'copper-plate', 'stone-brick', 'gear', 'copper-wire', 'circuit', 'pipe',
  'belt-1', 'burner-inserter', 'inserter', 'iron-chest', 'burner-drill', 'electric-drill',
  'offshore-pump', 'stone-furnace', 'lab', 'pole-small', 'boiler', 'steam-engine', 'data-kinetic',
];

// Validate data integrity in development.
export function validateData() {
  const errs = [];
  const known = (id) => ITEMS[id] || FLUIDS[id];
  for (const [id, r] of Object.entries(RECIPES)) {
    for (const k of [...Object.keys(r.in), ...Object.keys(r.out)]) if (!known(k)) errs.push(`recipe ${id}: unknown ${k}`);
    if (r.cat === 'craft' && Object.keys(r.in).some(isFluid)) errs.push(`recipe ${id}: fluid in craft cat`);
  }
  for (const [id, t] of Object.entries(TECHS)) {
    for (const p of t.prereq) if (!TECHS[p]) errs.push(`tech ${id}: unknown prereq ${p}`);
    for (const u of t.unlocks) if (!RECIPES[u]) errs.push(`tech ${id}: unknown unlock ${u}`);
  }
  for (const id of Object.keys(BUILDINGS)) if (!RECIPES[id]) errs.push(`building ${id} has no recipe`);
  return errs;
}
