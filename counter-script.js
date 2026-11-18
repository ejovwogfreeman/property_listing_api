// One-off: start the property counter at the highest PROP number in use,
// then give every property that has no code its own new code.
// Run once with: node scripts/seed-property-counter.js
require("dotenv").config();
const mongoose = require("mongoose");
const Property = require("./models/property");
const Counter = require("./models/counter");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected");

  // 1. find the highest number already used
  const withCodes = await Property.collection
    .find({ code: /^PROP-\d+$/ }, { projection: { code: 1 } })
    .toArray();
  const highest = withCodes.reduce(
    (max, p) => Math.max(max, parseInt(p.code.split("-")[1], 10) || 0),
    0,
  );

  // $max never lowers the counter, so running this twice is safe
  await Counter.updateOne(
    { _id: "property" },
    { $max: { seq: highest } },
    { upsert: true },
  );
  console.log(`Counter set to at least ${highest}`);

  // 2. give old properties without a code a new one, oldest first
  const missing = await Property.collection
    .find({ $or: [{ code: { $exists: false } }, { code: null }] })
    .sort({ createdAt: 1 })
    .toArray();

  for (const property of missing) {
    const counter = await Counter.findOneAndUpdate(
      { _id: "property" },
      { $inc: { seq: 1 } },
      { new: true },
    );
    const code = `PROP-${String(counter.seq).padStart(4, "0")}`;
    await Property.collection.updateOne(
      { _id: property._id },
      { $set: { code } },
    );
    console.log(`${property._id} -> ${code}`);
  }
  console.log(`Gave codes to ${missing.length} properties`);

  await mongoose.disconnect();
  console.log("Done");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
