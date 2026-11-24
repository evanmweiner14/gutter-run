/* Gutter Run — game content (data-driven).
   Everything here is plain data plus small hook functions. game.js reads it from window.GR.

   Hook signature for charms, balls and bosses: hook(arg, state, api)
     - state: a per-charm object that lives for the whole run (use it for scaling charms)
     - api:   helpers from the game, e.g. api.tempMod(pinNumber, modId)
   Events:
     score(c)        a roll is being scored. c = { type, firstBall, fresh, strike, streak, knocked, knockedNums,
                     domino, splitLeave, lastFrame, firstRoll, pins, mult, cash, spin, speed, ballId, mods,
                     isBoss, scoreSoFar, target, charmCount }. Return true when the charm changed something.
     stationStart(s) a station begins. s = { frames, reracks, bumpers, isBoss }
     stationEnd(e)   a station ends. e = { won, reracksLeft, framesLeft, cash }
     rerack()        the player used a re-rack (the fresh rack is already in place)
   Flags read directly by the game: discount (shop $ off), freeReroll (first reroll per shop is free). */
(() => {
'use strict';

const RARITY = {
  common: { price: 4, weight: 60, label: 'Common' },
  uncommon: { price: 6, weight: 30, label: 'Uncommon' },
  rare: { price: 8, weight: 10, label: 'Rare' },
};

// Roll types and how Trophies level them up (base + (level-1) × per-level gain)
const ROLL_TYPES = {
  strike: { name: 'Strike', pins: 50, mult: 4, lvPins: 30, lvMult: 2 },
  turkey: { name: 'Turkey', pins: 100, mult: 8, lvPins: 40, lvMult: 3 },
  spare: { name: 'Spare', pins: 30, mult: 3, lvPins: 25, lvMult: 2 },
  split: { name: 'Split Pickup', pins: 60, mult: 5, lvPins: 30, lvMult: 2 },
  backrow: { name: 'Clean Back Row', pins: 20, mult: 2, lvPins: 20, lvMult: 1 },
  open: { name: 'Open Roll', pins: 0, mult: 1, lvPins: 15, lvMult: 1 },
};

const BALLS = {
  house: { id: 'house', name: 'House Ball', desc: 'Balanced and reliable.', mass: 15, hook: 1, price: 0,
    colors: ['#7fb6ff', '#2459c4', '#122c74', '#081538'], swirl: 'rgba(160,120,255,.35)' },
  resin: { id: 'resin', name: 'Reactive Resin', desc: 'Hooks 60% harder once it reaches the dry back end.', mass: 15, hook: 1.6, price: 6,
    colors: ['#ff9bf0', '#b02ab8', '#5c0f6b', '#2a0533'], swirl: 'rgba(255,200,120,.35)' },
  urethane: { id: 'urethane', name: 'Heavy Urethane', desc: 'Heavier, so it drives through the rack. Hooks a little less.', mass: 19, hook: 0.8, price: 6,
    colors: ['#ffc38a', '#d4541c', '#7a2108', '#3a0d02'], swirl: 'rgba(255,240,200,.3)' },
  plastic: { id: 'plastic', name: 'Spare Shooter', desc: 'Plastic: barely hooks. Spares and split pickups get +2 Mult.', mass: 14, hook: 0.15, price: 5,
    colors: ['#f4f9ff', '#bcd3e6', '#7d93a8', '#45576a'], swirl: 'rgba(255,80,80,.35)',
    score(c) { if (c.type === 'spare' || c.type === 'split') { c.mult += 2; return true; } } },
  chaos: { id: 'chaos', name: 'Ball of Chaos', desc: 'Every throw gets a random hook. All scoring rolls get +3 Mult.', mass: 15, hook: 1, price: 7, chaos: true,
    colors: ['#c6ff7a', '#38b24a', '#7a1fa8', '#120624'], swirl: 'rgba(255,230,0,.45)',
    score(c) { if (c.mult > 0 && c.knocked > 0) { c.mult += 3; return true; } } },
  magnet: { id: 'magnet', name: 'Magnet Ball', desc: 'Pulls nearby pins toward it as it reaches the rack.', mass: 16, hook: 0.9, price: 7, magnet: 300,
    colors: ['#ff8d8d', '#d1202a', '#4d4f55', '#16171a'], swirl: 'rgba(210,220,230,.5)' },
};

// Pin mods sit on a rack position for the whole run (bought in the Pro Shop)
const PIN_MODS = {
  gold: { id: 'gold', name: 'Gold Pin', icon: '🪙', price: 4, desc: '+$2 every time it falls.',
    skin: ['#c9962a', '#ffe08a', '#9a6d12', '#7a4a00'], dot: '#ffcf4a' },
  glass: { id: 'glass', name: 'Glass Pin', icon: '💎', price: 5, desc: '×2 Mult when it falls, but a 1 in 4 chance it shatters back to a normal pin.',
    skin: ['rgba(170,220,255,.6)', 'rgba(240,252,255,.9)', 'rgba(120,170,220,.55)', '#4fa3d9'], dot: '#8fd3ff' },
  lead: { id: 'lead', name: 'Lead Pin', icon: '🧱', price: 4, desc: 'Heavy and hard to topple, but worth +50 Pins.',
    skin: ['#4a4d52', '#8a8f96', '#2e3034', '#1a1a1a'], dot: '#6c7178', mass: 2.4, sturdy: 1.7 },
  boom: { id: 'boom', name: 'Explosive Pin', icon: '🧨', price: 6, desc: 'Blasts nearby pins over when it falls.',
    skin: ['#c8341f', '#ff7a5c', '#8a1d10', '#1a1a1a'], dot: '#ff5a3c' },
  ghost: { id: 'ghost', name: 'Ghost Pin', icon: '👻', price: 5, desc: 'If it is still standing after a roll, it counts as down half the time.',
    skin: ['rgba(230,230,255,.35)', 'rgba(255,255,255,.6)', 'rgba(200,200,240,.3)', 'rgba(160,140,255,.6)'], dot: '#c9c3ff' },
  rubber: { id: 'rubber', name: 'Rubber Pin', icon: '🟢', price: 4, desc: 'Super bouncy, so it starts bigger chain reactions.',
    skin: ['#2f9e5a', '#7fe0a0', '#1d6b3b', '#0f3d22'], dot: '#4ccf7e' },
};

// Lane Oils: one-use consumables, hold up to 2, use them while lining up a throw
const OILS = {
  bumpers: { id: 'bumpers', name: 'Bumpers', icon: '🛡️', price: 3, desc: 'Your next roll bounces off the gutters.' },
  dry: { id: 'dry', name: 'Dry Patch', icon: '🏜️', price: 3, desc: 'Your next roll ignores the oil and hooks from the foul line.' },
  fresh: { id: 'fresh', name: 'Fresh Rack', icon: '🎳', price: 3, desc: 'On a second ball, reset to a full rack without using a re-rack.' },
  extra: { id: 'extra', name: 'Extra Frame', icon: '➕', price: 4, desc: '+1 frame at this station.' },
  double: { id: 'double', name: 'Double Up', icon: '✖️', price: 4, desc: 'Your next roll gets ×2 Mult.' },
  copycat: { id: 'copycat', name: 'Copycat', icon: '🐈', price: 5, desc: 'Copy a random charm you own into a free slot.' },
};

// Trophies: level up a roll type for the rest of the run (applied when bought)
const TROPHIES = Object.keys(ROLL_TYPES).map((k) => ({
  id: k, name: `${ROLL_TYPES[k].name} Trophy`, icon: '🏆', price: 4,
  desc: `${ROLL_TYPES[k].name}s gain +${ROLL_TYPES[k].lvPins} Pins and +${ROLL_TYPES[k].lvMult} Mult.`,
}));

// Boss rules are plain fields read by the physics, scoring and HUD:
// tilt (in/s² sideways), oilFt (oil length), trim (inches of lane lost per side), fog (z beyond which the lane is hidden),
// moving (rack sway in inches), bolted (pins that can't fall), pinMass/downMul (heavier, sturdier pins),
// maxSpeed (mph cap), frames/reracks (station changes), thief (disable a random charm), score(c) (runs after charms).
const BOSSES = [
  { id: 'tilt', icon: '📐', name: 'The Tilt', desc: 'The lane slopes left. Every ball drifts toward the left gutter.',
    hint: 'The Tilt: the lane slopes left. Aim right.', tilt: -6 },
  { id: 'fog', icon: '☁️', name: 'Fog Machine', desc: 'The back half of the lane is hidden until the pins settle.',
    hint: 'Fog Machine: trust the pin map and your line.', fog: 380 },
  { id: 'moving', icon: '🚚', name: 'Moving Day', desc: 'The rack slides side to side while you line up.',
    hint: 'Moving Day: time your throw to the rack.', moving: 7 },
  { id: 'bolted', icon: '🔩', name: 'Bolted', desc: 'Two pins in every rack are bolted down. They never fall and don\'t count.',
    hint: 'Bolted: the steel pins won\'t fall. Play around them.', bolted: 2 },
  { id: 'spareme', icon: '🙅', name: 'Spare Me', desc: 'First balls score nothing, strikes included. Spares and split pickups get double Mult.',
    hint: 'Spare Me: leave pins on ball one, then pick up the spare.',
    score(c) { if (c.firstBall && c.mult > 0) { c.mult = 0; return true; } if (c.type === 'spare' || c.type === 'split') { c.mult *= 2; return true; } } },
  { id: 'wide', icon: '🚧', name: 'Wide Gutters', desc: 'The gutters eat 3 inches of lane on each side.',
    hint: 'Wide Gutters: stay off the edges.', trim: 3 },
  { id: 'thief', icon: '🐀', name: 'Charm Thief', desc: 'One of your charms is disabled for this station.',
    hint: 'Charm Thief: one charm is switched off.', thief: true },
  { id: 'slick', icon: '💧', name: 'The Slick', desc: 'Oil runs to 55 feet. The ball barely hooks.',
    hint: 'The Slick: almost no hook. Play straighter.', oilFt: 55 },
  { id: 'burn', icon: '🌵', name: 'The Burn', desc: 'A bone-dry lane. The ball hooks from the foul line.',
    hint: 'The Burn: no oil, so hooks start early. Use less spin.', oilFt: 0 },
  { id: 'lead', icon: '⚓', name: 'Lead Rack', desc: 'Heavy, sturdy pins that are harder to knock over.',
    hint: 'Lead Rack: hit the pocket hard.', pinMass: 1.8, downMul: 0.65 },
  { id: 'speedtrap', icon: '🚨', name: 'Speed Trap', desc: 'Ball speed is capped at 15 mph.',
    hint: 'Speed Trap: 15 mph max. Slow balls hook more.', maxSpeed: 15 },
  { id: 'clock', icon: '⏰', name: 'The Clock', desc: 'One frame fewer and no re-racks.',
    hint: 'The Clock: 4 frames, no re-racks.', frames: -1, reracks: 0 },
];
const FINAL_BOSS = { id: 'proprietor', icon: '🎩', name: 'The Proprietor', final: true,
  desc: 'The owner stacks the deck: the lane slopes left, the gutters are wider and the pins are heavier.',
  hint: 'The Proprietor: tilt, wide gutters and heavy pins.', tilt: -5, trim: 2.5, pinMass: 1.4, downMul: 0.8 };

const has = (c) => c.mult > 0 && c.knocked > 0;   // a roll that actually scored pins
const countMod = (c, id) => c.mods.filter((m) => m === id).length;

const CHARMS = [
  // ---- strikes ----
  { id: 'sock', name: 'Lucky Sock', icon: '🧦', rarity: 'common', desc: 'Strikes give +4 Mult.',
    score(c) { if (c.strike) { c.mult += 4; return true; } } },
  { id: 'rocket', name: 'Pocket Rocket', icon: '🚀', rarity: 'common', desc: 'Strikes give +80 Pins.',
    score(c) { if (c.strike) { c.pins += 80; return true; } } },
  { id: 'hot', name: 'Hot Hand', icon: '🔥', rarity: 'uncommon', desc: 'Strikes give +2 Mult for every strike in a row.',
    score(c) { if (c.strike) { c.mult += 2 * c.streak; return true; } } },
  { id: 'turkeydinner', name: 'Turkey Dinner', icon: '🦃', rarity: 'rare', desc: 'Turkeys give ×2 Mult.',
    score(c) { if (c.type === 'turkey') { c.mult *= 2; return true; } } },
  { id: 'tipjar', name: 'Tip Jar', icon: '🫙', rarity: 'common', desc: 'Strikes give +$1.',
    score(c) { if (c.strike) { c.cash += 1; return true; } } },
  { id: 'showboat', name: 'Showboat', icon: '🎤', rarity: 'uncommon', desc: 'Strikes on a Boss Lane give ×2 Mult.',
    score(c) { if (c.strike && c.isBoss) { c.mult *= 2; return true; } } },
  // ---- spares and splits ----
  { id: 'savant', name: 'Seven-Ten Savant', icon: '🎯', rarity: 'uncommon', desc: 'Split pickups give ×2 Mult.',
    score(c) { if (c.type === 'split') { c.mult *= 2; return true; } } },
  { id: 'sparechange', name: 'Spare Change', icon: '💰', rarity: 'common', desc: 'Spares and split pickups give +$1.',
    score(c) { if (c.type === 'spare' || c.type === 'split') { c.cash += 1; return true; } } },
  { id: 'splitdecision', name: 'Split Decision', icon: '✂️', rarity: 'common', desc: 'Leaving a split on ball one gives +3 Mult.',
    score(c) { if (c.splitLeave) { c.mult += 3; return true; } } },
  { id: 'encore', name: 'Encore', icon: '👏', rarity: 'common', desc: 'Second balls get +2 Mult.',
    score(c) { if (!c.firstBall && c.mult > 0) { c.mult += 2; return true; } } },
  { id: 'ninecount', name: 'Nine Count', icon: '9️⃣', rarity: 'uncommon', desc: 'Knocking exactly 9 pins on a full rack gives ×2 Mult.',
    score(c) { if (c.fresh && c.knocked === 9) { c.mult *= 2; return true; } } },
  // ---- pins and patterns ----
  { id: 'domino', name: 'Domino Effect', icon: '💥', rarity: 'common', desc: '+5 Pins for each pin knocked down by another pin instead of the ball.',
    score(c) { if (c.domino > 0) { c.pins += 5 * c.domino; return true; } } },
  { id: 'cleansweep', name: 'Clean Sweep', icon: '🧹', rarity: 'uncommon', desc: 'Clean Back Row gives ×3 Mult.',
    score(c) { if (c.type === 'backrow') { c.mult *= 3; return true; } } },
  { id: 'headpin', name: 'Head Hunter', icon: '👑', rarity: 'common', desc: '+2 Mult when the 1-pin falls.',
    score(c) { if (c.mult > 0 && c.knockedNums.includes(1)) { c.mult += 2; return true; } } },
  { id: 'corner', name: 'Corner Pocket', icon: '🔺', rarity: 'common', desc: '+30 Pins for each corner pin (7 or 10) that falls.',
    score(c) { const n = c.knockedNums.filter((p) => p === 7 || p === 10).length; if (n) { c.pins += 30 * n; return true; } } },
  { id: 'bakers', name: "Baker's Dozen", icon: '🥯', rarity: 'common', desc: '+13 Pins on every roll that knocks a pin.',
    score(c) { if (c.knocked > 0) { c.pins += 13; return true; } } },
  { id: 'even', name: 'Even Steven', icon: '⚖️', rarity: 'common', desc: '+2 Mult when an even number of pins fall.',
    score(c) { if (has(c) && c.knocked % 2 === 0) { c.mult += 2; return true; } } },
  // ---- throw style ----
  { id: 'straight', name: 'Straight Shooter', icon: '📏', rarity: 'common', desc: 'Throws with no spin give +3 Mult.',
    score(c) { if (has(c) && Math.abs(c.spin) < 0.05) { c.mult += 3; return true; } } },
  { id: 'bighook', name: 'Big Hook', icon: '🪝', rarity: 'common', desc: 'Big-hook throws (either way) give +4 Mult.',
    score(c) { if (has(c) && Math.abs(c.spin) >= 0.85) { c.mult += 4; return true; } } },
  { id: 'speeddemon', name: 'Speed Demon', icon: '⚡', rarity: 'common', desc: 'Throws at 19 mph or faster give +3 Mult.',
    score(c) { if (has(c) && c.speed >= 19) { c.mult += 3; return true; } } },
  { id: 'softtouch', name: 'Soft Touch', icon: '🪶', rarity: 'common', desc: 'Throws at 15 mph or slower give +40 Pins.',
    score(c) { if (c.knocked > 0 && c.speed <= 15) { c.pins += 40; return true; } } },
  { id: 'polish', name: 'Ball Polish', icon: '✨', rarity: 'common', desc: 'Any ball except the House Ball gives +2 Mult.',
    score(c) { if (has(c) && c.ballId !== 'house') { c.mult += 2; return true; } } },
  // ---- gutters ----
  { id: 'punk', name: 'Gutter Punk', icon: '🤘', rarity: 'common', desc: 'Gutter balls score +20 Pins at ×2 Mult instead of nothing.',
    score(c) { if (c.type === 'gutter') { c.pins += 20; c.mult = 2; return true; } } },
  { id: 'bumpersticker', name: 'Bumper Sticker', icon: '🚙', rarity: 'uncommon', desc: 'Your first gutter-bound ball at each station bounces back onto the lane.',
    stationStart(s) { s.bumpers += 1; return true; } },
  // ---- timing ----
  { id: 'lastcall', name: 'Last Call', icon: '🍺', rarity: 'uncommon', desc: 'Every roll in your final frame gets ×3 Mult.',
    score(c) { if (c.lastFrame && c.mult > 0) { c.mult *= 3; return true; } } },
  { id: 'opening', name: 'Opening Act', icon: '🎬', rarity: 'common', desc: 'The first roll at each station gets ×2 Mult.',
    score(c) { if (c.firstRoll && c.mult > 0) { c.mult *= 2; return true; } } },
  { id: 'underdog', name: 'Underdog', icon: '🐶', rarity: 'uncommon', desc: '×2 Mult while your score is under half the target.',
    score(c) { if (c.mult > 0 && c.scoreSoFar < c.target / 2) { c.mult *= 2; return true; } } },
  // ---- scaling ----
  { id: 'slowlearner', name: 'Slow Learner', icon: '🐢', rarity: 'uncommon', desc: '+1 Mult for every open frame this run. (Currently +{n})',
    score(c, st) {
      st.n = st.n || 0;
      if (!c.firstBall && ['open', 'miss', 'gutter'].includes(c.type)) st.n++;
      if (st.n && c.mult > 0) { c.mult += st.n; return true; }
    } },
  { id: 'momentum', name: 'Momentum', icon: '🛞', rarity: 'uncommon', desc: '+1 Mult for each pin-knocking roll in a row at this station.',
    stationStart(s, st) { st.n = 0; },
    score(c, st) { if (c.knocked > 0) { st.n = (st.n || 0) + 1; if (c.mult > 0) { c.mult += st.n; return true; } } else st.n = 0; } },
  { id: 'steeltoe', name: 'Steel Toe', icon: '🥾', rarity: 'uncommon', desc: 'Each re-rack you use gives +2 Mult to every roll for the rest of the station.',
    stationStart(s, st) { st.n = 0; },
    rerack(_, st) { st.n = (st.n || 0) + 1; return true; },
    score(c, st) { if (st.n && c.mult > 0) { c.mult += 2 * st.n; return true; } } },
  { id: 'collector', name: 'Collector', icon: '🗃️', rarity: 'rare', desc: '+1 Mult for each charm you own.',
    score(c) { if (c.mult > 0) { c.mult += c.charmCount; return true; } } },
  // ---- frames and re-racks ----
  { id: 'shoes', name: 'Bowling Shoes', icon: '👟', rarity: 'uncommon', desc: '+1 frame at every station.',
    stationStart(s) { s.frames += 1; return true; } },
  { id: 'spare', name: 'Spare Parts', icon: '🔧', rarity: 'common', desc: '+1 re-rack at every station.',
    stationStart(s) { s.reracks += 1; return true; } },
  { id: 'pinpal', name: "Pinsetter's Pal", icon: '🤖', rarity: 'uncommon', desc: 'Each re-rack turns a random pin Gold for that rack.',
    rerack(_, st, api) { api.tempMod('gold'); return true; } },
  // ---- money ----
  { id: 'piggy', name: 'Piggy Bank', icon: '🐷', rarity: 'common', desc: '+$2 for every station you clear.',
    stationEnd(e) { if (e.won) { e.cash += 2; return true; } } },
  { id: 'pintip', name: "Pinsetter's Tip", icon: '💵', rarity: 'common', desc: '+$1 for each unused re-rack when you clear a station.',
    stationEnd(e) { if (e.won && e.reracksLeft > 0) { e.cash += e.reracksLeft; return true; } } },
  { id: 'coupon', name: 'Coupon Book', icon: '🎟️', rarity: 'uncommon', desc: 'Everything in the Pro Shop costs $1 less.', discount: 1 },
  { id: 'refill', name: 'Free Refill', icon: '🥤', rarity: 'common', desc: 'Your first reroll in each Pro Shop is free.', freeReroll: true },
  // ---- pin mod synergies ----
  { id: 'midas', name: 'Midas Touch', icon: '🤴', rarity: 'uncommon', desc: 'Gold pins pay $2 more.',
    score(c) { const n = countMod(c, 'gold'); if (n) { c.cash += 2 * n; return true; } } },
  { id: 'demolition', name: 'Demolition', icon: '🏗️', rarity: 'uncommon', desc: '+3 Mult for each Explosive pin that falls.',
    score(c) { const n = countMod(c, 'boom'); if (n && c.mult > 0) { c.mult += 3 * n; return true; } } },
];
for (const c of CHARMS) c.price = RARITY[c.rarity].price;

window.GR = { RARITY, ROLL_TYPES, BALLS, PIN_MODS, OILS, TROPHIES, BOSSES, FINAL_BOSS, CHARMS };
})();
