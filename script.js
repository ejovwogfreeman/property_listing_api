require("dotenv").config();
const mongoose = require("mongoose");
const Escrow = require("./models/escrow");
const Purchase = require("./models/purchase");
const Inspection = require("./models/inspection");

async function run() {
  // Use your database connection string variable from .env (commonly MONGO_URI or MONGODB_URI)
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("Missing MONGO_URI or MONGODB_URI in .env file");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB...");

  const refunded = await Escrow.find({ status: "refunded" });
  console.log(`Found ${refunded.length} refunded escrow record(s).`);

  for (const e of refunded) {
    const record = e.purchase
      ? await Purchase.findById(e.purchase)
      : e.inspection
        ? await Inspection.findById(e.inspection)
        : null;

    if (!record || !record.refundDue) continue; // finished properly

    await Escrow.updateOne(
      { _id: e._id, status: "refunded" },
      {
        $set: { status: "refund_pending" },
        $unset: {
          refundedAt: 1,
          refundedAmount: 1,
          refundProcessingFee: 1,
          transferReference: 1,
          refundNote: 1,
          releasedAt: 1,
          releasedBy: 1,
        },
      },
    );
    console.log("Reopened refund for escrow:", e._id.toString());
  }

  await mongoose.disconnect();
  console.log("Done and disconnected.");
}

run().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
