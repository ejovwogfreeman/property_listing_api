const axios = require("axios");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET; // add your secret key in .env

// Initialize transaction
exports.initializeTransaction = async (
  email,
  amount,
  reference,
  callback_url,
  metadata,
) => {
  try {
    const res = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      { email, amount, reference, callback_url, metadata },

      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
      },
    );
    return res.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message);
  }
};

// Verify transaction
exports.verifyTransaction = async (reference) => {
  try {
    const res = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      },
    );
    return res.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message);
  }
};

// Refund a payment back to the buyer's card or bank account.
// reference: the Paystack reference of the original payment.
// amount: in NAIRA (converted to kobo here). Leave it out for a full refund.
// Docs: https://paystack.com/docs/api/refund/#create
exports.createRefund = async ({
  reference,
  amount,
  customerNote,
  merchantNote,
}) => {
  try {
    const body = { transaction: reference };
    if (amount) body.amount = Math.round(Number(amount) * 100);
    if (customerNote) body.customer_note = customerNote;
    if (merchantNote) body.merchant_note = merchantNote;

    const res = await axios.post("https://api.paystack.co/refund", body, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
    });
    // res.data.data: { id, status: "pending" | "processing" | "processed", amount, ... }
    return res.data;
  } catch (err) {
    // Paystack's own reason, e.g. "Transaction has been fully reversed" or
    // an insufficient balance on the Paystack account
    throw new Error(err.response?.data?.message || err.message);
  }
};
