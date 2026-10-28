/**
 * How a candidate listing relates to a source listing, each rule led by the verdict it gives. The LLM judge is
 * prompted with them and the matcher eval's pairs are labelled by them.
 */
export const MATCHING_RULES = [
  "same: the same item, sold the same way, whatever the store calls it.",
  "variant: the same item differing only in KV, cell count, colour, antenna polarization, radio protocol, receiver, "
  + "video system (analog or digital) or pack size.",
  "variant: a bundle, the item sold with extras such as props, batteries or goggles, versus the item alone.",
  "variant: a stack versus one of its boards sold alone, such as the flight controller without the ESC.",
  "different: another size, such as a motor stator, frame or prop size, or another model generation or series.",
  "different: a clone, including an unbranded listing that copies the model name, and an accessory for the item.",
] as const;
