// One-off: set every property's platform fee (escrowFee) from the agreed rates.
// Run with: node backfill-platform-fees.js         (list only)
//           node backfill-platform-fees.js --apply (list and update)
require("dotenv").config();
const mongoose = require("mongoose");
const Property = require("./models/property");
const { calculatePlatformFee } = require("./middlewares/platformFee");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const props = await Property.find(
    {},
    "title price listingType escrowFee",
  ).lean();
  const changes = props
    .map((p) => ({
      id: String(p._id),
      title: p.title,
      listingType: p.listingType,
      price: p.price,
      oldFee: p.escrowFee ?? null,
      newFee: calculatePlatformFee(p.price, p.listingType),
    }))
    .filter((c) => c.oldFee !== c.newFee);

  console.table(changes);

  if (process.argv.includes("--apply")) {
    for (const c of changes) {
      // updateOne skips the pre-save hook, so codes and history are untouched
      await Property.updateOne(
        { _id: c.id },
        { $set: { escrowFee: c.newFee } },
      );
    }
    console.log(`Updated ${changes.length} properties`);
  } else {
    console.log("List only. Run again with --apply to update them.");
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
