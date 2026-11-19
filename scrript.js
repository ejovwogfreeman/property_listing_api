// One-off: create the missing escrow_refund ledger records for escrows that
// were refunded during the 12 Nov bug.
// Run once with: node backfill-refund-transactions.js
require("dotenv").config();
const mongoose = require("mongoose");
const Escrow = require("./models/escrow");
const Transaction = require("./models/transaction");
const User = require("./models/user");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const admin = await User.findOne({ role: "admin" });
  const refunded = await Escrow.find({ status: "refunded" }).lean();
  let created = 0;

  for (const escrow of refunded) {
    const prefix = escrow.reference || String(escrow._id);
    const exists = await Transaction.findOne({
      type: "escrow_refund",
      to: escrow.buyer,
      reference: { $regex: `^${prefix}` },
    });
    if (exists) continue;

    await Transaction.create({
      from: escrow.releasedBy || admin._id,
      to: escrow.buyer,
      amount: escrow.refundedAmount || escrow.amount,
      type: "escrow_refund",
      status: "completed",
      reference: `${prefix}-refund-backfill`,
    });
    created++;
  }

  console.log(
    `Checked ${refunded.length} refunded escrows, created ${created} records`,
  );
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
