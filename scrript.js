// One-off: rebuild the reference indexes on inspections and purchases as
// sparse, so records without a Paystack reference yet don't clash.
// Run once with: node scripts/fix-reference-indexes.js
require("dotenv").config();
const mongoose = require("mongoose");
const Inspection = require("./models/inspection");
const Purchase = require("./models/purchase");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected");

  for (const Model of [Inspection, Purchase]) {
    const name = Model.collection.collectionName;

    // a sparse index still counts a stored `null`, so remove those first
    const unset = await Model.collection.updateMany(
      { reference: null },
      { $unset: { reference: "" } },
    );
    console.log(`${name}: removed null reference on ${unset.modifiedCount}`);

    const indexes = await Model.collection.indexes();
    const old = indexes.find((i) => i.name === "reference_1");
    if (old && !old.sparse) {
      await Model.collection.dropIndex("reference_1");
      console.log(`${name}: dropped old reference_1`);
    }

    // rebuilds reference_1 from the model (unique + sparse)
    await Model.syncIndexes();
    const now = (await Model.collection.indexes()).find(
      (i) => i.name === "reference_1",
    );
    console.log(`${name}: reference_1 now`, now);
  }

  await mongoose.disconnect();
  console.log("Done");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
