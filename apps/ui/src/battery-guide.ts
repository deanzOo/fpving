import { BatteryPiece } from "./battery-model.ts";
import type { PartGuide } from "./motor-guide.ts";

/** What the atlas says about the whole battery. */
export const BATTERY_GUIDE: PartGuide = {
  name: "Battery",
  what: "A lithium polymer pack, or LiPo: cells in series that power everything on the quad.",
  how: "Each cell gives 3.7V nominal and 4.2V full. The S count is how many are in series: a 6S pack is 22.2V nominal.",
  fails: "A damaged LiPo can fail without warning, even if it still seems to work. Never repair a punctured or swollen "
    + "pack.",
  specs: "Cell count, capacity and weight. 1000 to 1300 mAh is typical for 6S on a 5 inch. C ratings are often "
    + "exaggerated, so trust real tests.",
};

/** What the atlas says about each piece of the battery. */
export const BATTERY_PIECE_GUIDES: Readonly<Record<BatteryPiece, PartGuide>> = {
  [BatteryPiece.Cells]: {
    name: "Cells",
    what: "Six flat pouch cells, stacked and wired in series.",
    how: "Their voltages add up in series. Each charges to 4.2V, or 4.35V for LiHV cells rated for it.",
    fails: "Land at about 3.5 to 3.6V per cell under load. Flying on toward 3.0V harms them.",
    specs: "Stored for more than about a week, keep them at 3.80 to 3.85V each. With age their resistance rises, so "
      + "older packs sag more.",
  },
  [BatteryPiece.Wrap]: {
    name: "Wrap",
    what: "The shrink wrap that holds the cells together and protects them.",
    how: "It keeps the stack tight and takes the scuffs, with the label printed on it.",
    fails: "A pack that puffs up, often from being left fully charged too long, is less safe to use.",
    specs: "Check it after a crash: a dented or punctured cell under torn wrap means retiring the pack.",
  },
  [BatteryPiece.Leads]: {
    name: "Main leads",
    what: "Thick silicone wires carrying all the current, red for positive and black for negative.",
    how: "Every amp the motors draw flows through them, and on to the ESC's battery pads.",
    fails: "A crushed or nicked lead can short the pack.",
    specs: "Their gauge must suit the current, and they should be no longer than the build needs.",
  },
  [BatteryPiece.Xt60]: {
    name: "XT60",
    what: "The main power connector, standard on 5 inch quads. Small quads use the smaller XT30.",
    how: "Its shape lets it plug in only one way round, so polarity cannot be swapped.",
    fails: "A worn or loose connector heats up under load.",
    specs: "Ratings vary by source: around 60A continuous by one, 30A by another. Treat them as a ceiling.",
  },
  [BatteryPiece.BalanceLead]: {
    name: "Balance lead",
    what: "A thin lead with one wire more than the pack has cells: seven on a 6S.",
    how: "The charger uses it to read and even out each cell's voltage. Charge with a balance charger at 1C.",
    fails: "Loose, it can flap into the props, so tuck it under the strap or a rubber band.",
    specs: "Count its wires and take one off to get the cell count.",
  },
};
